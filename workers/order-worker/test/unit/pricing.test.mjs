import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeServerPricing, comparePricing, shippingFor } from '../../src/pricing.js';
import { AMMAN_AREA_PRICES } from '../../src/pricing-config.js';

const L = (q, p, index = 0) => ({ index, quantity: q, serverUnitPrice: p });

test('Amman areas: every area price copied from Checkout.tsx', () => {
  const expected = { a1: 1, a2: 1, a3: 1, a4: 1, a5: 1.5, a6: 1.5, a7: 2, a8: 1.5, a9: 2.5, a10: 2.5, a11: 2.5, a12: 2.5, a13: 2.5, a14: 2.5, other: 2 };
  assert.deepEqual(AMMAN_AREA_PRICES, expected);
  for (const [area, price] of Object.entries(expected)) {
    assert.equal(shippingFor({ citySlug: 'amman', ammanAreaId: area }, 'standard').shipping, price);
    assert.equal(shippingFor({ citySlug: 'amman', ammanAreaId: area }, 'fast').shipping, price + 1);
  }
});

test('outside Amman = 3.0; fast outside Amman is flagged and not surcharged', () => {
  for (const gov of ['zarqa', 'irbid', 'aqaba', 'karak']) {
    assert.equal(shippingFor({ citySlug: gov }, 'standard').shipping, 3);
  }
  const r = shippingFor({ citySlug: 'irbid' }, 'fast');
  assert.equal(r.shipping, 3);
  assert.deepEqual(r.warnings.map((w) => w.code), ['FAST_OUTSIDE_AMMAN']);
});

test('unknown Amman area / missing city => SHIPPING_UNKNOWN and pricing incomplete', () => {
  assert.equal(shippingFor({ citySlug: 'amman', ammanAreaId: 'zzz' }, 'standard').shipping, null);
  const p = computeServerPricing([L(1, 5)], { citySlug: '' }, 'standard');
  assert.equal(p.complete, false);
  assert.ok(p.warnings.some((w) => w.code === 'SHIPPING_UNKNOWN'));
});

test('volume discount 10% only when total quantity > 2 (Cart.tsx rule)', () => {
  const am = { citySlug: 'amman', ammanAreaId: 'a1' };
  assert.equal(computeServerPricing([L(2, 5)], am, 'standard').discount, 0);
  const p = computeServerPricing([L(2, 2.5), L(1, 3, 1)], am, 'standard');
  assert.equal(p.subtotal, 8);
  assert.equal(p.discount, 0.8);
  assert.equal(p.shipping, 1);
  assert.equal(p.total, 8.2);
});

test('no free-shipping rule is applied (pending business decision)', () => {
  const p = computeServerPricing([L(10, 5)], { citySlug: 'amman', ammanAreaId: 'a7' }, 'standard');
  assert.equal(p.subtotal, 50);
  assert.equal(p.shipping, 2);
});

test('unknown product price => PRICE_UNKNOWN, incomplete', () => {
  const p = computeServerPricing([L(1, null)], { citySlug: 'amman', ammanAreaId: 'a1' }, 'standard');
  assert.equal(p.complete, false);
  assert.ok(p.warnings.some((w) => w.code === 'PRICE_UNKNOWN'));
});

test('comparePricing: tolerance 0.01, reports differing fields', () => {
  const server = { subtotal: 8, discount: 0.8, shipping: 1, total: 8.2, complete: true };
  assert.deepEqual(comparePricing(server, { subtotal: 8, discountAmount: 0.8, shippingCost: 1, total: 8.2 }), []);
  assert.deepEqual(comparePricing(server, { subtotal: 8.005, discountAmount: 0.8, shippingCost: 1, total: 8.209 }), []);
  assert.deepEqual(comparePricing(server, { subtotal: 1, discountAmount: 0, shippingCost: 1, total: 2 }), ['subtotal', 'discountAmount', 'total']);
});
