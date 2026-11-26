// T-01: units are normalised once, at the boundary where data enters.
//
// Every fixture in test/logic.test.mjs uses the built-in unit, which is why
// the gap these tests cover could not show up there: 11.8 g/dL and 11.8 g/L
// look identical to a comparison that never reads the unit.
//
// Acceptance criteria: docs/issues/T-01-unit-normalisation.md

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  convert,
  normaliseUnitName,
  canonicalUnit,
  normaliseEntry
} from '../lib/units.mjs';
import { isAbnormal } from '../lib/logic.mjs';

test('T-01 AC1 a haemoglobin value in g/dL becomes g/L and reads as normal', () => {
  const out = convert('HGB', 11.8, 'g/dL');
  assert.equal(out.ok, true);
  assert.equal(out.value, 118);
  assert.equal(out.unit, 'g/L');

  // The bug this task fixes: 11.8 compared against a 115-175 g/L range was
  // reported as low, with no error and no warning.
  assert.equal(isAbnormal({ value: out.value, refLow: 115, refHigh: 175 }), false);
});

test('T-01 AC2 a glucose value in mg/dL becomes mmol/L', () => {
  const out = convert('GLU', 99, 'mg/dL');
  assert.equal(out.ok, true);
  assert.equal(out.unit, 'mmol/L');
  assert.ok(Math.abs(out.value - 5.49) < 0.02, `expected 5.49, got ${out.value}`);
  assert.equal(isAbnormal({ value: out.value, refLow: 3.9, refHigh: 6.1 }), false);
});

test('T-01 AC3 the four spellings of 10^9 per litre normalise to one form', () => {
  const spellings = ['10⁹/L', '10^9/L', '10^9/l', '×10^9/L'];
  for (const spelling of spellings) {
    assert.equal(normaliseUnitName(spelling), '10^9/L', spelling);
    assert.equal(canonicalUnit('WBC'), '10^9/L');
  }

  const verdicts = spellings.map(spelling => {
    const out = convert('WBC', 6.2, spelling);
    assert.equal(out.ok, true, spelling);
    assert.equal(out.unit, '10^9/L', spelling);
    return isAbnormal({ value: out.value, refLow: 3.5, refHigh: 9.5 });
  });
  assert.deepEqual(verdicts, [false, false, false, false]);
});

test('T-01 AC4 an unknown unit is rejected and the accepted units are listed', () => {
  const out = convert('HGB', 11.8, 'foo');
  assert.equal(out.ok, false);
  assert.ok(Array.isArray(out.accepted), 'accepted must be a list');
  assert.ok(out.accepted.includes('g/L'));
  assert.ok(out.accepted.includes('g/dL'));
  // Nothing is converted, so nothing can be stored as if it were checked.
  assert.equal(out.value, undefined);
});

test('T-01 a value already in the canonical unit is not converted twice', () => {
  const out = convert('HGB', 118, 'g/L');
  assert.equal(out.ok, true);
  assert.equal(out.value, 118);
  assert.equal(out.unit, 'g/L');
});

test('T-01 the factor depends on the substance, not on the unit alone', () => {
  // 99 mg/dL of glucose and 99 mg/dL of cholesterol are different amounts in
  // mmol/L, so a single global convert() would be wrong for one of them.
  const glucose = convert('GLU', 99, 'mg/dL');
  const cholesterol = convert('TC', 99, 'mg/dL');
  assert.equal(glucose.ok, true);
  assert.equal(cholesterol.ok, true);
  assert.notEqual(glucose.value, cholesterol.value);
  assert.ok(Math.abs(cholesterol.value - 2.56) < 0.02, `expected 2.56, got ${cholesterol.value}`);
});

test('T-01 a range printed in the entry own unit moves with the value', () => {
  // A report that prints "11.0 - 16.0 g/dL" means that range in g/dL too, so
  // converting the value and leaving the bounds alone would compare 118
  // against 16 and call every result high.
  const out = normaliseEntry({
    indicator: 'HGB',
    value: 11.8,
    unit: 'g/dL',
    refLow: 11.0,
    refHigh: 16.0
  });
  assert.equal(out.ok, true);
  assert.equal(out.value, 118);
  assert.equal(out.unit, 'g/L');
  assert.equal(out.unitOriginal, 'g/dL');
  assert.equal(out.refLow, 110);
  assert.equal(out.refHigh, 160);
  assert.equal(isAbnormal({ value: out.value, refLow: out.refLow, refHigh: out.refHigh }), false);
});
