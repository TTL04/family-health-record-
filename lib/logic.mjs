// Pure domain logic shared by the server, the browser pages and the tests.
// No imports — this file must run in Node and in the browser unchanged.
// Browser pages reach it through the /logic.mjs static route.

export const DISCLAIMER = '本应用只整理和展示报告，不构成医疗意见，解读结果请以医生为准。';

// Builtin reference ranges for common lab items.
// Used ONLY when the report itself does not print a range —
// ranges printed on the report always win.
export const BUILTIN_REFS = [
  { re: /白细胞计数|白细胞|WBC/i,          display: 'WBC',    low: 3.5,   high: 9.5,    unit: '10^9/L' },
  { re: /红细胞计数|红细胞|RBC/i,          display: 'RBC',    low: 3.8,   high: 5.8,    unit: '10^12/L' },
  { re: /血红蛋白|HGB|Hb\b/i,             display: 'HGB',    low: 115,   high: 175,    unit: 'g/L' },
  { re: /血小板计数|血小板|PLT/i,          display: 'PLT',    low: 125,   high: 350,    unit: '10^9/L' },
  { re: /中性粒细胞百分比|NEUT%/i,         display: 'NEUT%',  low: 40,    high: 75,     unit: '%' },
  { re: /淋巴细胞百分比|LYMPH%/i,          display: 'LYMPH%', low: 20,    high: 50,     unit: '%' },
  { re: /单核细胞百分比|MONO%/i,           display: 'MONO%',  low: 3,     high: 10,     unit: '%' },
  { re: /C反应蛋白|CRP/i,                 display: 'CRP',    low: 0,     high: 10,     unit: 'mg/L' },
  { re: /空腹血糖|血糖|葡萄糖|GLU/i,        display: 'GLU',    low: 3.9,   high: 6.1,    unit: 'mmol/L' },
  { re: /糖化血红蛋白|HbA1c/i,             display: 'HbA1c',  low: 4.0,   high: 6.0,    unit: '%' },
  { re: /总胆固醇|TC\b|CHOL/i,            display: 'TC',     low: 2.8,   high: 5.2,    unit: 'mmol/L' },
  { re: /甘油三酯|TG\b/i,                 display: 'TG',     low: 0.45,  high: 1.7,    unit: 'mmol/L' },
  { re: /低密度脂蛋白|LDL/i,              display: 'LDL-C',  low: 0,     high: 3.4,    unit: 'mmol/L' },
  { re: /高密度脂蛋白|HDL/i,              display: 'HDL-C',  low: 1.0,   high: 1.6,    unit: 'mmol/L' },
  { re: /谷丙转氨酶|ALT\b/i,              display: 'ALT',    low: 9,     high: 50,     unit: 'U/L' },
  { re: /谷草转氨酶|AST\b/i,              display: 'AST',    low: 15,    high: 40,     unit: 'U/L' },
  { re: /总胆红素|TBIL|T-BIL/i,           display: 'TBIL',   low: 3.4,   high: 20.5,   unit: 'μmol/L' },
  { re: /白蛋白(?!\/球蛋白)|ALB\b/i,       display: 'ALB',    low: 40,    high: 55,     unit: 'g/L' },
  { re: /肌酐|CREA|Cr\b/i,                display: 'CREA',   low: 41,    high: 111,    unit: 'μmol/L' },
  { re: /尿素氮|尿素|BUN/i,               display: 'UREA',   low: 2.9,   high: 8.2,    unit: 'mmol/L' },
  { re: /尿酸|UA\b/i,                     display: 'UA',     low: 155,   high: 428,    unit: 'μmol/L' },
  { re: /同型半胱氨酸|HCY/i,              display: 'HCY',    low: 0,     high: 15,     unit: 'μmol/L' },
  { re: /促甲状腺激素|TSH/i,              display: 'TSH',    low: 0.27,  high: 4.2,    unit: 'mIU/L' },
  { re: /游离甲状腺素|游离T4|FT4/i,        display: 'FT4',    low: 12,    high: 22,     unit: 'pmol/L' },
  { re: /血钾|血钾离子|钾离子|K\+\s*$|血清钾/i, display: 'K',  low: 3.5,   high: 5.3,    unit: 'mmol/L' },
  { re: /血钠|钠离子|Na\+\s*$|血清钠/i,     display: 'Na',    low: 137,   high: 147,    unit: 'mmol/L' },
  { re: /血钙|钙离子|血清钙/i,             display: 'Ca',     low: 2.11,  high: 2.52,   unit: 'mmol/L' }
];

