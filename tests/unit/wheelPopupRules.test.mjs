// The automatic wheel popup's rules that do not need a browser (where it may open, once per campaign, landing).
//   node --test tests/unit/wheelPopupRules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuietPath, campaignFingerprint, targetRotation, segmentAt } from '../../src/services/wheel.ts';

test('the popup never opens by itself over the order flow, sign-in, admin, confirmation or the wheel page', () => {
  for (const p of ['/checkout', '/checkout/step', '/admin', '/admin/orders', '/login', '/order-success/ORD-1', '/wheel']) assert.equal(isQuietPath(p), true, p);
});

test('…and opens on every other page: home, shop, product, offers, cart, about, tracking', () => {
  for (const p of ['/', '', '/shop', '/product/p-1', '/offers', '/cart', '/about', '/tracking', '/wishlist', '/my-orders']) assert.equal(isQuietPath(p), false, p);
});

test('campaign fingerprint: the same campaign = the same value; a new / changed campaign = a new value (opens once more)', () => {
  const slots = [{ id: 'a', label: 'خصم دينار', type: 'discount' }, { id: 'n1', label: 'حظ أوفر', type: 'none' }];
  const base = { slots, terms: 'شروط', minOrderJod: 5 };
  assert.equal(campaignFingerprint(base), campaignFingerprint({ ...base, slots: slots.map((s) => ({ ...s })) }));
  assert.notEqual(campaignFingerprint(base), campaignFingerprint({ ...base, terms: 'شروط جديدة' }));
  assert.notEqual(campaignFingerprint(base), campaignFingerprint({ ...base, minOrderJod: 10 }));
  assert.notEqual(campaignFingerprint(base), campaignFingerprint({ ...base, slots: [...slots, { id: 'g', label: 'هدية', type: 'gift' }] }));
});

test('the wheel always comes to rest on the drawn segment (the result window shows that same segment)', () => {
  for (const n of [2, 4, 6, 8, 12]) {
    let rot = 0;
    for (let k = 0; k < 40; k++) {
      const idx = (k * 7) % n;
      rot = targetRotation(rot, idx, n, 6, (k % 7) / 10 - 0.3);
      assert.equal(segmentAt(rot, n), idx, `n=${n} idx=${idx} rot=${rot}`);
    }
  }
});
