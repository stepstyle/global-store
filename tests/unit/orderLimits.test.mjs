// The checkout form's limits (src/services/orderLimits.ts) agree with the order Worker's validation
// (workers/order-worker/src/validate.js) at every boundary: at the limit both accept, one past it both refuse.
//   node --test tests/unit/orderLimits.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORDER_LIMITS as L, ORDER_EMAIL_RE, checkOrderLimits, sanitizeOrderLine } from '../../src/services/orderLimits.ts';
import { validateOrderInput } from '../../workers/order-worker/src/validate.js';

// a valid order exactly as Checkout builds it
const order = (over = {}) => ({
  id: 'ORD-ABCD1234-MXYZ01', userId: 'guest', status: 'new',
  items: [{ productId: 'p-simple', name: 'دفتر', price: 2.5, quantity: 2, image: 'https://example.invalid/a.jpg', selectedVariant: null }],
  subtotal: 5, discountAmount: 0, shippingCost: 3, total: 8, paymentMethod: 'cod', shippingMethodId: 'standard', shippingMethod: 'توصيل عادي',
  customerEmail: 'buyer@example.com', consents: { acceptedStorePolicies: true },
  address: { fullName: 'زبون اختبار', city: 'الزرقاء', street: 'شارع 1', phone: '+962791234567' },
  addressMeta: { country: 'Jordan', countryCode: 'JO', citySlug: 'zarqa', phoneDial: '+962', phoneLocal: '0791234567' },
  ...over,
});
const formOf = (o) => ({
  fullName: o.address.fullName, street: o.address.street, email: o.customerEmail, note: o.note || '', paymentMethod: o.paymentMethod,
  cliqRef: o.paymentDetails?.cliqReference || '', quantities: o.items.map((i) => i.quantity), total: o.total,
});
const worker = (o) => validateOrderInput(o);
const form = (o) => checkOrderLimits(formOf(o));
const lines = (n) => Array.from({ length: n }, (_, i) => ({ productId: `p-${i}`, name: 'x', price: 1, quantity: 1, selectedVariant: null }));

const CASES = [
  // [field, order at the limit, order one past the limit, worker field]
  ['fullName', order({ address: { ...order().address, fullName: 'ا'.repeat(L.nameMax) } }), order({ address: { ...order().address, fullName: 'ا'.repeat(L.nameMax + 1) } }), 'address.fullName'],
  ['streetAddress', order({ address: { ...order().address, street: 'ش'.repeat(L.streetMax) } }), order({ address: { ...order().address, street: 'ش'.repeat(L.streetMax + 1) } }), 'address.street'],
  ['note', order({ note: 'ن'.repeat(L.noteMax) }), order({ note: 'ن'.repeat(L.noteMax + 1) }), 'note'],
  ['cliqRef', order({ paymentMethod: 'cliq', paymentDetails: { cliqReference: 'R'.repeat(L.cliqRefMax), isPaid: false } }), order({ paymentMethod: 'cliq', paymentDetails: { cliqReference: 'R'.repeat(L.cliqRefMax + 1), isPaid: false } }), 'paymentDetails.cliqReference'],
  ['cart', order({ items: lines(L.linesMax) }), order({ items: lines(L.linesMax + 1) }), 'items'],
  ['quantity', order({ items: [{ ...order().items[0], quantity: L.qtyMax }] }), order({ items: [{ ...order().items[0], quantity: L.qtyMax + 1 }] }), 'items[0].quantity'],
  ['total', order({ total: L.moneyMax }), order({ total: L.moneyMax + 0.01 }), 'total'],
  ['email', order({ customerEmail: `${'a'.repeat(64)}@example.com` }), order({ customerEmail: `${'a'.repeat(65)}@example.com` }), 'customerEmail'],
];

for (const [field, atLimit, past, workerField] of CASES) {
  test(`limit parity: ${field} — at the limit both accept, one past both refuse`, () => {
    assert.equal(worker(atLimit).ok, true, `Worker refuses ${field} at the limit: ${worker(atLimit).field}`);
    assert.deepEqual(form(atLimit), [], `form refuses ${field} at the limit`);
    const w = worker(past);
    assert.equal(w.ok, false, `Worker accepts ${field} past the limit`);
    assert.equal(w.field, workerField);
    const f = form(past);
    assert.equal(f.length, 1);
    assert.equal(f[0].field, field);
    assert.match(f[0].ar, /[؀-ۿ]/, 'Arabic message');
  });
}

test('e-mail: the form uses exactly the Worker pattern (1-letter domain end and over-long addresses refused by both)', () => {
  for (const e of ['a@b.c', `${'a'.repeat(64)}@${'b'.repeat(191)}.com`, 'no-at.example.com', 'a b@example.com', `x@${'d'.repeat(250)}.com`]) {
    assert.equal(worker(order({ customerEmail: e })).ok, false, e);
    assert.equal(form(order({ customerEmail: e })).some((p) => p.field === 'email'), true, e);
  }
  for (const e of ['buyer@example.com', 'a.b+c@sub.example.jo', '']) {
    assert.equal(worker(order({ customerEmail: e })).ok, true, e);
    assert.equal(form(order({ customerEmail: e })).some((p) => p.field === 'email'), false, e);
  }
  assert.equal(ORDER_EMAIL_RE.source, /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.source);
});

test('store-data fields the customer cannot fix are trimmed so the Worker accepts the order', () => {
  const long = {
    productId: 'p-1', name: 'م'.repeat(L.itemNameMax + 50), price: 2, quantity: 1, image: 'data:image/png;base64,' + 'A'.repeat(5000),
    selectedVariant: { id: 'v1', label: 'ل'.repeat(500), type: 't'.repeat(50), colorCode: '#'.repeat(80), colorCode2: '#'.repeat(80), image: 'B'.repeat(3000), price: 2, stock: 3 },
  };
  assert.equal(worker(order({ items: [long] })).ok, false, 'unsanitized store data would be refused');
  const clean = sanitizeOrderLine(long);
  const w = worker(order({ items: [clean] }));
  assert.equal(w.ok, true, `refused: ${w.field}`);
  assert.equal(clean.name.length, L.itemNameMax);
  assert.equal(clean.image, '');
  assert.equal(clean.selectedVariant.id, 'v1', 'identity field untouched');
  assert.equal(clean.selectedVariant.label.length, L.variantLabelMax);
  assert.equal(clean.selectedVariant.image, '');
  // normal lines are unchanged
  const normal = { productId: 'p-2', name: 'دفتر', price: 2.5, quantity: 2, image: 'https://example.invalid/a.jpg', selectedVariant: { id: 'v', label: 'أحمر' } };
  assert.deepEqual(sanitizeOrderLine(normal), normal);
});

test('several problems are all reported, in form order', () => {
  const p = form(order({ address: { ...order().address, fullName: 'ا'.repeat(200) }, note: 'x'.repeat(700), items: lines(31) }));
  assert.deepEqual(p.map((x) => x.field), ['fullName', 'note', 'cart']);
});
