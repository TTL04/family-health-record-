import test from 'node:test';
import assert from 'node:assert/strict';

import { REPORT, isAbnormal, direction, referenceText, abnormalCount } from './report-detail.mjs';

const wbc = REPORT.items.find(i => i.name === 'WBC');   // 11.2, range 3.5 - 9.5
const rbc = REPORT.items.find(i => i.name === 'RBC');   // 4.31, range 3.8 - 5.1
const plt = REPORT.items.find(i => i.name === 'PLT');   // 96,   range 125 - 350

test('US-07 a value above the upper limit is abnormal', () => {
  assert.equal(isAbnormal(wbc), true);
  assert.equal(direction(wbc), 'high');
});

test('US-07 a value below the lower limit is abnormal', () => {
  assert.equal(isAbnormal(plt), true);
  assert.equal(direction(plt), 'low');
});

test('US-07 a value inside the range is not abnormal', () => {
  assert.equal(isAbnormal(rbc), false);
  assert.equal(direction(rbc), 'normal');
});

test('US-07 a value exactly on a limit counts as normal', () => {
  const edge = { value: 9.5, low: 3.5, high: 9.5 };
  assert.equal(isAbnormal(edge), false);
  assert.equal(direction(edge), 'normal');
});

test('US-07 reference range is rendered as low - high', () => {
  assert.equal(referenceText(wbc), '3.5 - 9.5');
});

test('US-07 the abnormal count matches the flags on screen', () => {
  assert.equal(abnormalCount(REPORT.items), 3);
});
