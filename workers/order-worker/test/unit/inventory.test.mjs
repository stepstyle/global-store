import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planInventory } from '../../src/inventory.js';
import { encodeFields, decodeFields } from '../../src/firestore.js';
import { PRODUCTS, CSV_PRODUCT_ID } from '../fixtures.mjs';

const doc = (id) => ({ exists: true, fields: encodeFields(PRODUCTS[id]), updateTime: '2026-11-03T00:00:00.000000Z' });
const products = (...ids) => new Map(ids.map((id) => [id, doc(id)]));
const ln = (index, productId, quantity, variantId = null) => ({ index, productId, quantity, variantId });
const codes = (r) => r.warnings.map((w) => w.code);
const written = (r, pid) => {
  const w = r.writes.find((x) => x.productId === pid);
  return w ? { ...decodeFields(w.fields), mask: w.mask } : null;
};

test('A: product without variants field -> top-level stock', () => {
  const r = planInventory([ln(0, 'p-simple', 2)], products('p-simple'), 'apply');
  assert.deepEqual(codes(r), []);
  assert.deepEqual(written(r, 'p-simple'), { stock: 8, mask: ['stock'] });
  assert.equal(r.lineInfo[0].serverUnitPrice, 2.5);
});

test('B: empty variants array -> top-level stock', () => {
  const r = planInventory([ln(0, 'p-empty-variants', 5)], products('p-empty-variants'), 'apply');
  assert.deepEqual(written(r, 'p-empty-variants'), { stock: 0, mask: ['stock'] });
});

test('C: variant -> only that variant stock; top-level stock and other variant untouched; all fields preserved', () => {
  const before = doc('p-variants').fields.variants.arrayValue.values;
  const r = planInventory([ln(0, 'p-variants', 2, 'var_red')], products('p-variants'), 'apply');
  const w = r.writes[0];
  assert.deepEqual(w.mask, ['variants']);
  assert.equal('stock' in w.fields, false, 'top-level stock must not be written');
  const after = w.fields.variants.arrayValue.values;
  // red: only stock changed, every other raw field byte-identical
  const { stock: s0, ...red0 } = before[0].mapValue.fields;
  const { stock: s1, ...red1 } = after[0].mapValue.fields;
  assert.deepEqual(red1, red0);
  assert.deepEqual(s1, { integerValue: '3' });
  // blue untouched entirely
  assert.deepEqual(after[1], before[1]);
  assert.equal(r.lineInfo[0].serverUnitPrice, 3);
});

test('C: variant price comes from the product document, not the cart', () => {
  const r = planInventory([ln(0, 'p-variants', 1, 'var_blue')], products('p-variants'), 'apply');
  assert.equal(r.lineInfo[0].serverUnitPrice, 3.5);
});

test('D/E: label "." and unnamed colour variants are matched by id', () => {
  const r = planInventory([ln(0, 'p-dot-label', 1, 'var_dot'), ln(1, 'p-unnamed-color', 2, 'var_x')], products('p-dot-label', 'p-unnamed-color'), 'apply');
  assert.deepEqual(codes(r), []);
  assert.equal(written(r, 'p-dot-label').variants[0].stock, 2);
  assert.equal(written(r, 'p-unnamed-color').variants[0].stock, 0);
});

test('F: CSV free-text product id', () => {
  const r = planInventory([ln(0, CSV_PRODUCT_ID, 3)], products(CSV_PRODUCT_ID), 'apply');
  assert.deepEqual(written(r, CSV_PRODUCT_ID), { stock: 4, mask: ['stock'] });
});

test('two variants of the same product -> one write containing both deductions', () => {
  const r = planInventory([ln(0, 'p-variants', 1, 'var_red'), ln(1, 'p-variants', 1, 'var_blue')], products('p-variants'), 'apply');
  assert.equal(r.writes.length, 1);
  const v = written(r, 'p-variants').variants;
  assert.equal(v[0].stock, 4);
  assert.equal(v[1].stock, 0);
});

