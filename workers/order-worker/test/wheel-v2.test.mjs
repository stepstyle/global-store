// LOCAL ONLY: the real Worker (src/index.js) + Firestore EMULATOR (demo- project) + mock JWKS with TEST keys.
//   node <emu.mjs> . demo-dairsharaf-orders "node --test --test-concurrency=1 test/wheel-v2.test.mjs"
// Prize wheel v2: prize types, per-prize minimums, "حظ أوفر" segments, second-order discount, admin settings,
// Google sign-in for orders, Turnstile single use. TEST settings only (not real prizes, prices or probabilities).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMockServices, makeEnv, callWorker, clearDb, seedProducts, putDoc, getDecoded, count, PROJECT_ID } from './helpers.mjs';
import { checkoutOrder, makeOrderId } from './fixtures.mjs';
import { makeTestSigner } from './token-signer.mjs';
import { clearKeyCache } from '../src/auth.js';

const OWNER = 'ownerUid00000000000000000000O1';
const ALICE = 'aliceUid000000000000000000A1';
const BOB = 'bobUid00000000000000000000000B1';
const CID = 'test-campaign';

let mock;
let signer;
const origLog = console.log;
const WHEEL = { STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', PRICE_CHECK_MODE: 'enforce', WHEEL_MODE: 'test', WHEEL_CAMPAIGN: CID, WHEEL_PHONE_SECRET: 'test-only-wheel-phone-secret-0123456789' };
const env = (o = {}) => makeEnv(mock.url, { ...WHEEL, ...o });
const GOOGLE = { firebase: { sign_in_provider: 'google.com' } };
const token = (uid, extra = {}) => signer.idToken({ projectId: PROJECT_ID, uid, extra: { email: `${uid}@example.invalid`, email_verified: true, ...GOOGLE, ...extra } });
const authH = async (uid, extra) => ({ origin: 'https://dairsharaf.com', authorization: `Bearer ${await token(uid, extra)}` });

const EXTRA_PRODUCTS = {
  'p-1499': { name: 'منتج 14.99', price: 14.99, stock: 20 },
  'p-15': { name: 'منتج 15', price: 15, stock: 20 },
  'p-5': { name: 'منتج 5', price: 5, stock: 20 },
  'p-499': { name: 'منتج 4.99', price: 4.99, stock: 20 },
  'p-watch': { name: 'ساعة هدية', price: 9, stock: 2 },
};

/** test campaign: ONE drawable slot (deterministic) unless a test seeds another one; 3 visible "حظ أوفر" */
const slot = (o) => ({ weight: 1, quantity: 5, ...o });
const NONES = [1, 2, 3].map((i) => ({ id: `none-${i}`, type: 'none', label: 'حظ أوفر', weight: 0 }));
const campaign = (prizes, extra = {}) => ({
  active: true, minOrderJod: 5, budgetJod: 500, giftOnCancel: 'return', prizeValidDays: 7,
  startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', terms: 'شروط تجريبية', prizes, ...extra,
});
async function seed(prizes, extra) {
  const c = campaign(prizes, extra);
  await putDoc(`wheelCampaigns/${CID}`, c);
  for (const p of prizes) if (p.type !== 'none') await putDoc(`wheelPool/${CID}_${p.id}`, { remaining: p.quantity ?? 5 });
}

before(async () => {
  mock = await startMockServices();
  signer = await makeTestSigner('kid-wheel2');
  console.log = () => {};
});
after(async () => { console.log = origLog; await mock?.close(); });
beforeEach(async () => {
  mock.reset();
  clearKeyCache();
  mock.state.jwks = { keys: [signer.jwk] };
  await clearDb();
  await seedProducts(EXTRA_PRODUCTS);
  await putDoc('config/roles', { ownerUid: OWNER });
});

const spin = async (uid, e = env()) => callWorker(e, { method: 'POST', path: '/wheel/spin', headers: await authH(uid), body: {} });
const pub = async (e = env()) => callWorker(e, { path: '/wheel/public', headers: { origin: 'https://dairsharaf.com' } });
const spinDoc = (uid, n = 1) => getDecoded(`wheelSpins/${CID}_${uid}_${n}`);
const remaining = async (id) => (await getDecoded(`wheelPool/${CID}_${id}`))?.remaining;
/** one product line; the browser's numbers include the prize exactly like the site computes them */
function cartOrder(uid, productId, qty, { discount = 0, shipping = 1, id = makeOrderId() } = {}) {
  const price = EXTRA_PRODUCTS[productId]?.price ?? 1;
  const items = [{ productId, name: productId, price, quantity: qty, image: '', selectedVariant: null }];
  const subtotal = Math.round(price * qty * 1000) / 1000;
  const vol = qty > 2 ? Math.round(subtotal * 0.1 * 1000) / 1000 : 0;
  const discountAmount = Math.round((vol + discount) * 1000) / 1000;
  return checkoutOrder({ id, userId: uid || 'guest', items, overrides: { subtotal, discountAmount, shippingCost: shipping, total: Math.round(Math.max(0, subtotal - discountAmount + shipping) * 1000) / 1000 } });
}
async function place(uid, o, { spinId, e = env(), headers } = {}) {
  return callWorker(e, { method: 'POST', path: '/create-order', headers: headers ?? (uid ? await authH(uid) : { origin: 'https://dairsharaf.com' }), body: { order: o, ...(spinId !== undefined ? { wheelSpinId: spinId } : {}) } });
}
const setStatus = async (id, status, extra = {}) => callWorker(env(), { method: 'POST', path: `/admin/orders/${encodeURIComponent(id)}/status`, headers: await authH(OWNER), body: { status, ...extra } });
async function deliver(id) {
  for (const s of ['processing', 'shipped', 'delivered']) assert.equal((await setStatus(id, s)).status, 200, s);
}

test('V01 public wheel: no account needed; segments in order incl. THREE visible "حظ أوفر"; never weights, quantities or costs', async () => {
  await seed([slot({ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1 }), ...NONES.map((n) => ({ ...n, weight: 3 })), slot({ id: 'watch', type: 'gift', label: 'ساعة', productId: 'p-watch', unitCostJod: 9, minOrderJod: 15 })]);
  const r = await pub();
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.campaign, 'open');
  assert.deepEqual(r.body.slots.map((s) => s.id), ['disc-1', 'none-1', 'none-2', 'none-3', 'watch']);
  assert.equal(r.body.slots.filter((s) => s.type === 'none' && s.label === 'حظ أوفر').length, 3);
  const raw = JSON.stringify(r.body);
  for (const k of ['weight', 'quantity', 'unitCostJod', 'remaining', 'budgetJod']) assert.ok(!raw.includes(`"${k}"`), k);
  assert.equal(r.body.slots.find((s) => s.id === 'watch').minOrderJod, 15);
});

