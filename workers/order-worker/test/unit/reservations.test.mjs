// src/reservations.js — pure planning of logical reservations (STOCK_POLICY=on_delivery). No I/O.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFields, decodeFields } from '../../src/firestore.js';
import { planReservation, reservationWrites, reservedOf, resolveLine } from '../../src/reservations.js';

const doc = (data, updateTime = '2026-01-01T00:00:00Z') => ({ exists: true, fields: encodeFields(data), updateTime });
const none = { exists: false };
const fs = { name: (p) => `projects/x/databases/(default)/documents/${p}` };
const P = new Map([
  ['simple', doc({ stock: 3 })],
  ['var', doc({ stock: 0, variants: [{ id: 'red', stock: 2 }, { id: 'blue', stock: 1 }] })],
  ['str', doc({ stock: '4' })],
  ['nostock', doc({ name: 'x' })],
  ['dup', doc({ stock: 0, variants: [{ id: 'd', stock: 4 }, { id: 'd', stock: 4 }] })],
]);
const L = (index, productId, quantity, variantId = null) => ({ index, productId, quantity, variantId });

test('resolveLine follows inventory.js: simple / variant / numeric string / untracked / missing / ambiguous', () => {
  assert.deepEqual(resolveLine(L(0, 'simple', 1), P.get('simple')), { stock: 3 });
  assert.deepEqual(resolveLine(L(0, 'var', 1, 'red'), P.get('var')), { stock: 2 });
  assert.deepEqual(resolveLine(L(0, 'str', 1), P.get('str')), { stock: 4 });
  assert.equal(resolveLine(L(0, 'nostock', 1), P.get('nostock')).warning, 'STOCK_UNTRACKED');
  assert.equal(resolveLine(L(0, 'gone', 1), none).warning, 'PRODUCT_NOT_FOUND');
  assert.equal(resolveLine(L(0, 'var', 1), P.get('var')).warning, 'AMBIGUOUS_VARIANT');
  assert.equal(resolveLine(L(0, 'var', 1, 'green'), P.get('var')).warning, 'VARIANT_NOT_FOUND');
  assert.equal(resolveLine(L(0, 'dup', 1, 'd'), P.get('dup')).warning, 'DUPLICATE_VARIANT_ID');
});

test('available = stock - reserved; same product on two lines is summed; nothing reserved when one line is short', () => {
  const R = new Map([['simple', doc({ productId: 'simple', product: 1, variants: {} })]]);
  const ok = planReservation([L(0, 'simple', 1), L(1, 'simple', 1)], P, R);
  assert.deepEqual(ok.shortfalls, []);
  assert.deepEqual(ok.reservations, [{ productId: 'simple', variantId: null, qty: 2 }]);
  const short = planReservation([L(0, 'simple', 2), L(1, 'simple', 1), L(2, 'var', 1, 'red')], P, R);
  assert.deepEqual(short.reservations, [], 'no partial reservation');
  assert.deepEqual(short.shortfalls.map((s) => [s.index, s.available, s.requested]), [[0, 2, 3], [1, 2, 3]]);
});

test('the last piece: reserved once, a second order sees 0 available', () => {
  const R = new Map();
  const first = planReservation([L(0, 'var', 1, 'blue')], P, R);
  assert.deepEqual(first.shortfalls, []);
  const w = reservationWrites(fs, first.reservations, R, +1);
  assert.equal(w.writes.length, 1);
  assert.deepEqual(w.writes[0].currentDocument, { exists: false }, 'first reservation of a product: create-only precondition');
  const after = new Map([['var', { exists: true, fields: w.writes[0].update.fields, updateTime: 't2' }]]);
  assert.equal(reservedOf(after.get('var'), 'blue'), 1);
  const second = planReservation([L(0, 'var', 1, 'blue')], P, after);
  assert.deepEqual(second.shortfalls.map((s) => s.available), [0]);
});

test('untracked / unknown lines are neither reserved nor refused (same as inventory.js never deducting them)', () => {
  const r = planReservation([L(0, 'nostock', 50), L(1, 'gone', 2), L(2, 'simple', 1)], P, new Map());
  assert.deepEqual(r.shortfalls, []);
  assert.deepEqual(r.reservations, [{ productId: 'simple', variantId: null, qty: 1 }]);
  assert.deepEqual(r.warnings.map((w) => w.code), ['STOCK_UNTRACKED', 'PRODUCT_NOT_FOUND']);
});

test('release gives back exactly the reserved quantities, preconditioned on the read version, never below 0', () => {
  const R = new Map([['var', doc({ productId: 'var', product: 0, variants: { red: 2, blue: 1 } }, 'T1')]]);
  const rel = reservationWrites(fs, [{ productId: 'var', variantId: 'red', qty: 2 }], R, -1);
  assert.deepEqual(rel.warnings, []);
  assert.deepEqual(rel.writes[0].currentDocument, { updateTime: 'T1' });
  assert.deepEqual(decodeFields(rel.writes[0].update.fields).variants, { blue: 1 });
  const under = reservationWrites(fs, [{ productId: 'var', variantId: 'blue', qty: 5 }], R, -1);
  assert.equal(under.warnings[0].code, 'RESERVATION_UNDERFLOW');
  assert.deepEqual(decodeFields(under.writes[0].update.fields).variants, { red: 2 });
});
