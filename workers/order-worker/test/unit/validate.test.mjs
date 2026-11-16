import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOrderInput, orderHash, ORDER_ID_RE } from '../../src/validate.js';
import { makeOrderId, makeOrderIdFallback, checkoutOrder, line } from '../fixtures.mjs';

test('10,000 ids from Checkout makeOrderId() (uuid + fallback branches) are accepted', () => {
  for (let i = 0; i < 5000; i++) {
    assert.match(makeOrderId(), ORDER_ID_RE);
    assert.match(makeOrderIdFallback(), ORDER_ID_RE);
  }
});

test('exact current Checkout payload is valid (COD and CliQ, guest and signed-in)', () => {
  for (const payment of ['cod', 'cliq']) {
    for (const userId of ['guest', 'AbCdEf0123456789xyzUID0001']) {
      const r = validateOrderInput(checkoutOrder({ payment, userId }));
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(r.strippedFields, []);
    }
  }
});

const bad = [
  ['id path traversal', { id: '../../config/roles' }, 'id'],
  ['id lowercase', { id: 'ORD-abcd1234-xyz' }, 'id'],
  ['id with slash', { id: 'ORD-ABCD/1234-XYZ1' }, 'id'],
  ['userId with slash', { userId: 'a/b' }, 'userId'],
  ['phone not Jordanian mobile', { address: { fullName: 'X Y Z W', phone: '+1555123456', city: '', street: '' } }, 'address.phone'],
  ['total as string', { total: '0' }, 'total'],
  ['negative total', { total: -1 }, 'total'],
  ['payment method card', { paymentMethod: 'card' }, 'paymentMethod'],
  ['note too long', { note: 'x'.repeat(601) }, 'note'],
  ['unknown governorate', { addressMeta: { citySlug: 'paris' } }, 'addressMeta.citySlug'],
  ['shipping method express', { shippingMethodId: 'express' }, 'shippingMethodId'],
  ['no items', { items: [] }, 'items'],
  ['31 items', { items: Array.from({ length: 31 }, () => line('p-simple', 1)) }, 'items'],
];
for (const [name, overrides, field] of bad) {
  test(`rejects: ${name}`, () => {
    const r = validateOrderInput(checkoutOrder({ overrides }));
    assert.equal(r.ok, false);
    assert.equal(r.field, field);
  });
}

for (const q of [0, -1, 1.5, 100, 999999, '2']) {
  test(`rejects quantity ${JSON.stringify(q)}`, () => {
    const r = validateOrderInput(checkoutOrder({ items: [{ ...line('p-simple', 1), quantity: q }] }));
    assert.equal(r.ok, false);
    assert.equal(r.field, 'items[0].quantity');
  });
}

test('rejects product id with slash / dot segments; accepts CSV free-text ids', () => {
  assert.equal(validateOrderInput(checkoutOrder({ items: [{ ...line('p-simple', 1), productId: 'a/b' }] })).ok, false);
  assert.equal(validateOrderInput(checkoutOrder({ items: [{ ...line('p-simple', 1), productId: '..' }] })).ok, false);
  assert.equal(validateOrderInput(checkoutOrder({ items: [{ ...line('p-simple', 1), productId: 'CSV 001 دفتر' }] })).ok, true);
});

test('CliQ without reference is rejected', () => {
  const o = checkoutOrder({ payment: 'cliq' });
  o.paymentDetails = { cliqReference: '  ', isPaid: false };
  assert.equal(validateOrderInput(o).field, 'paymentDetails.cliqReference');
});

test('injected fields are stripped and reported (never copied)', () => {
  const r = validateOrderInput(checkoutOrder({ overrides: { isVerified: true, fraudReason: 'x', systemNote: 'y' } }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.strippedFields.sort(), ['fraudReason', 'isVerified', 'systemNote']);
  assert.equal('isVerified' in r.value, false);
});

test('hash: identical for request vs stored document (Dates, extra server fields)', async () => {
  const o = checkoutOrder({ id: 'ORD-ABCD1234-HASH01' });
  const stored = { ...o, createdAt: new Date(), updatedAt: new Date(), workerCheck: { x: 1 }, source: 'worker-v2' };
  const a = await orderHash(validateOrderInput(o).value);
  const b = await orderHash(validateOrderInput(stored).value);
  assert.equal(a, b);
});

test('hash changes when any identity field changes', async () => {
  const base = checkoutOrder({ id: 'ORD-ABCD1234-HASH02' });
  const h = async (o) => orderHash(validateOrderInput(o).value);
  const h0 = await h(base);
  const variants = [
    { ...base, userId: 'someoneElse01' },
    { ...base, address: { ...base.address, phone: '+962781111111' } },
    { ...base, total: base.total + 1 },
    { ...base, items: [{ ...base.items[0], quantity: 3 }, base.items[1]] },
    { ...base, items: [base.items[0], { ...base.items[1], selectedVariant: { ...base.items[1].selectedVariant, id: 'var_blue' } }] },
    { ...base, paymentMethod: 'cliq', paymentDetails: { cliqReference: 'r', isPaid: false } },
    { ...base, addressMeta: { ...base.addressMeta, ammanAreaId: 'a7' } },
  ];
  for (const v of variants) assert.notEqual(await h(v), h0);
});