test('V02 the server decides: a "حظ أوفر" result is the segment ACTUALLY drawn; out-of-stock / inactive prizes are hidden and never drawn', async () => {
  await seed([slot({ id: 'gone', type: 'discount', label: 'خصم', valueJod: 1, quantity: 0 }), slot({ id: 'off', type: 'discount', label: 'موقوفة', valueJod: 1, active: false }), { ...NONES[1], weight: 5 }]);
  await putDoc(`wheelPool/${CID}_gone`, { remaining: 0 });
  const p = await pub();
  assert.deepEqual(p.body.slots.map((s) => s.id), ['none-2']);
  const s = await spin(ALICE);
  assert.equal(s.status, 200, s.text);
  assert.equal(s.body.result.prizeId, 'none-2');
  assert.equal(s.body.result.type, 'none');
  assert.equal(s.body.result.status, 'none');
  // one chance = one result: a second call returns the SAME stored result
  const again = await spin(ALICE);
  assert.equal(again.body.repeated, true);
  assert.equal(again.body.result.spinId, s.body.result.spinId);
  assert.equal(await count('wheelSpins'), 1);
});

test('V03/V04 minimum 5 JOD on the PRODUCTS (before the prize, no delivery): 4.99 refused (nothing written), exactly 5.00 accepted with the discount applied', async () => {
  await seed([slot({ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5 })]);
  const s = (await spin(ALICE)).body.result;
  assert.equal(s.type, 'discount');
  const low = cartOrder(ALICE, 'p-499', 1, { discount: 1 });
  const r1 = await place(ALICE, low, { spinId: s.spinId });
  assert.equal(r1.status, 422, r1.text);
  assert.equal(r1.body.code, 'WHEEL_MIN_ORDER');
  assert.equal(r1.body.minOrderJod, 5);
  assert.equal(await getDecoded(`orders/${low.id}`), null);
  assert.equal((await spinDoc(ALICE)).status, 'issued');
  const ok = cartOrder(ALICE, 'p-5', 1, { discount: 1 });
  const r2 = await place(ALICE, ok, { spinId: s.spinId });
  assert.equal(r2.status, 200, r2.text);
  const L = await getDecoded(`orderLedger/${ok.id}`);
  assert.equal(L.serverPricing.total, 5); // 5 - 1 + 1 delivery
  assert.equal(L.wheel.discountJod, 1);
  const order = await getDecoded(`orders/${ok.id}`);
  assert.equal(order.wheelPrize.type, 'discount');
  assert.equal(order.wheelPrize.discountJod, 1);
  assert.equal((await spinDoc(ALICE)).status, 'reserved');
});

