import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Store } from '../lib/store.mjs';

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhr-store-'));
  return { store: new Store(dir), dir };
}

test('US-08 the timeline survives an app restart', () => {
  const { store, dir } = tmpStore();
  store.upsertPatient({ name: '王秀兰', birthYear: '1952', gender: '女' });
  store.addReport({
    id: 'r_1',
    patientId: store.data.patients[0].id,
    type: '血常规',
    hospital: '市人民医院',
    collectedAt: '2026-11-20',
    items: [{ id: 'i_1', name: '白细胞', value: 6.2, unit: '10^9/L', refLow: 3.5, refHigh: 9.5 }]
  });

  // A brand-new Store instance simulates the app restarting.
  const reopened = new Store(dir);
  assert.equal(reopened.data.reports.length, 1);
  assert.equal(reopened.data.reports[0].items[0].name, '白细胞');
  assert.equal(reopened.data.patients[0].name, '王秀兰');
});

test('upsertPatient edits an existing profile instead of duplicating it', () => {
  const { store } = tmpStore();
  const created = store.upsertPatient({ name: '王秀兰' });
  store.upsertPatient({ id: created.id, name: '王秀兰', notes: '高血压' });
  assert.equal(store.data.patients.length, 1);
  assert.equal(store.data.patients[0].notes, '高血压');
});

test('a patient without a name is rejected', () => {
  const { store } = tmpStore();
  assert.throws(() => store.upsertPatient({ name: '' }), /姓名不能为空/);
});

test('deleteReport removes the report and keeps the rest', () => {
  const { store } = tmpStore();
  store.addReport({ id: 'r_1', patientId: 'p1', collectedAt: '2026-01-01', items: [] });
  store.addReport({ id: 'r_2', patientId: 'p1', collectedAt: '2026-02-01', items: [] });
  const removed = store.deleteReport('r_1');
  assert.equal(removed.id, 'r_1');
  assert.deepEqual(store.data.reports.map(r => r.id), ['r_2']);
  assert.equal(store.deleteReport('missing'), null);
});

test('save writes an atomic, readable JSON file', () => {
  const { store, dir } = tmpStore();
  store.upsertPatient({ name: '李建国' });
  const file = path.join(dir, 'app-data.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.patients[0].name, '李建国');
  assert.ok(!fs.existsSync(`${file}.tmp`), 'temp file must be renamed away');
});

test('exportSnapshot returns data without sessions', () => {
  const { store } = tmpStore();
  const p = store.upsertPatient({ name: '王秀兰' });
  store.addReport({ id: 'r_1', patientId: p.id, collectedAt: '2026-01-01', items: [] });
  store.createUser('test', 'test1234');
  store.createSession(store.data.users[0].id);

  const snapshot = store.exportSnapshot();
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.patients.length, 1);
  assert.equal(snapshot.reports.length, 1);
  assert.equal(snapshot.users.length, 1);
  assert.ok(!('sessions' in snapshot), 'sessions must not be exported');
});

test('importSnapshot merges without overwriting existing records', () => {
  const { store } = tmpStore();
  store.upsertPatient({ id: 'p_1', name: '王秀兰' });
  store.addReport({ id: 'r_1', patientId: 'p_1', collectedAt: '2026-01-01', items: [] });

  const snapshot = {
    patients: [
      { id: 'p_1', name: '应被忽略的重复' },
      { id: 'p_2', name: '李建国' }
    ],
    reports: [
      { id: 'r_1', patientId: 'p_1', collectedAt: '2000-01-01', items: [] },
      { id: 'r_2', patientId: 'p_2', collectedAt: '2026-02-01', items: [] }
    ],
    users: [],
    settings: { llm: null }
  };

  const result = store.importSnapshot(snapshot, 'u_me');
  assert.equal(result.patients, 1);
  assert.equal(result.reports, 1);
  // Existing records are kept as-is; only gaps are filled.
  assert.equal(store.data.patients.find(p => p.id === 'p_1').name, '王秀兰');
  assert.equal(store.data.reports.find(r => r.id === 'r_1').collectedAt, '2026-01-01');
  assert.equal(store.data.patients.length, 2);
  assert.equal(store.data.reports.length, 2);
});

test('importSnapshot grants the importer access to imported archives', () => {
  const { store } = tmpStore();
  store.importSnapshot({
    patients: [{ id: 'p_9', name: '陈阿婆' }], reports: [], users: [], settings: {}
  }, 'u_me');
  const imported = store.data.patients.find(p => p.id === 'p_9');
  assert.ok(Array.isArray(imported.members) && imported.members.includes('u_me'));
});

test('importSnapshot rejects a non-object', () => {
  const { store } = tmpStore();
  assert.throws(() => store.importSnapshot('garbage', 'u_me'), /备份文件格式不正确/);
});