export function lookupBuiltin(name) {
  if (typeof name !== 'string' || !name.trim()) return null;
  return BUILTIN_REFS.find(entry => entry.re.test(name)) || null;
}

// "3.5-9.5" / "3.5~9.5" / "<10" / "≤10" / ">5" / "≥5" → { low, high }
export function parseRefText(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim().replace(/[～–—~]/g, '-').replace(/[≤</]/g, '<').replace(/[≥>]/g, '>');
  let m = t.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { low: Number(m[1]), high: Number(m[2]) };
  m = t.match(/^<\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { low: null, high: Number(m[1]) };
  m = t.match(/^>\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { low: Number(m[1]), high: null };
  return null;
}

// Accept both the new shape (refLow/refHigh) and the legacy shape (low/high)
// so the original US-07 fixtures keep working.
export function bounds(item) {
  return [item.refLow ?? item.low ?? null, item.refHigh ?? item.high ?? null];
}

export function isAbnormal(item) {
  const [low, high] = bounds(item);
  if (low != null && item.value < low) return true;
  if (high != null && item.value > high) return true;
  return false;
}

export function direction(item) {
  const [low, high] = bounds(item);
  if (high != null && item.value > high) return 'high';
  if (low != null && item.value < low) return 'low';
  return 'normal';
}

export function referenceText(item) {
  if (item.refText) return item.refText;
  const [low, high] = bounds(item);
  if (low != null && high != null) return `${low} - ${high}`;
  if (high != null) return `≤ ${high}`;
  if (low != null) return `≥ ${low}`;
  return '—';
}

export function abnormalCount(items) {
  return items.filter(isAbnormal).length;
}

export function sortReports(reports) {
  return [...reports].sort((a, b) =>
    String(b.collectedAt).localeCompare(String(a.collectedAt)) ||
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  );
}

// Rule-based plain-language explanation, used when no LLM is configured.
// prev: { value, unit, collectedAt } from the previous report, or null.
export function explainText(item, prev) {
  const [low, high] = bounds(item);
  const unit = item.unit ? ` ${item.unit}` : '';
  const ref = referenceText(item);
  const dir = direction(item);

  let s = `${item.name}本次为 ${item.value}${unit}`;
  if (dir === 'normal') s += `，在参考范围${ref === '—' ? '' : `（${ref}）`}内`;
  else s += `，${dir === 'high' ? '高于' : '低于'}参考范围${ref === '—' ? '' : `（${ref}）`}`;
  s += '。';

  if (prev && Number.isFinite(prev.value)) {
    const pUnit = prev.unit ? ` ${prev.unit}` : '';
    const delta = prev.value !== 0 ? (item.value - prev.value) / Math.abs(prev.value) : null;
    let change = '与上次基本持平';
    if (delta != null && Math.abs(delta) > 0.05) {
      change = `${item.value > prev.value ? '比上次升高' : '比上次下降'}约 ${Math.round(Math.abs(delta) * 100)}%`;
    }
    s += `上次（${prev.collectedAt || '上次'}）为 ${prev.value}${pUnit}，${change}。`;
  }

  s += '单看这一项不能说明问题，请结合症状和其他检查，由医生综合判断。';
  return s;
}
