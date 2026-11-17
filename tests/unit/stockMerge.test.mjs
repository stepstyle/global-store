// src/services/stockMerge.ts — the product editor never undoes a stock change made while it was open.
//   node --test tests/unit/stockMerge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeStockForSave, StaleStockError, STALE_STOCK_MESSAGE_AR } from '../../src/services/stockMerge.ts';

const v = (id, stock, label = id) => ({ id, label, stock, price: 1 });

test('THE BUG: editor opened with stock 10, an order delivered meanwhile (10 -> 7), admin edits only the name -> 7 is kept', () => {
  const baseline = { id: 'p1', name: 'old', stock: 10 };
  const current = { id: 'p1', name: 'old', stock: 7 };
  const form = { id: 'p1', name: 'new name', stock: 10 };
  const r = mergeStockForSave(form, baseline, current);
  assert.equal(r.ok, true);
  assert.equal(r.product.stock, 7);
  assert.equal(r.product.name, 'new name');
});

test('the admin changes the stock and nobody else did -> the admin value is saved', () => {
  const r = mergeStockForSave({ stock: 25 }, { stock: 10 }, { stock: 10 });
  assert.deepEqual(r, { ok: true, product: { stock: 25 } });
});

test('the admin changes the stock AND it changed meanwhile -> conflict, nothing saved', () => {
  const r = mergeStockForSave({ stock: 25 }, { stock: 10 }, { stock: 7 });
  assert.deepEqual(r, { ok: false, conflicts: ['stock'] });
});

test('variants: each variant independently (kept / admin value / conflict); new and removed variants follow the form', () => {
  const baseline = { stock: 0, variants: [v('red', 5), v('blue', 1), v('green', 4)] };
  const current = { stock: 0, variants: [v('red', 3), v('blue', 1), v('green', 2)] };
  // red untouched (keeps 3), blue changed by admin (9, server unchanged), green removed, yellow new
  const ok = mergeStockForSave({ stock: 0, variants: [v('red', 5), v('blue', 9), v('yellow', 6)] }, baseline, current);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.product.variants.map((x) => [x.id, x.stock]), [['red', 3], ['blue', 9], ['yellow', 6]]);
  // red changed by the admin while the server also changed it -> conflict
  const bad = mergeStockForSave({ stock: 0, variants: [v('red', 8, 'أحمر'), v('blue', 1)] }, baseline, current);
  assert.deepEqual(bad, { ok: false, conflicts: ['variant:أحمر'] });
});

test('new product (no current document) or no baseline: saved as typed', () => {
  assert.deepEqual(mergeStockForSave({ stock: 3 }, { stock: 1 }, null), { ok: true, product: { stock: 3 } });
  assert.deepEqual(mergeStockForSave({ stock: 3 }, null, { stock: 1 }), { ok: true, product: { stock: 3 } });
});

test('string / missing numbers are compared as numbers', () => {
  assert.equal(mergeStockForSave({ stock: '10' }, { stock: 10 }, { stock: 6 }).product.stock, 6);
  assert.equal(mergeStockForSave({ stock: 5 }, { stock: undefined }, { stock: undefined }).product.stock, 5);
});

test('StaleStockError carries the Arabic message shown to the admin', () => {
  const e = new StaleStockError(['stock']);
  assert.equal(e.message, STALE_STOCK_MESSAGE_AR);
  assert.match(e.message, /لم يُحفظ شيء/);
});
