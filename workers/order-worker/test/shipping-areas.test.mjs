// LOCAL ONLY: the real Worker (src/index.js) + Firestore EMULATOR, production pricing settings (PRICE_CHECK_MODE=enforce,
// STOCK_POLICY=on_delivery). Every delivery choice the CHECKOUT PAGE offers, priced by the page's own code
// (src/services/deliveryFee.ts), must be ACCEPTED by the Worker — and the Worker must still refuse a wrong fee.
//   firebase emulators:exec --only firestore --project demo-dairsharaf-orders --config test/firebase.json \
//     "node --test --test-concurrency=1 test/shipping-areas.test.mjs"
// Each order starts from a fresh database with the seeded stock, so no case is refused because an earlier case
// reserved the stock (OUT_OF_STOCK) — only the price is under test.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMockServices, makeEnv, callWorker, clearDb, seedProducts, getDecoded, count } from './helpers.mjs';
import { checkoutOrder } from './fixtures.mjs';
import { AMMAN_AREAS, FAST_SURCHARGE, baseDeliveryFee } from '../../../src/services/deliveryFee.ts';
import { JO_GOV_SLUGS } from '../src/pricing-config.js';

let mock;
before(async () => { mock = await startMockServices(); });
after(async () => { await mock?.close(); });
beforeEach(async () => { mock.reset(); await clearDb(); await seedProducts(); });
const env = () => makeEnv(mock.url, { STOCK_POLICY: 'on_delivery', PRICE_CHECK_MODE: 'enforce', TURNSTILE_MODE: 'log' });

/** an order exactly as the checkout page builds its numbers (subtotal, volume discount > 2 pieces = 10%, delivery) */
function pageOrder({ citySlug, area = '', method = 'standard', payment = 'cod', fee }) {
  const o = checkoutOrder({ payment });
  const ship = fee ?? baseDeliveryFee(citySlug, area) + (method === 'fast' ? FAST_SURCHARGE : 0);
  o.addressMeta = { ...o.addressMeta, citySlug, ammanAreaId: area };
  o.address = { ...o.address, city: citySlug === 'amman' ? `عمّان (العاصمة) - ${AMMAN_AREAS.find((a) => a.id === area)?.nameAr || ''}` : citySlug };
  o.shippingMethodId = method;
  o.shippingCost = ship;
  o.total = Math.max(0, o.subtotal - o.discountAmount + ship);
  return o;
}
async function send(o) {
  const r = await callWorker(env(), { method: 'POST', path: '/create-order', body: { order: o } });
  return r;
}
async function accepted(o, label) {
  const r = await send(o);
  assert.equal(r.status, 200, `${label}: ${r.text}`);
  const saved = await getDecoded(`orders/${o.id}`);
  const ledger = await getDecoded(`orderLedger/${o.id}`);
  assert.equal(saved.shippingCost, o.shippingCost, `${label}: delivery saved as charged`);
  assert.equal(saved.total, o.total, `${label}: total saved as shown`);
  assert.equal(ledger.priceMismatch, false, `${label}: the Worker found no price difference`);
  assert.equal(ledger.serverPricing.shipping, o.shippingCost, `${label}: Worker delivery = page delivery`);
  assert.equal(ledger.serverPricing.discount, o.discountAmount, `${label}: Worker discount = page discount`);
  assert.equal(ledger.serverPricing.total, o.total, `${label}: Worker total = page total`);
  return saved;
}

test('SH01 every Amman area, standard AND fast, priced by the checkout page: accepted, nothing differs', async () => {
  assert.equal(AMMAN_AREAS.length, 15);
  for (const a of AMMAN_AREAS) for (const method of ['standard', 'fast']) {
    await clearDb(); await seedProducts(); mock.reset();
    await accepted(pageOrder({ citySlug: 'amman', area: a.id, method }), `${a.id}/${method}`);
  }
});

test('SH02 the 7 areas that were refused PRICE_CHANGED on 2026-11-28 are accepted at the approved fees', async () => {
  const fees = { a1: 1, a2: 1, a3: 1, a4: 1, a5: 1.5, a6: 1.5, a8: 1.5 };
  for (const [area, fee] of Object.entries(fees)) for (const method of ['standard', 'fast']) {
    await clearDb(); await seedProducts(); mock.reset();
    const o = pageOrder({ citySlug: 'amman', area, method });
    assert.equal(o.shippingCost, fee + (method === 'fast' ? 1 : 0), `${area}/${method} page fee`);
    await accepted(o, `${area}/${method}`);
  }
});

test('SH03 every governorate outside Amman, standard delivery (3 JOD): accepted', async () => {
  const govs = JO_GOV_SLUGS.filter((g) => g !== 'amman');
  assert.equal(govs.length, 11);
  for (const g of govs) {
    await clearDb(); await seedProducts(); mock.reset();
    const o = pageOrder({ citySlug: g });
    assert.equal(o.shippingCost, 3);
    await accepted(o, g);
  }
});

test('SH04 cash on delivery and CliQ, with the volume discount (3 pieces): page and Worker agree on every figure', async () => {
  for (const payment of ['cod', 'cliq']) for (const [citySlug, area, method] of [['amman', 'a1', 'fast'], ['amman', 'a8', 'standard'], ['irbid', '', 'standard']]) {
    await clearDb(); await seedProducts(); mock.reset();
    const o = pageOrder({ citySlug, area, method, payment });
    assert.ok(o.discountAmount > 0, 'the fixture has 3 pieces: volume discount applies');
    const saved = await accepted(o, `${payment} ${citySlug}/${area}/${method}`);
    assert.equal(saved.paymentMethod, payment);
  }
});

test('SH05 the Worker still ENFORCES prices: the old page fee (a1 = 1.5) and any other wrong fee are refused, nothing saved', async () => {
  for (const [area, method, fee] of [['a1', 'standard', 1.5], ['a2', 'standard', 2], ['a5', 'fast', 3.5], ['a8', 'standard', 2], ['a9', 'standard', 1]]) {
    await clearDb(); await seedProducts(); mock.reset();
    const r = await send(pageOrder({ citySlug: 'amman', area, method, fee }));
    assert.equal(r.status, 422, `${area}/${method} ${fee}: ${r.text}`);
    assert.equal(r.body.code, 'PRICE_CHANGED');
    assert.equal(await count('orders'), 0);
    assert.equal(await count('orderLedger'), 0);
  }
  // fast delivery outside Amman is not something the page offers; the Worker does not price it as Amman
  await clearDb(); await seedProducts(); mock.reset();
  const r = await send(pageOrder({ citySlug: 'irbid', method: 'fast', fee: 4 }));
  assert.equal(r.status, 422, r.text);
});
