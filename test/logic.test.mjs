import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isAbnormal, direction, referenceText, abnormalCount,
  parseRefText, lookupBuiltin, explainText, sortReports, bounds
} from '../lib/logic.mjs';

// US-07 fixture, carried over from the original report-detail implementation.
const REPORT = {
  collectedAt: '2026-10-12',
  items: [
    { name: 'WBC', display: 'White blood cell count', value: 11.2, unit: '10^9/L', low: 3.5, high: 9.5 },
    { name: 'RBC', display: 'Red blood cell count', value: 4.31, unit: '10^12/L', low: 3.8, high: 5.1 },
    { name: 'HGB', display: 'Haemoglobin', value: 118, unit: 'g/L', low: 115, high: 150 },
    { name: 'PLT', display: 'Platelet count', value: 96, unit: '10^9/L', low: 125, high: 350 },
    { name: 'NEUT%', display: 'Neutrophil ratio', value: 78.4, unit: '%', low: 40, high: 75 }
  ]
};

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
  const onUpper = { value: 9.5, refLow: 3.5, refHigh: 9.5 };
  assert.equal(isAbnormal(onUpper), false);
  assert.equal(direction(onUpper), 'normal');

  // The lower edge behaves the same way, so both limits are inclusive.
  const onLower = { value: 3.5, refLow: 3.5, refHigh: 9.5 };
  assert.equal(isAbnormal(onLower), false);
  assert.equal(direction(onLower), 'normal');

  // One step outside is already abnormal, so the limit itself is the only
  // value that counts as normal. This is what pins the strict comparison.
  assert.equal(isAbnormal({ value: 9.51, refLow: 3.5, refHigh: 9.5 }), true);
  assert.equal(isAbnormal({ value: 3.49, refLow: 3.5, refHigh: 9.5 }), true);
});

test('US-07 reference range is rendered as low - high', () => {
  assert.equal(referenceText(wbc), '3.5 - 9.5');
});

test('US-07 the abnormal count matches the flags on screen', () => {
  assert.equal(abnormalCount(REPORT.items), 3);
});

test('refText printed on the report wins over the legacy low/high fields', () => {
  const item = { value: 5, refLow: 3.5, refHigh: 9.5, refText: '3.6 - 9.0' };
  assert.equal(referenceText(item), '3.6 - 9.0');
});

test('one-sided ranges render with ≤ / ≥', () => {
  assert.equal(referenceText({ value: 4, refHigh: 10 }), '≤ 10');
  assert.equal(referenceText({ value: 4, refLow: 1.5 }), '≥ 1.5');
  assert.equal(referenceText({ value: 4 }), '—');
});

test('parseRefText handles the range formats labs actually print', () => {
  assert.deepEqual(parseRefText('3.5-9.5'), { low: 3.5, high: 9.5 });
  assert.deepEqual(parseRefText('3.5 ~ 9.5'), { low: 3.5, high: 9.5 });
  assert.deepEqual(parseRefText('<10'), { low: null, high: 10 });
  assert.deepEqual(parseRefText('≥5'), { low: 5, high: null });
  assert.equal(parseRefText('阴性'), null);
  assert.equal(parseRefText(''), null);
});

test('builtin reference table fills common items', () => {
  const wbcRef = lookupBuiltin('白细胞计数');
  assert.equal(wbcRef.display, 'WBC');
  assert.equal(wbcRef.low, 3.5);
  const glucose = lookupBuiltin('空腹血糖');
  assert.equal(glucose.unit, 'mmol/L');
  assert.equal(lookupBuiltin('完全陌生的指标'), null);
});

test('US-06 timeline sorts newest first', () => {
  const sorted = sortReports([
    { id: 'a', collectedAt: '2026-11-01', createdAt: '2026-11-02T10:00:00Z' },
    { id: 'b', collectedAt: '2026-11-20', createdAt: '2026-11-20T09:00:00Z' },
    { id: 'c', collectedAt: '2026-11-20', createdAt: '2026-11-21T09:00:00Z' }
  ]);
  assert.deepEqual(sorted.map(r => r.id), ['c', 'b', 'a']);
});

test('rule-based explanation describes in-range values without a previous report', () => {
  const text = explainText(rbc, null);
  assert.match(text, /红细胞|RBC/);
  assert.match(text, /参考范围/);
  assert.match(text, /医生/);
});

test('rule-based explanation flags an out-of-range value and compares to last time', () => {
  const text = explainText(wbc, { value: 6.0, unit: '10^9/L', collectedAt: '2026-09-01' });
  assert.match(text, /高于参考范围/);
  assert.match(text, /2026-09-01/);
  assert.match(text, /升高/);
});

test('bounds accepts both the new and the legacy item shape', () => {
  assert.deepEqual(bounds({ value: 1, refLow: 1, refHigh: 2 }), [1, 2]);
  assert.deepEqual(bounds({ value: 1, low: 1, high: 2 }), [1, 2]);
});
