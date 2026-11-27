import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { hashPassword, verifyPassword, newSessionToken, newBindCode } from '../lib/auth.mjs';
import { Store } from '../lib/store.mjs';

function tempStore() {
  return new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'fhr-auth-')));
}

// ---- lib/auth.mjs primitives ----

test('password hash round-trips; wrong password fails', () => {
  const stored = hashPassword('test1234');
  assert.match(stored, /^[0-9a-f]{32}:[0-9a-f]{128}$/, 'salt:hash hex format');
  assert.equal(verifyPassword('test1234', stored), true);
  assert.equal(verifyPassword('Test1234', stored), false, 'case matters');
  assert.equal(verifyPassword('', stored), false);
  assert.equal(verifyPassword('x', 'not-a-hash'), false, 'malformed stored value fails closed');
});

test('two hashes of the same password differ (random salt)', () => {
  assert.notEqual(hashPassword('test1234'), hashPassword('test1234'));
});

test('session tokens are 64 hex chars and unique', () => {
  const a = newSessionToken();
  const b = newSessionToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test('bind codes are 6 chars from the unambiguous alphabet', () => {
  const alphabet = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
  for (let i = 0; i < 50; i++) assert.match(newBindCode(), alphabet);
});

// ---- users ----

test('createUser validates name and password, dedupes case-insensitively', () => {
  const store = tempStore();
  const user = store.createUser('TangTL', 'pass666');
  assert.equal(user.username, 'TangTL');

  assert.throws(() => store.createUser('a', 'pass666'), /用户名/, 'too short');
  assert.throws(() => store.createUser('x'.repeat(25), 'pass666'), /用户名/, 'too long');
  assert.throws(() => store.createUser('bad name!', 'pass666'), /用户名/, 'bad chars');
  assert.throws(() => store.createUser('okname', '123'), /密码/, 'password too short');
  assert.throws(() => store.createUser('tangtl', 'pass777'), /已被使用/, 'case-insensitive dup');
  assert.throws(() => store.createUser('中文昵称', 12345), /密码/, 'non-string password rejected');
  assert.equal(store.createUser('中文昵称', 'pass666').username, '中文昵称', 'Chinese names allowed');
});

test('verifyLogin: right credentials pass; unknown user and wrong password share one path', () => {
  const store = tempStore();
  store.createUser('tl', 'pass666');
  assert.equal(store.verifyLogin('tl', 'pass666')?.username, 'tl');
  assert.equal(store.verifyLogin('TL', 'pass666')?.username, 'tl', 'username case-insensitive');
  assert.equal(store.verifyLogin('tl', 'wrong!'), null);
  assert.equal(store.verifyLogin('nobody', 'pass666'), null);
  assert.equal(store.verifyLogin('', ''), null);
});

// ---- sessions ----

test('session create → resolve → drop', () => {
  const store = tempStore();
  const user = store.createUser('tl', 'pass666');
  const token = store.createSession(user.id);
  assert.equal(store.getUserBySession(token)?.id, user.id);
  store.dropSession(token);
  assert.equal(store.getUserBySession(token), null);
  store.dropSession('no-such-token'); // must not throw
});

test('expired sessions resolve to null and get pruned', () => {
  const store = tempStore();
  const user = store.createUser('tl', 'pass666');
  const token = store.createSession(user.id);
  store.data.sessions[token].expiresAt = Date.now() - 1;
  assert.equal(store.getUserBySession(token), null, 'expired token does not resolve');
  store.pruneSessions();
  assert.ok(!(token in store.data.sessions), 'prune removed the expired session');
});

// ---- ownership, claim, bind ----

function setupFamily() {
  const store = tempStore();
  const alice = store.createUser('alice', 'pass666');
  const bob = store.createUser('bob', 'pass777');
  const p = store.upsertPatient({ name: '王秀兰', ownerUserId: alice.id });
  return { store, alice, bob, p };
}

test('a new archive belongs to its creator and is invisible to others', () => {
  const { store, alice, bob, p } = setupFamily();
  assert.equal(p.ownerUserId, alice.id);
  assert.deepEqual(store.patientsForUser(alice.id).map(x => x.name), ['王秀兰']);
  assert.deepEqual(store.patientsForUser(bob.id), []);
  assert.equal(store.patientVisibleTo(p, bob.id), false);
  assert.equal(store.patientVisibleTo(p, alice.id), true);
});

test('editing an archive keeps owner, members and bind code', () => {
  const { store, alice, p } = setupFamily();
  const before = store.maskPatient(store.getPatient(p.id));
  store.upsertPatient({ id: p.id, name: '王秀兰', notes: '高血压十年' });
  const after = store.maskPatient(store.getPatient(p.id));
  assert.equal(after.ownerUserId, alice.id, 'owner survives a partial edit');
  assert.deepEqual(after.members, before.members);
  assert.equal(after.bindCode, before.bindCode, 'bind code is stable');
  assert.equal(after.notes, '高血压十年');
});

test('claim: adopts an unclaimed archive; refuses one owned by someone else', () => {
  const { store, alice, bob, p } = setupFamily();
  assert.throws(() => store.claimPatient(p.id, bob.id), /已由其他账号创建/, /400/);
  assert.throws(() => store.claimPatient('p_missing', bob.id), /档案不存在/, /404/);

  const orphan = store.upsertPatient({ name: '李建国' }); // pre-accounts archive
  assert.equal(orphan.ownerUserId, null);
  store.claimPatient(orphan.id, bob.id);
  assert.equal(store.getPatient(orphan.id).ownerUserId, bob.id);
  assert.deepEqual(store.patientsForUser(bob.id).map(x => x.name), ['李建国']);
  assert.ok(alice.id); // alice untouched
});

test('bind: wrong code rejected; right code adds a member; unclaimed adopt', () => {
  const { store, alice, bob, p } = setupFamily();
  assert.throws(() => store.bindPatientByCode('ZZZZZZ', bob.id), /绑定码不对/, /400/);

  const code = store.maskPatient(store.getPatient(p.id)).bindCode;
  store.bindPatientByCode(code.toLowerCase(), bob.id); // case-insensitive on purpose
  assert.equal(store.patientVisibleTo(store.getPatient(p.id), bob.id), true,
    'member can now see the archive');
  assert.equal(store.getPatient(p.id).ownerUserId, alice.id, 'ownership unchanged');

  const orphan = store.upsertPatient({ name: '李建国' });
  const orphanCode = store.maskPatient(orphan).bindCode;
  store.bindPatientByCode(orphanCode, bob.id);
  assert.equal(store.getPatient(orphan.id).ownerUserId, bob.id,
    'binding an unclaimed archive adopts it outright');
});

test('masked patients expose the bind code but never the API key', () => {
  const { store, p } = setupFamily();
  store.upsertPatient({ id: p.id, name: '王秀兰', llm: { baseUrl: 'https://x', apiKey: 'sk-secret-value', visionModel: 'm', textModel: 't' } });
  const masked = store.maskPatient(store.getPatient(p.id));
  assert.equal(masked.bindCode, store.getPatient(p.id).bindCode);
  assert.equal(masked.llmConfigured, true);
  assert.equal(masked.llmHint, '…alue');
  assert.ok(!JSON.stringify(masked).includes('sk-secret-value'), 'raw key never leaves the server');
});
