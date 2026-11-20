// Prize wheel — the 60-minute window, browser side (pure parts): time left, its display, "expired" vs usable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remainingMs, fmtRemaining, prizeExpired, usablePrize, prizeEffect, guestAsSpin, guestOf, DEFAULT_HOLD_MINUTES } from '../../src/services/wheel.ts';

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
