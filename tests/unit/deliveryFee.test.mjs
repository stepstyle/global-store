// Delivery fees: the checkout page and the order Worker must charge EXACTLY the same (the Worker refuses any difference:
// PRICE_CHECK_MODE=enforce -> 422 PRICE_CHANGED). 2026-11-28: 7 Amman areas had their own price on the page and every
// order from them was refused. The page now reads the Worker's table (src/services/deliveryFee.ts); this test fails if
// anything drifts again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AMMAN_AREAS, OUTSIDE_AMMAN_FEE, FAST_SURCHARGE, baseDeliveryFee } from '../../src/services/deliveryFee.ts';
import { shippingFor } from '../../workers/order-worker/src/pricing.js';
import { AMMAN_AREA_PRICES, JO_GOV_SLUGS, VOLUME_DISCOUNT_MIN_ITEMS_EXCLUSIVE, VOLUME_DISCOUNT_RATE } from '../../workers/order-worker/src/pricing-config.js';

const checkout = readFileSync(new URL('../../src/pages/Checkout.tsx', import.meta.url), 'utf8');
// what the page offers for a method (Checkout.tsx: standard = base, fast = base + FAST_SURCHARGE, Amman only)
const pageFee = (citySlug, area, method) => { const b = baseDeliveryFee(citySlug, area); return b === null ? null : b + (method === 'fast' ? FAST_SURCHARGE : 0); };

test('every Amman area the page offers: standard AND fast cost exactly what the Worker charges', () => {
  assert.equal(AMMAN_AREAS.length, 15);
  for (const a of AMMAN_AREAS) for (const m of ['standard', 'fast']) {
    const w = shippingFor({ citySlug: 'amman', ammanAreaId: a.id }, m);
    assert.deepEqual(w.warnings, [], `${a.id}/${m}: Worker warnings`);
    assert.equal(pageFee('amman', a.id, m), w.shipping, `${a.id}/${m}`);
    assert.equal(a.price, w.shipping - (m === 'fast' ? 1 : 0), `${a.id} list price`);
  }
});

test('the page offers every area the Worker prices, and no other', () => {
  assert.deepEqual(AMMAN_AREAS.map((a) => a.id).sort(), Object.keys(AMMAN_AREA_PRICES).sort());
});

test('the owner-approved prices (the Worker\'s table, 2026-11-28)', () => {
  const p = Object.fromEntries(AMMAN_AREAS.map((a) => [a.id, a.price]));
  assert.deepEqual(p, { a1: 1, a2: 1, a3: 1, a4: 1, a5: 1.5, a6: 1.5, a7: 2, a8: 1.5, a9: 2.5, a10: 2.5, a11: 2.5, a12: 2.5, a13: 2.5, a14: 2.5, other: 2 });
});

test('every governorate outside Amman: standard delivery = the Worker\'s fee (3 JOD); the page lists the same governorates', () => {
  const pageSlugs = [...checkout.matchAll(/\{ slug: '([a-z]+)', ar:/g)].map((m) => m[1]);
  assert.deepEqual([...pageSlugs].sort(), [...JO_GOV_SLUGS].sort());
  for (const g of JO_GOV_SLUGS.filter((s) => s !== 'amman')) {
    const w = shippingFor({ citySlug: g }, 'standard');
    assert.deepEqual(w.warnings, [], g);
    assert.equal(pageFee(g, null, 'standard'), w.shipping, g);
    assert.equal(w.shipping, OUTSIDE_AMMAN_FEE);
    assert.equal(OUTSIDE_AMMAN_FEE, 3);
  }
  // fast delivery is offered in Amman only (the Worker flags it elsewhere)
  assert.match(checkout, /if \(formData\.citySlug === 'amman'\) \{\s*methods\.push\(\{\s*id: 'fast'/);
  assert.deepEqual(shippingFor({ citySlug: 'irbid' }, 'fast').warnings.map((w) => w.code), ['FAST_OUTSIDE_AMMAN']);
});

test('before the area is known there is NO fee (null), never 0 — the page shows "decided after the area"', () => {
  assert.equal(baseDeliveryFee('', ''), null);
  assert.equal(baseDeliveryFee(null, null), null);
  assert.equal(baseDeliveryFee('amman', ''), null);
  assert.equal(baseDeliveryFee('amman', 'a99'), null);
  assert.equal(baseDeliveryFee('amman', 'a1'), 1);
  assert.equal(baseDeliveryFee('zarqa', ''), 3);
  assert.match(checkout, /deliveryFeeKnown === null \?/);
  assert.match(checkout, /يُحدَّد بعد اختيار المنطقة/);
});

test('no price is written in the page any more; the fast-delivery text matches the surcharge; volume discount matches', () => {
  assert.doesNotMatch(checkout, /\{ id: 'a\d+', nameAr: [^}]*price:/, 'no local area price list');
  assert.doesNotMatch(checkout, /return 3\.0;/, 'no local outside-Amman fee');
  assert.equal(FAST_SURCHARGE, 1);
  assert.match(checkout, /\(\+ 1 دينار\)/, 'the fast option text says +1 JOD');
  // volume discount (unchanged by this fix): page "totalItems > 2 ? subtotal * 0.1" == Worker
  assert.match(checkout, /totalItems > 2 \? subtotal \* 0\.1 : 0/);
  assert.equal(VOLUME_DISCOUNT_MIN_ITEMS_EXCLUSIVE, 2);
  assert.equal(VOLUME_DISCOUNT_RATE, 0.1);
});
