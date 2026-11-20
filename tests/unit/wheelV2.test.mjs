// Prize wheel v2 — browser side (pure parts): segment landing, prize effect == the Worker's numbers, Google gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetRotation, segmentAt, prizeEffect, prizeText, slotOf, spinOf, usablePrize, WHEEL_ENABLED } from '../../src/services/wheel.ts';
import { googleOutcome, hasGoogleSession, googleMessage, saveCheckoutResume, takeCheckoutResume, RESUME_KEY } from '../../src/services/googleGate.ts';
import { computeServerPricing, comparePricing } from '../../workers/order-worker/src/pricing.js';
import { slotShares, newSlotId } from '../../src/services/wheelAdmin.ts';

test('the wheel always stops INSIDE the segment the Worker drew (every count, index, start angle, jitter)', () => {
  for (const count of [2, 3, 5, 8, 12, 15, 24]) {
    for (let index = 0; index < count; index++) {
      for (const start of [0, 17, 359.5, 1234.5, -90]) {
        for (const jitter of [-0.35, -0.1, 0, 0.2, 0.35, 0.9, -0.9]) {
          const r = targetRotation(start, index, count, 6, jitter);
          assert.equal(segmentAt(r, count), index, `count ${count} index ${index} start ${start} jitter ${jitter}`);
          assert.ok(r >= start + 6 * 360, 'always turns forward several times');
        }
      }
    }
  }
});

test('prize effect: minimum on the products before the prize; 14.99 vs 15.00; second order needs a delivered order; expired / used = nothing', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  const watch = { type: 'gift', valueJod: 9, minOrderJod: 15, appliesTo: 'this_order', status: 'issued', expiresAt: '2026-07-01T00:00:00Z' };
  assert.deepEqual(prizeEffect(watch, { subtotal: 14.99, volumeDiscount: 0, shippingCost: 1, previousDelivered: null }, now), { state: 'below_min', minOrderJod: 15, missingJod: 0.01 });
  assert.equal(prizeEffect(watch, { subtotal: 15, volumeDiscount: 0, shippingCost: 1, previousDelivered: null }, now).state, 'applies');
  const d1 = { type: 'discount', valueJod: 1, minOrderJod: 5, appliesTo: 'this_order', status: 'issued', expiresAt: null };
  assert.equal(prizeEffect(d1, { subtotal: 4.99, volumeDiscount: 0, shippingCost: 1, previousDelivered: null }, now).state, 'below_min');
  assert.deepEqual(prizeEffect(d1, { subtotal: 5, volumeDiscount: 0, shippingCost: 1, previousDelivered: null }, now), { state: 'applies', discountJod: 1, shippingWaivedJod: 0 });
  const second = { ...d1, valueJod: 4, minOrderJod: 15, appliesTo: 'next_order' };
  assert.equal(prizeEffect(second, { subtotal: 20, volumeDiscount: 0, shippingCost: 1, previousDelivered: false }, now).state, 'needs_previous_order');
  assert.equal(prizeEffect(second, { subtotal: 20, volumeDiscount: 0, shippingCost: 1, previousDelivered: null }, now).state, 'needs_previous_order');
  assert.equal(prizeEffect(second, { subtotal: 20, volumeDiscount: 0, shippingCost: 1, previousDelivered: true }, now).state, 'applies');
  assert.equal(prizeEffect({ ...d1, status: 'reserved' }, { subtotal: 50, volumeDiscount: 0, shippingCost: 1, previousDelivered: true }, now).state, 'unavailable');
  assert.equal(prizeEffect({ ...d1, expiresAt: '2026-05-31T00:00:00Z' }, { subtotal: 50, volumeDiscount: 0, shippingCost: 1, previousDelivered: true }, now).state, 'unavailable');
  const ship = { type: 'free_delivery', valueJod: 2, minOrderJod: 5, appliesTo: 'this_order', status: 'issued', expiresAt: null };
  assert.deepEqual(prizeEffect(ship, { subtotal: 8, volumeDiscount: 0, shippingCost: 3, previousDelivered: null }, now), { state: 'applies', discountJod: 0, shippingWaivedJod: 2 });
});