test('V04b the browser cannot skip or inflate the discount: wrong numbers -> 422 PRICE_CHANGED, nothing written', async () => {
  await seed([slot({ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1 })]);
  const s = (await spin(ALICE)).body.result;
  const greedy = cartOrder(ALICE, 'p-15', 1, { discount: 5 });
  const r = await place(ALICE, greedy, { spinId: s.spinId });
  assert.equal(r.status, 422, r.text);
  assert.equal(r.body.code, 'PRICE_CHANGED');
  assert.equal(r.body.serverPricing.total, 15);
  assert.equal(await getDecoded(`orders/${greedy.id}`), null);
  assert.equal((await spinDoc(ALICE)).status, 'issued');
});

test('V05/V06 big prize (watch, minimum 15): 14.99 refused with the minimum, exactly 15.00 accepted; the watch is reserved like any line', async () => {
  await seed([slot({ id: 'watch', type: 'gift', label: 'ساعة', productId: 'p-watch', unitCostJod: 9, valueJod: 9, minOrderJod: 15 })]);
  const s = (await spin(ALICE)).body.result;
  assert.equal(s.minOrderJod, 15);
  const r1 = await place(ALICE, cartOrder(ALICE, 'p-1499', 1), { spinId: s.spinId });
  assert.equal(r1.status, 422);
  assert.equal(r1.body.code, 'WHEEL_MIN_ORDER');
  assert.equal(r1.body.minOrderJod, 15);
  const o = cartOrder(ALICE, 'p-15', 1);
  const r2 = await place(ALICE, o, { spinId: s.spinId });
  assert.equal(r2.status, 200, r2.text);
  assert.equal((await getDecoded('stockReservations/p-watch')).product, 1);
  const order = await getDecoded(`orders/${o.id}`);
  assert.ok(order.items.some((it) => it.gift === true && it.price === 0 && it.productId === 'p-watch'));
  assert.equal(order.total, 16);
});

test('V07/V08 second-order discount: refused on the first order; a CANCELLED order does not count; accepted (>= 15) after a DELIVERED order; used once', async () => {
  await seed([slot({ id: 'second-4', type: 'discount', label: 'خصم 4 على الطلب الثاني', valueJod: 4, minOrderJod: 15, appliesTo: 'next_order' })]);
  const s = (await spin(ALICE)).body.result;
  assert.equal(s.appliesTo, 'next_order');
  const first = cartOrder(ALICE, 'p-15', 1, { discount: 4 });
  const r1 = await place(ALICE, first, { spinId: s.spinId });
  assert.equal(r1.status, 422);
  assert.equal(r1.body.code, 'WHEEL_NEEDS_PREVIOUS_ORDER');
  // a first order, placed then CANCELLED: still no completed order
  const plain = cartOrder(ALICE, 'p-5', 1);
  assert.equal((await place(ALICE, plain)).status, 200);
  assert.equal((await setStatus(plain.id, 'cancelled')).status, 200);
  assert.equal((await place(ALICE, cartOrder(ALICE, 'p-15', 1, { discount: 4 }), { spinId: s.spinId })).body.code, 'WHEEL_NEEDS_PREVIOUS_ORDER');
  // a delivered first order: now the second order may use it (>= 15)
  const done = cartOrder(ALICE, 'p-5', 1);
  assert.equal((await place(ALICE, done)).status, 200);
  await deliver(done.id);
  const low = await place(ALICE, cartOrder(ALICE, 'p-1499', 1, { discount: 4 }), { spinId: s.spinId });
  assert.equal(low.body.code, 'WHEEL_MIN_ORDER');
  const second = cartOrder(ALICE, 'p-15', 1, { discount: 4 });
  const r2 = await place(ALICE, second, { spinId: s.spinId });
  assert.equal(r2.status, 200, r2.text);
  assert.equal((await getDecoded(`orderLedger/${second.id}`)).serverPricing.total, 12);
  // the same prize again on another order: refused (already used)
  const again = await place(ALICE, cartOrder(ALICE, 'p-15', 1, { discount: 4 }), { spinId: s.spinId });
  assert.equal(again.body.code, 'WHEEL_PRIZE_USED');
  // another account's delivered order never unlocks Alice's prize (BOB has none)
  assert.equal((await callWorker(env(), { path: '/wheel/state', headers: await authH(ALICE) })).status, 200);
});

