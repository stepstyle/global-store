// Prize wheel — the spin WITHOUT an account, browser side (pure parts). The Worker part is tested on the real Worker
// with the emulator (workers/order-worker/test/wheel-guest.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { GUEST_TICKET_RE, WHEEL_SPIN_ID_RE, guestOf, guestAsSpin, usablePrize, prizeEffect, claimGuestResult, spinAsGuest } from '../../src/services/wheel.ts';
import { TICKET_RE } from '../../workers/order-worker/src/wheel-guest.js';

const won = { prizeId: 'disc-1', label: 'خصم دينار', status: 'held', type: 'discount', valueJod: 1, minOrderJod: 5, appliesTo: 'this_order', description: '', expiresAt: '2026-12-01T00:00:00.000Z', holdUntil: '2026-11-22T00:00:00.000Z' };

test('ticket format: the browser and the Worker accept exactly the same tickets (32 random bytes, base64url)', () => {
  for (let i = 0; i < 200; i++) {
    const t = randomBytes(32).toString('base64url');
    assert.ok(GUEST_TICKET_RE.test(t) && TICKET_RE.test(t), t);
  }
  for (const bad of ['', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}+`]) {
    assert.equal(GUEST_TICKET_RE.test(bad), false, bad);
    assert.equal(TICKET_RE.test(bad), false, bad);
  }
});

test('a guest result is SHOWN like a prize but can never be sent with an order (no spin id)', () => {
  const s = guestAsSpin(guestOf(won));
  assert.equal(s.spinId, '');
  assert.equal(WHEEL_SPIN_ID_RE.test(s.spinId), false);
  assert.equal(s.status, 'issued');
  assert.equal(usablePrize(s, Date.parse('2026-11-20T00:00:00Z')), true);
  // the hold ends before the validity: the earlier date is the one shown (past it the prize may be gone)
  assert.equal(s.expiresAt, won.holdUntil);
  assert.equal(usablePrize(s, Date.parse('2026-11-23T00:00:00Z')), false);
  // the same rule as the Worker for the effect on the cart
  assert.equal(prizeEffect(s, { subtotal: 4.99, volumeDiscount: 0, shippingCost: 1, previousDelivered: null }, Date.parse('2026-11-20T00:00:00Z')).state, 'below_min');
  assert.deepEqual(prizeEffect(s, { subtotal: 5, volumeDiscount: 0, shippingCost: 1, previousDelivered: null }, Date.parse('2026-11-20T00:00:00Z')), { state: 'applies', discountJod: 1, shippingWaivedJod: 0 });
});

test('guest results: "حظ أوفر" is never usable; expired / released / malformed answers are not prizes', () => {
  const none = guestAsSpin(guestOf({ prizeId: 'none-2', label: 'حظ أوفر', status: 'none', type: 'none', holdUntil: null, expiresAt: null }));
  assert.equal(none.type, 'none');
  assert.equal(usablePrize(none), false);
  for (const status of ['expired', 'refused', 'claimed']) assert.equal(usablePrize(guestAsSpin(guestOf({ ...won, status }))), false, status);
  assert.equal(guestOf(null), null);
  assert.equal(guestOf({ prizeId: 1, label: 'x' }), null);
  // a value from the network is clamped like every other wheel value
  assert.equal(guestOf({ ...won, valueJod: -5 }).valueJod, 0);
});

test('without a wheel build / ticket nothing is sent: no claim without a ticket, no spin without the wheel', async () => {
  let calls = 0;
  const deps = { fetch: async () => { calls += 1; return { status: 200, text: async () => '{}' }; } };
  assert.deepEqual(await claimGuestResult('token', 'https://worker.invalid', deps), { kind: 'none' });
  assert.equal((await spinAsGuest('https://worker.invalid', deps)).kind !== 'ok', true);
  assert.equal(calls, 0);
});
