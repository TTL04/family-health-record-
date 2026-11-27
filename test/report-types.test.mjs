import test from 'node:test';
import assert from 'node:assert/strict';

import { REPORT_CATEGORIES, reportTypeGuide } from '../lib/report-types.mjs';

test('report categories cover the major medical report types', () => {
  const cats = REPORT_CATEGORIES.map(c => c.category);
  assert.ok(cats.includes('检验报告'));
  assert.ok(cats.includes('影像报告'));
  assert.ok(cats.includes('超声报告'));
  assert.ok(cats.includes('心电图'));
  assert.ok(cats.includes('病理报告'));
  assert.ok(REPORT_CATEGORIES.length >= 5, '应覆盖至少五大类');
});

test('every category has examples', () => {
  for (const c of REPORT_CATEGORIES) {
    assert.ok(Array.isArray(c.examples) && c.examples.length > 0, `${c.category} 缺少示例`);
  }
});

test('reportTypeGuide renders a readable guide string', () => {
  const guide = reportTypeGuide();
  assert.ok(guide.includes('检验报告'));
  assert.ok(guide.includes('影像报告'));
  assert.ok(guide.includes('；'));
});
