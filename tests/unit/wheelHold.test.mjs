// Prize wheel — the 60-minute window, browser side (pure parts): time left, its display, "expired" vs usable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remainingMs, fmtRemaining, prizeExpired, usablePrize, prizeEffect, guestAsSpin, guestOf, DEFAULT_HOLD_MINUTES, isSecondOrder, prizeWaiting, SECOND_ORDER_HOURS } from '../../src/services/wheel.ts';

const T0 = Date.parse('2026-11-20T10:00:00Z');
const prize = (o = {}) => ({ spinId: 'c_u_1', n: 1, prizeId: 'disc-1', label: 'خصم دينار', status: 'issued', orderId: null, type: 'discount', valueJod: 1, minOrderJod: 5, appliesTo: 'this_order', description: '', expiresAt: new Date(T0 + 60 * 60_000).toISOString(), ...o });

test('time left: counts down to 0, never negative; no end time -> null', () => {
  assert.equal(DEFAULT_HOLD_MINUTES, 60);
  const end = new Date(T0 + 60 * 60_000).toISOString();
  assert.equal(remainingMs(end, T0), 3_600_000);
  assert.equal(remainingMs(end, T0 + 59 * 60_000), 60_000);
  assert.equal(remainingMs(end, T0 + 61 * 60_000), 0);
  assert.equal(remainingMs(null, T0), null);
  assert.equal(remainingMs('not a date', T0), null);
});

test('display: mm:ss under an hour, rounded UP (never 00:00 while still valid)', () => {
  assert.equal(fmtRemaining(3_600_000), '1:00:00');
  assert.equal(fmtRemaining(3_599_000), '59:59');
  assert.equal(fmtRemaining(61_000), '01:01');
  assert.equal(fmtRemaining(1), '00:01');
  assert.equal(fmtRemaining(0), '00:00');
});

test('at the end of the window the prize flips from usable to EXPIRED, and stops affecting the cart', () => {
  const p = prize();
  const cart = { subtotal: 7.5, volumeDiscount: 0.75, shippingCost: 3, previousDelivered: null };
  const justBefore = T0 + 60 * 60_000 - 1;
  const atEnd = T0 + 60 * 60_000;
  assert.equal(usablePrize(p, justBefore), true);
  assert.equal(prizeExpired(p, justBefore), false);
  assert.equal(prizeEffect(p, cart, justBefore).state, 'applies');
  assert.equal(usablePrize(p, atEnd), false);
  assert.equal(prizeExpired(p, atEnd), true);
  assert.equal(prizeEffect(p, cart, atEnd).state, 'unavailable');
});

test('"expired" is only for an UNUSED prize: reserved by an order, consumed, "حظ أوفر" or already marked are not shown as just expired', () => {
  const late = T0 + 2 * 60 * 60_000;
  assert.equal(prizeExpired(prize({ status: 'reserved' }), late), false, 'attached to an order in time: follows the order');
  assert.equal(prizeExpired(prize({ status: 'consumed' }), late), false);
  assert.equal(prizeExpired(prize({ type: 'none', status: 'none', expiresAt: null }), late), false);
  assert.equal(prizeExpired(prize({ status: 'expired' }), late), false);
  // a guest result (before signing in) expires the same way
  const g = guestAsSpin(guestOf({ prizeId: 'disc-1', label: 'خصم', status: 'held', type: 'discount', valueJod: 1, minOrderJod: 5, expiresAt: new Date(T0 + 3_600_000).toISOString(), holdUntil: new Date(T0 + 3_600_000).toISOString() }));
  assert.equal(prizeExpired(g, T0 + 3_600_000), true);
  assert.equal(usablePrize(g, T0 + 3_599_999), true);
});

test('second-order prize (owner\'s exception): won by a guest -> KEPT ("waiting"), never usable before the first delivery, never "expired" after 60 minutes', () => {
  assert.equal(SECOND_ORDER_HOURS, 120);
  const g = guestAsSpin(guestOf({ prizeId: 'second-4', label: 'خصم 4 د.أ على الطلب الثاني', status: 'held', type: 'discount', valueJod: 4, minOrderJod: 15, appliesTo: 'next_order', expiresAt: null, holdUntil: new Date(T0 + 120 * 3_600_000).toISOString() }));
  assert.equal(isSecondOrder(g), true);
  assert.equal(g.status, 'waiting');
  assert.equal(prizeWaiting(g), true);
  assert.equal(g.expiresAt, null);
  for (const later of [T0 + 61 * 60_000, T0 + 24 * 3_600_000]) {
    assert.equal(prizeExpired(g, later), false, 'not cut after an hour');
    assert.equal(usablePrize(g, later), false, 'not usable before the first delivery');
  }
  assert.equal(prizeEffect(g, { subtotal: 20, volumeDiscount: 0, shippingCost: 3, previousDelivered: true }, T0).state, 'unavailable');
});

test('second-order prize after the first delivery: usable 5 days on the ACTUAL second order (>= 15), then expired', () => {
  const delivered = T0;
  const p = prize({ prizeId: 'second-4', valueJod: 4, minOrderJod: 15, appliesTo: 'next_order', expiresAt: new Date(delivered + 120 * 3_600_000).toISOString() });
  const day4 = delivered + 96 * 3_600_000;
  assert.equal(usablePrize(p, day4), true);
  assert.deepEqual(prizeEffect(p, { subtotal: 15, volumeDiscount: 0, shippingCost: 3, previousDelivered: true }, day4), { state: 'applies', discountJod: 4, shippingWaivedJod: 0 });
  assert.equal(prizeEffect(p, { subtotal: 14.99, volumeDiscount: 0, shippingCost: 3, previousDelivered: true }, day4).state, 'below_min');
  // not the actual second order (another order pending / none delivered): not applied
  assert.equal(prizeEffect(p, { subtotal: 20, volumeDiscount: 0, shippingCost: 3, previousDelivered: false }, day4).state, 'needs_previous_order');
  assert.equal(remainingMs(p.expiresAt, day4), 24 * 3_600_000);
  assert.equal(prizeExpired(p, delivered + 120 * 3_600_000), true);
});