test('same variant on two lines accumulates', () => {
  const r = planInventory([ln(0, 'p-variants', 2, 'var_red'), ln(1, 'p-variants', 3, 'var_red')], products('p-variants'), 'apply');
  assert.equal(written(r, 'p-variants').variants[0].stock, 0);
});

test('shortfall on any line -> NOTHING in the order is deducted (no partial deduction)', () => {
  const r = planInventory([ln(0, 'p-simple', 1), ln(1, 'p-variants', 2, 'var_blue')], products('p-simple', 'p-variants'), 'apply');
  assert.ok(codes(r).includes('STOCK_SHORTFALL'));
  assert.ok(codes(r).includes('STOCK_NOT_DEDUCTED'));
  assert.equal(r.writes.length, 0);
  assert.ok(r.deductions.every((d) => d.applied === false));
});

test('accumulated shortfall on the same variant is detected', () => {
  const r = planInventory([ln(0, 'p-variants', 3, 'var_red'), ln(1, 'p-variants', 3, 'var_red')], products('p-variants'), 'apply');
  assert.ok(codes(r).includes('STOCK_SHORTFALL'));
  assert.equal(r.writes.length, 0);
});

test('numeric-string stock is deducted and written back as a number', () => {
  const r = planInventory([ln(0, 'p-string-stock', 2)], products('p-string-stock'), 'apply');
  assert.ok(codes(r).includes('STOCK_STRING_NORMALIZED'));
  assert.deepEqual(r.writes[0].fields.stock, { integerValue: '6' });
});

test('missing stock -> STOCK_UNTRACKED, no write', () => {
  const r = planInventory([ln(0, 'p-no-stock', 1)], products('p-no-stock'), 'apply');
  assert.deepEqual(codes(r), ['STOCK_UNTRACKED']);
  assert.equal(r.writes.length, 0);
});

test('duplicate variant id -> DUPLICATE_VARIANT_ID, no write', () => {
  const r = planInventory([ln(0, 'p-dup-variant', 1, 'var_dup')], products('p-dup-variant'), 'apply');
  assert.deepEqual(codes(r), ['DUPLICATE_VARIANT_ID']);
  assert.equal(r.writes.length, 0);
});

test('variant product but cart line has no variant id -> AMBIGUOUS_VARIANT, no write', () => {
  const r = planInventory([ln(0, 'p-variant-no-id', 1, null)], products('p-variant-no-id'), 'apply');
  assert.deepEqual(codes(r), ['AMBIGUOUS_VARIANT']);
  assert.equal(r.writes.length, 0);
});

test('variant id not on product -> VARIANT_NOT_FOUND; product missing -> PRODUCT_NOT_FOUND', () => {
  const r1 = planInventory([ln(0, 'p-variants', 1, 'var_ghost')], products('p-variants'), 'apply');
  assert.deepEqual(codes(r1), ['VARIANT_NOT_FOUND']);
  const r2 = planInventory([ln(0, 'p-gone', 1)], new Map([['p-gone', { exists: false }]]), 'apply');
  assert.deepEqual(codes(r2), ['PRODUCT_NOT_FOUND']);
  assert.equal(r2.lineInfo[0].serverUnitPrice, null);
});

test('variant id sent for a product without variants -> VARIANT_NOT_FOUND, no write', () => {
  const r = planInventory([ln(0, 'p-simple', 1, 'var_red')], products('p-simple'), 'apply');
  assert.deepEqual(codes(r), ['VARIANT_NOT_FOUND']);
  assert.equal(r.writes.length, 0);
});

test('STOCK_MODE=log records deductions but writes nothing; off does neither', () => {
  const log = planInventory([ln(0, 'p-simple', 2)], products('p-simple'), 'log');
  assert.equal(log.writes.length, 0);
  assert.equal(log.deductions[0].applied, false);
  const off = planInventory([ln(0, 'p-simple', 2)], products('p-simple'), 'off');
  assert.equal(off.writes.length, 0);
  assert.equal(off.deductions.length, 0);
  assert.equal(off.lineInfo[0].serverUnitPrice, 2.5);
});