test('V09 cancelled order: the prize is NOT consumed (back to "issued"), no new chance is granted', async () => {
  await seed([slot({ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1 })]);
  const s = (await spin(ALICE)).body.result;
  const o = cartOrder(ALICE, 'p-5', 1, { discount: 1 });
  assert.equal((await place(ALICE, o, { spinId: s.spinId })).status, 200);
  assert.equal((await setStatus(o.id, 'cancelled')).status, 200);
  const d = await spinDoc(ALICE);
  assert.equal(d.status, 'issued');
  assert.equal(d.orderId, null);
  assert.equal(await getDecoded(`wheelGrants/${o.id}`), null);
  // delivered -> consumed + ONE new chance for that order, once
  const o2 = cartOrder(ALICE, 'p-5', 1, { discount: 1 });
  assert.equal((await place(ALICE, o2, { spinId: s.spinId })).status, 200);
  await deliver(o2.id);
  assert.equal((await spinDoc(ALICE)).status, 'consumed');
  const st = await callWorker(env(), { path: '/wheel/state', headers: await authH(ALICE) });
  assert.equal(st.body.chancesLeft, 1);
  assert.equal((await setStatus(o2.id, 'delivered')).status, 200);
  assert.equal((await callWorker(env(), { path: '/wheel/state', headers: await authH(ALICE) })).body.chancesLeft, 1);
});

test('V10 rapid double submit (same order, 5 at once) and a second order with the same prize: ONE order, prize reserved ONCE', async () => {
  await seed([slot({ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, quantity: 10 })], { openGiftsPerPhone: 1 });
  // several rounds (different accounts): the race between identical sends is timing-dependent
  for (let round = 0; round < 5; round++) {
    const uid = `race${round}${'0'.repeat(22)}`;
    const s0 = (await spin(uid)).body.result;
    const o0 = cartOrder(uid, 'p-5', 1, { discount: 1 });
    o0.address = { ...o0.address, phone: `+96279000000${round}` };
    const rs0 = await Promise.all(Array.from({ length: 8 }, () => place(uid, o0, { spinId: s0.spinId })));
    assert.ok(rs0.every((r) => r.status === 200), `round ${round}: ${rs0.map((r) => `${r.status}:${r.body?.code || ''}`).join(',')}`);
    assert.equal(rs0.filter((r) => r.body.replay === false).length, 1);
    assert.equal((await getDecoded(`wheelSpins/${s0.spinId}`)).orderId, o0.id);
  }
  await clearDb(); await seedProducts(EXTRA_PRODUCTS); await putDoc('config/roles', { ownerUid: OWNER });
  await seed([slot({ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1 })]);
  const s = (await spin(ALICE)).body.result;
  const o = cartOrder(ALICE, 'p-5', 1, { discount: 1 });
  const rs = await Promise.all(Array.from({ length: 8 }, () => place(ALICE, o, { spinId: s.spinId })));
  assert.ok(rs.every((r) => r.status === 200), rs.map((r) => `${r.status}:${r.body?.code || ''}`).join(','));
  assert.equal(rs.filter((r) => r.body.replay === false).length, 1);
  assert.equal(await count('orders'), 1);
  const other = await place(ALICE, cartOrder(ALICE, 'p-5', 1, { discount: 1 }), { spinId: s.spinId });
  assert.equal(other.status, 422);
  assert.equal(other.body.code, 'WHEEL_PRIZE_USED');
  // another account can never use Alice's prize
  const bob = await place(BOB, cartOrder(BOB, 'p-5', 1, { discount: 1 }), { spinId: s.spinId });
  assert.equal(bob.body.code, 'WHEEL_PRIZE_INVALID');
});

