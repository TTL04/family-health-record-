// T-01: laboratory units are normalised once, at the boundary where data
// enters. Nothing downstream converts again — a second conversion is the
// classic double-scaling bug, and the reason `convert` returns the canonical
// unit together with the number instead of a bare number.
//
// There is one table entry per indicator, not one global factor, because the
// factor belongs to the substance: 99 mg/dL of glucose is 5.50 mmol/L, while
// 99 mg/dL of cholesterol is 2.56 mmol/L. A single convert() would be wrong
// for one of them, and wrong in a way no type system would catch.
//
// Deliberately no imports: the server, the browser pages and the tests all
// load this file, so it must stay dependency-free.

// Factors from the published SI conversion tables. Each value multiplies a
// reading in that unit to give the canonical unit.
//
//   HGB   1 g/dL   = 10 g/L
//   GLU   1 mg/dL  = 0.05551 mmol/L   (molar mass 180.16 g/mol)
//   TC    1 mg/dL  = 0.02586 mmol/L   (molar mass 386.65 g/mol)
//   TG    1 mg/dL  = 0.01129 mmol/L   (triolein, 885 g/mol)
//   TBIL  1 mg/dL  = 17.1 umol/L      (molar mass 584.66 g/mol)
//   CREA  1 mg/dL  = 88.4 umol/L      (molar mass 113.12 g/mol)
//   UREA  1 mg/dL  = 0.357 mmol/L     (BUN, molar mass 28.01 g/mol x 2)
//   UA    1 mg/dL  = 59.48 umol/L     (molar mass 168.11 g/mol)
//   FT4   1 ng/dL  = 12.87 pmol/L     (molar mass 776.87 g/mol)
const TABLE = {
  WBC:     { unit: '10^9/L',  factors: {} },
  RBC:     { unit: '10^12/L', factors: {} },
  HGB:     { unit: 'g/L',     factors: { 'g/dL': 10 } },
  PLT:     { unit: '10^9/L',  factors: {} },
  'NEUT%': { unit: '%',       factors: {} },
  'LYMPH%': { unit: '%',      factors: {} },
  'MONO%': { unit: '%',       factors: {} },
  CRP:     { unit: 'mg/L',    factors: { 'mg/dL': 10 } },
  GLU:     { unit: 'mmol/L',  factors: { 'mg/dL': 0.05551 } },
  HbA1c:   { unit: '%',       factors: {} },
  TC:      { unit: 'mmol/L',  factors: { 'mg/dL': 0.02586 } },
  TG:      { unit: 'mmol/L',  factors: { 'mg/dL': 0.01129 } },
  'LDL-C': { unit: 'mmol/L',  factors: { 'mg/dL': 0.02586 } },
  'HDL-C': { unit: 'mmol/L',  factors: { 'mg/dL': 0.02586 } },
  ALT:     { unit: 'U/L',     factors: { 'IU/L': 1 } },
  AST:     { unit: 'U/L',     factors: { 'IU/L': 1 } },
  TBIL:    { unit: 'μmol/L',  factors: { 'mg/dL': 17.1 } },
  ALB:     { unit: 'g/L',     factors: { 'g/dL': 10 } },
  CREA:    { unit: 'μmol/L',  factors: { 'mg/dL': 88.4 } },
  UREA:    { unit: 'mmol/L',  factors: { 'mg/dL': 0.357 } },
  UA:      { unit: 'μmol/L',  factors: { 'mg/dL': 59.48 } },
  HCY:     { unit: 'μmol/L',  factors: {} },
  TSH:     { unit: 'mIU/L',   factors: {} },
  FT4:     { unit: 'pmol/L',  factors: { 'ng/dL': 12.87 } },
  K:       { unit: 'mmol/L',  factors: { 'mEq/L': 1 } },
  Na:      { unit: 'mmol/L',  factors: { 'mEq/L': 1 } },
  Ca:      { unit: 'mmol/L',  factors: { 'mEq/L': 0.5 } }
};

// Superscript digits appear in real reports as 10⁹/L; they mean the same as
// 10^9/L and must not become a second, silently different unit.
const SUPERSCRIPTS = {
  '⁰': '^0', '¹': '^1', '²': '^2', '³': '^3', '⁴': '^4',
  '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9'
};