test('the numbers the browser sends equal the Worker\'s (2000 random carts, every prize type) — never a false PRICE_CHANGED, never below 0', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const areas = ['a1', 'a5', 'a7', 'a9', 'other'];
  for (let k = 0; k < 2000; k++) {
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, index) => ({ index, quantity: 1 + Math.floor(rnd() * 3), serverUnitPrice: Math.round(rnd() * 2000) / 100 }));
    const amman = rnd() < 0.7;
    const meta = amman ? { citySlug: 'amman', ammanAreaId: areas[Math.floor(rnd() * areas.length)] } : { citySlug: 'irbid' };
    const method = amman && rnd() < 0.3 ? 'fast' : 'standard';
    const type = ['discount', 'free_delivery', 'gift'][k % 3];
    const prize = { type, valueJod: [1, 4, 5, 3, 2][k % 5], minOrderJod: 0, appliesTo: 'this_order', status: 'issued', expiresAt: null };
    const base = computeServerPricing(lines, meta, method);
    const subtotal = lines.reduce((s, l) => s + l.serverUnitPrice * l.quantity, 0);
    const qty = lines.reduce((s, l) => s + l.quantity, 0);
    const volumeDiscount = qty > 2 ? subtotal * 0.1 : 0;
    const fx = prizeEffect(prize, { subtotal, volumeDiscount, shippingCost: base.shipping, previousDelivered: null });
    assert.equal(fx.state, 'applies');
    // what Checkout.tsx sends
    const discountAmount = volumeDiscount + fx.discountJod;
    const shippingCost = base.shipping - fx.shippingWaivedJod;
    const client = { subtotal, discountAmount, shippingCost, total: Math.max(0, subtotal - discountAmount + shippingCost) };
    // what the Worker computes with the same prize
    const adj = type === 'discount' ? { discountJod: prize.valueJod } : type === 'free_delivery' ? { shippingCapJod: prize.valueJod } : null;
    const server = computeServerPricing(lines, meta, method, adj);
    assert.deepEqual(comparePricing(server, client), [], `cart ${k}: ${JSON.stringify({ server, client })}`);
    assert.ok(server.total >= 0 && client.total >= 0);
  }
});

test('server data is parsed defensively (unknown type -> gift, bad ids / colours dropped); usablePrize', () => {
  assert.equal(slotOf({ id: '../x', label: 'a' }), null);
  const s = slotOf({ id: 'none-1', type: 'none', label: 'حظ أوفر', color: 'red', valueJod: -3 });
  assert.equal(s.type, 'none');
  assert.equal(s.color, null);
  assert.equal(s.valueJod, 0);
  assert.equal(slotOf({ id: 'x-1', type: 'cash', label: 'x' }).type, 'gift');
  const sp = spinOf({ spinId: 'c_u1234567890_1', label: 'حظ أوفر', status: 'none', type: 'gift' });
  assert.equal(sp.type, 'none');
  assert.equal(usablePrize(sp), false);
  assert.equal(usablePrize(spinOf({ spinId: 'c_u1234567890_2', label: 'خصم', status: 'issued', type: 'discount', expiresAt: '2000-01-01T00:00:00Z' })), false);
  assert.ok(prizeText({ type: 'discount', label: 'x', valueJod: 4, minOrderJod: 15, appliesTo: 'next_order' }, true).includes('طلبك الثاني'));
  assert.equal(WHEEL_ENABLED, false, 'off in a normal build');
});

test('Google gate: closed window / blocked popup / network map to "not sent"; only a Google-linked account skips the window', () => {
  assert.equal(googleOutcome('auth/popup-closed-by-user'), 'cancelled');
  assert.equal(googleOutcome('auth/cancelled-popup-request'), 'cancelled');
  assert.equal(googleOutcome('auth/popup-blocked'), 'blocked');
  assert.equal(googleOutcome('auth/network-request-failed'), 'network');
  assert.equal(googleOutcome('auth/unauthorized-domain'), 'unavailable');
  assert.equal(googleOutcome('auth/internal-error'), 'failed');
  assert.equal(googleOutcome(undefined), 'failed');
  for (const o of ['cancelled', 'blocked', 'network', 'failed', 'unavailable']) {
    assert.ok(googleMessage(o, true).includes('لم يُرسل الطلب'), o);
  }
  assert.equal(hasGoogleSession(null), false);
  assert.equal(hasGoogleSession({ uid: 'u', providerData: [{ providerId: 'password' }] }), false);
  assert.equal(hasGoogleSession({ uid: 'u', isAnonymous: true, providerData: [{ providerId: 'google.com' }] }), false);
  assert.equal(hasGoogleSession({ uid: 'u', providerData: [{ providerId: 'google.com' }] }), true);
});

test('checkout form survives a Google redirect: kept once, 30 minutes, same tab only', () => {
  const m = new Map();
  const store = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  const t0 = 1_000_000;
  assert.ok(saveCheckoutResume({ formData: { fullName: 'سارة' }, paymentMethod: 'cod' }, store, t0));
  assert.deepEqual(takeCheckoutResume(store, t0 + 60_000), { formData: { fullName: 'سارة' }, paymentMethod: 'cod' });
  assert.equal(takeCheckoutResume(store, t0 + 60_000), null, 'read once');
  saveCheckoutResume({ x: 1 }, store, t0);
  assert.equal(takeCheckoutResume(store, t0 + 31 * 60_000), null, 'expired');
  m.set(RESUME_KEY, '{broken');
  assert.equal(takeCheckoutResume(store, t0), null);
});

test('admin helpers: shares only count active slots; fresh slot ids', () => {
  const sh = slotShares({ prizes: [{ id: 'a', weight: 1 }, { id: 'b', weight: 3 }, { id: 'c', weight: 5, active: false }] });
  assert.equal(sh.a, 0.25);
  assert.equal(sh.b, 0.75);
  assert.equal(sh.c, 0);
  assert.equal(newSlotId(['none-1', 'none-2'], 'none'), 'none-3');
  assert.equal(newSlotId([], 'free_delivery'), 'ship-1');
});
