import test from 'node:test';
import assert from 'node:assert/strict';

import { validatePhoto, PHOTO_RULES } from '../lib/photo.mjs';

test('US-02 a normal JPG is accepted with its extension', () => {
  const verdict = validatePhoto({ mime: 'image/jpeg', bytes: 2 * 1024 * 1024 });
  assert.deepEqual(verdict, { ok: true, ext: 'jpg' });
});

test('US-02 the size limit is the 2 MB stated in the acceptance criterion', () => {
  assert.equal(PHOTO_RULES.maxBytes, 2 * 1024 * 1024);
});

test('US-02 a file one byte over the limit is rejected', () => {
  const verdict = validatePhoto({ mime: 'image/jpeg', bytes: 2 * 1024 * 1024 + 1 });
  assert.equal(verdict.ok, false);
});

test('US-02 an oversized file is rejected with a reason', () => {
  const verdict = validatePhoto({ mime: 'image/jpeg', bytes: PHOTO_RULES.maxBytes + 1 });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /MB/);
});

test('US-02 an unsupported file type is rejected with a reason', () => {
  const verdict = validatePhoto({ mime: 'video/mp4', bytes: 1024 });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /只支持/);
});

test('an empty file is rejected', () => {
  const verdict = validatePhoto({ mime: 'image/png', bytes: 0 });
  assert.equal(verdict.ok, false);
});

test('PDF is accepted for archiving', () => {
  const verdict = validatePhoto({ mime: 'application/pdf', bytes: 1024 });
  assert.deepEqual(verdict, { ok: true, ext: 'pdf' });
});
