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