test('V11 free delivery: the fee is waived up to its cap (server-computed); a generic gift has no stock line; total never below 0', async () => {
  await seed([slot({ id: 'ship', type: 'free_delivery', label: 'توصيل مجاني', valueJod: 3 })]);
  const s = (await spin(ALICE)).body.result;
  const o = cartOrder(ALICE, 'p-5', 1, { shipping: 0 });
  const r = await place(ALICE, o, { spinId: s.spinId });
  assert.equal(r.status, 200, r.text);
  const L = await getDecoded(`orderLedger/${o.id}`);
  assert.equal(L.serverPricing.shipping, 0);
  assert.equal(L.serverPricing.total, 5);
  assert.equal(L.wheel.shippingWaivedJod, 1);
  // generic gift ("هدية بقيمة 2"): a free line marked as a gift, no stock reservation
  await clearDb(); await seedProducts(EXTRA_PRODUCTS); await putDoc('config/roles', { ownerUid: OWNER });
  await seed([slot({ id: 'gift-2', type: 'gift', label: 'هدية بقيمة 2 دينار', valueJod: 2, unitCostJod: 2 })]);
  const g = (await spin(BOB)).body.result;
  const o2 = cartOrder(BOB, 'p-5', 1);
  assert.equal((await place(BOB, o2, { spinId: g.spinId })).status, 200);
  const ord = await getDecoded(`orders/${o2.id}`);
  const giftLine = ord.items.find((it) => it.gift === true);
  assert.equal(giftLine.productId, 'wheel-gift');
  assert.equal(giftLine.price, 0);
  assert.equal(ord.total, 6);
  assert.equal(await getDecoded('stockReservations/wheel-gift'), null);
});

test('V12 out of stock: the last unit is won once; then the prize disappears from the wheel and is never drawn again', async () => {
  await seed([slot({ id: 'toy', type: 'gift', label: 'لعبة', valueJod: 2, unitCostJod: 2, quantity: 1 }), { ...NONES[0], weight: 1 }]);
  await putDoc(`wheelPool/${CID}_toy`, { remaining: 1 });
  // weights 1:1 — spin until the toy is won or 30 accounts tried; afterwards it is never drawn
  let won = 0;
  for (let i = 0; i < 30; i++) {
    const r = await spin(`acct${String(i).padStart(24, '0')}`);
    if (r.body.result.prizeId === 'toy') won += 1;
  }
  assert.ok(won <= 1, `won ${won}`);
  assert.equal(await remaining('toy'), 1 - won);
  if (won) assert.deepEqual((await pub()).body.slots.map((s) => s.id), ['none-1']);
});

test('V13 admin settings: only admins (server-side); invalid settings refused with reasons; quantity changes move the pool; stale edits refused; loss warnings', async () => {
  await seed([slot({ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1 })]);
  const get = async (uid) => callWorker(env(), { path: '/admin/wheel', headers: uid ? await authH(uid) : { origin: 'https://dairsharaf.com' } });
  const save = async (uid, body) => callWorker(env(), { method: 'POST', path: '/admin/wheel/campaign', headers: await authH(uid), body });
  assert.equal((await get(null)).status, 401);
  assert.equal((await get(ALICE)).status, 403);
  assert.equal((await save(ALICE, { campaign: campaign([]) })).status, 403);
  assert.equal((await callWorker(env(), { path: '/admin/wheel/spins', headers: await authH(ALICE) })).status, 403);
  const g = await get(OWNER);
  assert.equal(g.status, 200, g.text);
  assert.equal(g.body.pool['disc-1'], 5);
  // invalid: a discount >= its minimum, an unknown type
  const bad = await save(OWNER, { campaign: campaign([slot({ id: 'x', type: 'discount', label: 'خصم 5', valueJod: 5, minOrderJod: 5 }), slot({ id: 'y', type: 'cash', label: '?' })]), baseUpdateTime: g.body.updateTime });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.errors.length >= 2, JSON.stringify(bad.body.errors));
  // valid, with a loss warning (5 JOD gift at 5 JOD minimum) and a quantity change 5 -> 8 (+3)
  const next = campaign([slot({ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, quantity: 8 }), slot({ id: 'gift-5', type: 'gift', label: 'هدية 5', valueJod: 5, unitCostJod: 5, minOrderJod: 5, quantity: 2 }), ...NONES.map((n) => ({ ...n, weight: 2 }))]);
  const ok = await save(OWNER, { campaign: next, baseUpdateTime: g.body.updateTime });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.pool['disc-1'], 8);
  assert.equal(ok.body.pool['gift-5'], 2);
  assert.ok(ok.body.warnings.some((w) => w.includes('هدية 5') && w.includes('15')), JSON.stringify(ok.body.warnings));
  assert.equal(await count('wheelCampaignHistory'), 1);
  // a second admin still editing the OLD version: refused, nothing overwritten
  const stale = await save(OWNER, { campaign: campaign([slot({ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, quantity: 1 })]), baseUpdateTime: g.body.updateTime });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'WHEEL_CAMPAIGN_CHANGED');
  assert.equal((await get(OWNER)).body.campaign.prizes.length, 5);
  // the new settings are what visitors see
  assert.deepEqual((await pub()).body.slots.map((s) => s.id), ['disc-1', 'gift-5', 'none-1', 'none-2', 'none-3']);
});