// "10⁹/L", "10^9/L", "10^9/l", "×10^9/L" all become "10^9/L".
// Only the shape is normalised here — no number is touched.
export function normaliseUnitName(unit) {
  if (typeof unit !== 'string') return '';
  return unit
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, ch => SUPERSCRIPTS[ch])
    .replace(/[×✕✖*]/g, '')
    .replace(/\s+/g, '')
    .replace(/(\/|d)[lL]$/, m => (m[0] === '/' ? '/L' : 'dL'))
    .trim();
}

// Comparison key: the same normalisation, case-folded. Kept separate from
// normaliseUnitName because the stored/displayed form should keep its case
// (mmol is not mol) while matching should not.
function unitKey(unit) {
  return normaliseUnitName(unit).toUpperCase();
}

export function canonicalUnit(indicator) {
  const entry = TABLE[String(indicator ?? '').trim()];
  return entry ? entry.unit : null;
}

function round(value) {
  // 11.8 * 10 is 118.00000000000001 in binary floating point, and a stored
  // value of 118.00000000000001 reads like a precision the report never had.
  return Math.round(value * 1e4) / 1e4;
}

// convert('HGB', 11.8, 'g/dL') -> { ok: true, value: 118, unit: 'g/L' }
// convert('HGB', 11.8, 'foo')  -> { ok: false, accepted: ['g/L', 'g/dL'] }
//
// A rejected unit returns no value on purpose: the caller must not be able to
// store something that looks converted when it was not.
export function convert(indicator, value, unit) {
  const entry = TABLE[String(indicator ?? '').trim()];
  if (!entry) {
    return { ok: false, reason: 'no conversion table for this indicator', accepted: [] };
  }

  const accepted = [entry.unit, ...Object.keys(entry.factors)];
  const key = unitKey(unit);
  if (!key) {
    return { ok: false, reason: 'no unit given', accepted };
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return { ok: false, reason: 'value is not a number', accepted };
  }

  if (key === unitKey(entry.unit)) {
    // Already canonical: return it untouched. Converting twice is the bug.
    return { ok: true, value: round(number), unit: entry.unit, unitOriginal: normaliseUnitName(unit) };
  }

  const alias = Object.entries(entry.factors).find(([name]) => unitKey(name) === key);
  if (!alias) {
    return { ok: false, reason: `unit "${String(unit)}" is not in the table`, accepted };
  }

  return {
    ok: true,
    value: round(number * alias[1]),
    unit: entry.unit,
    unitOriginal: normaliseUnitName(unit)
  };
}

// Works on a whole entry rather than a bare number, because the reference
// range printed on the report is in the same unit as the reading. Converting
// the value to g/L while leaving a 11.0-16.0 g/dL range alone would compare
// 118 against 16 and call every haemoglobin result high.
//
// `boundsAreCanonical` is true when the bounds did not come from the report
// but from BUILTIN_REFS, which are already in the canonical unit.
export function normaliseEntry(entry) {
  const indicator = String(entry?.indicator ?? '').trim();
  const unit = String(entry?.unit ?? '').trim();
  const refLow = entry?.refLow ?? null;
  const refHigh = entry?.refHigh ?? null;
  const value = entry?.value;

  // An entry that names no unit makes no claim that can be contradicted.
  // Inventing one would be worse than leaving it alone, so it passes through.
  if (!unit) {
    return { ok: true, value, unit: '', unitOriginal: '', refLow, refHigh, converted: false };
  }

  const out = convert(indicator, value, unit);

  // An indicator with no table cannot be checked either. Only a *stated* unit
  // that the table refuses is rejected, which is what AC4 asks for.
  if (!out.ok && !canonicalUnit(indicator)) {
    return { ok: true, value, unit, unitOriginal: normaliseUnitName(unit), refLow, refHigh, converted: false };
  }
  if (!out.ok) return out;

  if (entry?.boundsAreCanonical) {
    return { ...out, refLow, refHigh, converted: out.unit !== unitKey(unit) };
  }

  const move = bound => (bound == null ? null : convert(indicator, bound, unit).value ?? null);

  return { ...out, refLow: move(refLow), refHigh: move(refHigh), converted: true };
}
