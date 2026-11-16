// Pop-up message queue (src/services/toastQueue.ts) — node --test tests/unit/toastQueue.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addToast, removeToast, MAX_VISIBLE, toastDurationMs } from '../../src/services/toastQueue.ts';

test('unique ids even for messages added in the same millisecond', () => {
  let q = [];
  q = addToast(q, 'أ', 'info');
  q = addToast(q, 'ب', 'info');
  q = addToast(q, 'ج', 'error');
  assert.equal(new Set(q.map((t) => t.id)).size, 3);
});

test('StrictMode / double click: the same visible message is shown once', () => {
  let q = [];
  q = addToast(q, 'يرجى تصحيح الحقول', 'error');
  const again = addToast(q, 'يرجى تصحيح الحقول', 'error'); // effect ran twice / second click
  assert.equal(again, q, 'unchanged queue (no re-render)');
  assert.equal(addToast(q, '  يرجى تصحيح الحقول  ', 'error'), q, 'whitespace does not make it different');
  // same text, different kind -> a different message
  assert.equal(addToast(q, 'يرجى تصحيح الحقول', 'info').length, 2);
  // once closed, it may be shown again
  const closed = removeToast(q, q[0].id);
  assert.equal(addToast(closed, 'يرجى تصحيح الحقول', 'error').length, 1);
});

test(`at most ${MAX_VISIBLE} at a time, oldest dropped`, () => {
  let q = [];
  for (const m of ['1', '2', '3', '4', '5']) q = addToast(q, m, 'info');
  assert.deepEqual(q.map((t) => t.message), ['3', '4', '5']);
});

test('empty messages are ignored; removing an unknown id changes nothing', () => {
  const q = addToast([], 'نص', 'success');
  assert.equal(addToast(q, '', 'error'), q);
  assert.equal(addToast(q, null, 'error'), q);
  assert.equal(removeToast(q, 'nope'), q);
  assert.deepEqual(removeToast(q, q[0].id), []);
});

test('errors stay longer than other messages', () => {
  assert.ok(toastDurationMs('error') > toastDurationMs('success'));
  assert.equal(toastDurationMs('info'), toastDurationMs('success'));
});