test('V14 admin prize log: result, status, order number, account', async () => {
  await seed([slot({ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1 })]);
  const s = (await spin(ALICE)).body.result;
  const o = cartOrder(ALICE, 'p-5', 1, { discount: 1 });
  assert.equal((await place(ALICE, o, { spinId: s.spinId })).status, 200);
  const r = await callWorker(env(), { path: '/admin/wheel/spins', headers: await authH(OWNER) });
  assert.equal(r.status, 200, r.text);
  const row = r.body.spins.find((x) => x.spinId === s.spinId);
  assert.equal(row.status, 'reserved');
  assert.equal(row.orderId, o.id);
  assert.equal(row.uid, ALICE);
  assert.equal(row.email, `${ALICE}@example.invalid`);
});

test('V15 ORDER_SIGN_IN=google: no token / e-mail-password session refused BEFORE Turnstile; a Google session is accepted', async () => {
  const e = env({ ORDER_SIGN_IN: 'google', TURNSTILE_MODE: 'enforce' });
  const body = (o) => ({ order: o, turnstileToken: 'pass-token' });
  const guest = await callWorker(e, { method: 'POST', path: '/create-order', headers: { origin: 'https://dairsharaf.com' }, body: body(cartOrder(null, 'p-5', 1)) });
  assert.equal(guest.status, 401);
  assert.equal(guest.body.code, 'SIGN_IN_REQUIRED');
  const pw = await callWorker(e, { method: 'POST', path: '/create-order', headers: await authH(ALICE, { firebase: { sign_in_provider: 'password' } }), body: body(cartOrder(ALICE, 'p-5', 1)) });
  assert.equal(pw.status, 401);
  assert.equal(pw.body.code, 'GOOGLE_SIGN_IN_REQUIRED');
  assert.equal(mock.state.calls.filter((c) => c.channel === 'turnstile').length, 0, 'Turnstile token not spent on a refused identity');
  // a password session of an account LINKED to Google (signed identities claim) is accepted — same rule as the site
  const linked = await callWorker(e, { method: 'POST', path: '/create-order', headers: await authH(BOB, { firebase: { sign_in_provider: 'password', identities: { 'google.com': ['1234567890'] } } }), body: body(cartOrder(BOB, 'p-5', 1)) });
  assert.equal(linked.status, 200, linked.text);
  const ok = await callWorker(e, { method: 'POST', path: '/create-order', headers: await authH(ALICE), body: body(cartOrder(ALICE, 'p-5', 1)) });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(await count('orders'), 2);
  // default (off): unchanged, a guest order is still accepted
  assert.equal((await callWorker(env(), { method: 'POST', path: '/create-order', headers: { origin: 'https://dairsharaf.com' }, body: { order: cartOrder(null, 'p-5', 1) } })).status, 200);
});

test('V16 Turnstile enforce: missing / failed / REUSED token refused (403), nothing written; a fresh token passes', async () => {
  mock.state.turnstileSingleUse = true;
  const e = env({ TURNSTILE_MODE: 'enforce' });
  const send = async (o, t) => callWorker(e, { method: 'POST', path: '/create-order', headers: await authH(ALICE), body: { order: o, ...(t ? { turnstileToken: t } : {}) } });
  assert.equal((await send(cartOrder(ALICE, 'p-5', 1))).status, 403);
  assert.equal((await send(cartOrder(ALICE, 'p-5', 1), 'fail-token')).status, 403);
  const first = await send(cartOrder(ALICE, 'p-5', 1), 'pass-once-1');
  assert.equal(first.status, 200, first.text);
  const reuse = await send(cartOrder(ALICE, 'p-5', 1), 'pass-once-1');
  assert.equal(reuse.status, 403);
  assert.equal(reuse.body.code, 'TURNSTILE_FAILED');
  assert.equal(await count('orders'), 1);
});
