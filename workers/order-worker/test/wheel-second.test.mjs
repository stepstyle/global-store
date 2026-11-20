// LOCAL ONLY: the real Worker (src/index.js) + Firestore EMULATOR (demo- project) + mock JWKS with TEST keys.
//   node <emu.mjs> . demo-dairsharaf-orders "node --test --test-concurrency=1 test/wheel-second.test.mjs"
// Owner's EXCEPTION: "4 JOD off the SECOND order" is never cut by the 60-minute window. Won before the first order is
// delivered -> kept ('waiting'); usable 120 hours (5 days) from the account's FIRST delivery, on its ACTUAL second order
// (products >= 15 JOD), once. Time is moved by rewriting stored dates into the past.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startMockServices, makeEnv, callWorker, clearDb, seedProducts, putDoc, getDecoded, count, runCron, PROJECT_ID } from './helpers.mjs';
import { checkoutOrder, makeOrderId } from './fixtures.mjs';
import { makeTestSigner } from './token-signer.mjs';
import { clearKeyCache } from '../src/auth.js';
import { guestPath } from '../src/wheel-guest.js';

const OWNER = 'ownerUid00000000000000000000O1';
const ALICE = 'aliceUid000000000000000000A1';
const BOB = 'bobUid00000000000000000000000B1';
const CID = 'test-campaign';
const H = 3_600_000;

let mock;
let signer;
const origLog = console.log;
const WHEEL = { STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', PRICE_CHECK_MODE: 'enforce', WHEEL_MODE: 'test', WHEEL_CAMPAIGN: CID, WHEEL_PHONE_SECRET: 'test-only-wheel-phone-secret-0123456789', WHEEL_GUEST_PER_IP_DAY: '100' };
const env = (o = {}) => makeEnv(mock.url, { ...WHEEL, ...o });
const token = (uid) => signer.idToken({ projectId: PROJECT_ID, uid, extra: { email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'google.com' } } });
const authH = async (uid) => ({ origin: 'https://dairsharaf.com', authorization: `Bearer ${await token(uid)}` });
const ORIGIN = { origin: 'https://dairsharaf.com' };

const PRODUCTS = { 'p-5': { name: 'منتج 5', price: 5, stock: 50 }, 'p-15': { name: 'منتج 15', price: 15, stock: 50 }, 'p-1499': { name: 'منتج 14.99', price: 14.99, stock: 50 } };
const SECOND = (o = {}) => ({ id: 'second-4', type: 'discount', label: 'خصم 4 د.أ على الطلب الثاني', valueJod: 4, unitCostJod: 4, minOrderJod: 15, appliesTo: 'next_order', weight: 1_000_000, quantity: 3, ...o });
const NONE = { id: 'none-1', type: 'none', label: 'حظ أوفر', weight: 1 };
const campaign = (prizes, extra = {}) => ({
  active: true, minOrderJod: 5, budgetJod: 500, giftOnCancel: 'return', prizeValidDays: 30,
  startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', terms: 'شروط تجريبية', prizes, ...extra,
});
async function seed(prizes = [SECOND(), NONE], extra) {
  await putDoc(`wheelCampaigns/${CID}`, campaign(prizes, extra));
  for (const p of prizes) if (p.type !== 'none') await putDoc(`wheelPool/${CID}_${p.id}`, { remaining: p.quantity });
}
const remaining = async () => (await getDecoded(`wheelPool/${CID}_second-4`))?.remaining;
const spinPath = (uid, n = 1) => `wheelSpins/${CID}_${uid}_${n}`;
const spinDoc = (uid, n = 1) => getDecoded(spinPath(uid, n));
async function rewrite(path, patch) {
  const { __raw, ...d } = await getDecoded(path);
  await putDoc(path, { ...d, ...patch });
}

before(async () => {
  mock = await startMockServices();
  signer = await makeTestSigner('kid-wheel-second');
  console.log = () => {};
});
after(async () => { console.log = origLog; await mock?.close(); });
beforeEach(async () => {
  mock.reset();
  clearKeyCache();
  mock.state.jwks = { keys: [signer.jwk] };
  await clearDb();
  await seedProducts(PRODUCTS);
  await putDoc('config/roles', { ownerUid: OWNER });
});

const spin = async (uid) => callWorker(env(), { method: 'POST', path: '/wheel/spin', headers: await authH(uid), body: {} });
const state = async (uid) => (await callWorker(env(), { path: '/wheel/state', headers: await authH(uid) })).body;
function cartOrder(uid, productId, { discount = 0, shipping = 1, id = makeOrderId() } = {}) {
  const price = PRODUCTS[productId].price;
  const items = [{ productId, name: productId, price, quantity: 1, image: '', selectedVariant: null }];
  return checkoutOrder({ id, userId: uid, items, overrides: { subtotal: price, discountAmount: discount, shippingCost: shipping, total: Math.round(Math.max(0, price - discount + shipping) * 1000) / 1000 } });
}
const place = async (uid, o, spinId) => callWorker(env(), { method: 'POST', path: '/create-order', headers: await authH(uid), body: { order: o, ...(spinId ? { wheelSpinId: spinId } : {}) } });
const setStatus = async (id, status) => callWorker(env(), { method: 'POST', path: `/admin/orders/${encodeURIComponent(id)}/status`, headers: await authH(OWNER), body: { status } });
async function deliver(id) {
  for (const s of ['processing', 'shipped', 'delivered']) assert.equal((await setStatus(id, s)).status, 200, s);
}
/** an order of `uid` without any prize, placed (and delivered if asked) */
async function plainOrder(uid, { deliverIt = false } = {}) {
  const o = cartOrder(uid, 'p-5');
  const r = await place(uid, o);
  assert.equal(r.status, 200, r.text);
  if (deliverIt) await deliver(o.id);
  return o;
}

test('S01 won BEFORE any order: kept as "waiting" — NOT cut after 60 minutes, not usable yet (first order refused with it)', async () => {
  await seed();
  const s = (await spin(ALICE)).body.result;
  assert.equal(s.prizeId, 'second-4');
  assert.equal(s.status, 'waiting');
  assert.equal(s.expiresAt, null, 'no end before the first delivery');
  const d = await spinDoc(ALICE);
  assert.equal(d.status, 'waiting');
  assert.equal(d.waitingUntil.toISOString(), '2099-01-01T00:00:00.000Z', 'kept at most until the campaign ends');
  // two hours later + the cron + another spin: still waiting (the 60-minute rule never applies to it)
  await rewrite(spinPath(ALICE), { createdAt: new Date(Date.now() - 2 * H) });
  assert.equal((await runCron(env())).wheel.expired, 0);
  await spin(BOB);
  assert.equal((await spinDoc(ALICE)).status, 'waiting');
  // the first order cannot use it
  const r = await place(ALICE, cartOrder(ALICE, 'p-15', { discount: 4 }), s.spinId);
  assert.equal(r.body.code, 'WHEEL_NEEDS_PREVIOUS_ORDER', r.text);
  const st = await state(ALICE);
  assert.equal(st.secondOrder, 'none');
  assert.equal(st.previousDelivered, false);
  assert.equal(st.secondOrderHours, 120);
});

test('S02 the FIRST delivery starts the 120 hours (from the delivery time, not the spin); a repeated delivery never restarts them', async () => {
  await seed();
  const s = (await spin(ALICE)).body.result;
  const first = await plainOrder(ALICE);
  assert.equal((await spinDoc(ALICE)).status, 'waiting', 'an order placed is not enough: delivered');
  await deliver(first.id);
  const d = await spinDoc(ALICE);
  const L = await getDecoded(`orderLedger/${first.id}`);
  assert.equal(d.status, 'issued');
  assert.equal(d.firstOrderId, first.id);
  assert.equal(d.activatedAt.getTime(), L.deliveredAt.getTime());
  assert.equal(d.expiresAt.getTime() - L.deliveredAt.getTime(), 120 * H, '5 days from the delivery');
  assert.equal(d.issuedExpiry.getTime(), d.expiresAt.getTime());
  assert.ok(d.expiresAt.getTime() - Date.now() > 119 * H, 'never ~1 hour by mistake');
  const again = await setStatus(first.id, 'delivered');
  assert.equal(again.body.result, 'unchanged');
  assert.equal((await spinDoc(ALICE)).expiresAt.getTime(), d.expiresAt.getTime());
  // the account's state + the prize as the customer follows it
  const st = await state(ALICE);
  assert.equal(st.secondOrder, 'one_delivered');
  assert.equal(st.previousDelivered, true);
  const mine = st.spins.find((x) => x.spinId === s.spinId);
  assert.equal(mine.status, 'issued');
  assert.equal(mine.expiresAt, d.expiresAt.toISOString());
  assert.equal(mine.activatedAt, L.deliveredAt.toISOString());
});

test('S03 the actual second order: 14.99 refused, exactly 15 with 4 off accepted (server total), then never again', async () => {
  await seed();
  const s = (await spin(ALICE)).body.result;
  await plainOrder(ALICE, { deliverIt: true });
  const low = cartOrder(ALICE, 'p-1499', { discount: 4 });
  const r1 = await place(ALICE, low, s.spinId);
  assert.equal(r1.body.code, 'WHEEL_MIN_ORDER', r1.text);
  assert.equal(r1.body.minOrderJod, 15);
  const ok = cartOrder(ALICE, 'p-15', { discount: 4 });
  const r2 = await place(ALICE, ok, s.spinId);
  assert.equal(r2.status, 200, r2.text);
  assert.equal((await getDecoded(`orderLedger/${ok.id}`)).serverPricing.total, 12, '15 - 4 + 1 delivery');
  assert.equal((await spinDoc(ALICE)).status, 'reserved');
  const r3 = await place(ALICE, cartOrder(ALICE, 'p-15', { discount: 4 }), s.spinId);
  assert.ok(['WHEEL_PRIZE_USED', 'WHEEL_NOT_SECOND_ORDER'].includes(r3.body.code), r3.text);
});

test('S04 order tricks: an order placed in between makes the prize order the THIRD -> refused; cancelling it restores the actual second', async () => {
  await seed();
  const s = (await spin(ALICE)).body.result;
  await plainOrder(ALICE, { deliverIt: true });
  const between = await plainOrder(ALICE); // pending second order WITHOUT the prize
  const r = await place(ALICE, cartOrder(ALICE, 'p-15', { discount: 4 }), s.spinId);
  assert.equal(r.body.code, 'WHEEL_NOT_SECOND_ORDER', r.text);
  assert.equal((await spinDoc(ALICE)).status, 'issued', 'untouched');
  assert.equal((await setStatus(between.id, 'cancelled')).status, 200);
  const ok = await place(ALICE, cartOrder(ALICE, 'p-15', { discount: 4 }), s.spinId);
  assert.equal(ok.status, 200, ok.text);
  // two orders BEFORE any delivery: neither can carry it (still waiting)
  await seed();
  const b = (await spin(BOB)).body.result;
  await plainOrder(BOB);
  assert.equal((await place(BOB, cartOrder(BOB, 'p-15', { discount: 4 }), b.spinId)).body.code, 'WHEEL_NEEDS_PREVIOUS_ORDER');
});

test('S05 after the 120 hours: unusable, its unit goes back ONCE (cron / next spin), the order goes without it', async () => {
  await seed();
  const s = (await spin(ALICE)).body.result;
  await plainOrder(ALICE, { deliverIt: true });
  assert.equal(await remaining(), 2);
  const past = new Date(Date.now() - 60_000);
  await rewrite(spinPath(ALICE), { expiresAt: past, issuedExpiry: past });
  const r = await place(ALICE, cartOrder(ALICE, 'p-15', { discount: 4 }), s.spinId);
  assert.equal(r.body.code, 'WHEEL_PRIZE_EXPIRED', r.text);
  await Promise.all([runCron(env()), runCron(env()), spin(BOB)]);
  assert.equal((await spinDoc(ALICE)).status, 'expired');
  const bobWon = (await spinDoc(BOB))?.prizeId === 'second-4' ? 1 : 0;
  assert.equal(await remaining() + bobWon, 3, 'returned exactly once');
  assert.equal((await place(ALICE, cartOrder(ALICE, 'p-15'))).status, 200, 'the order itself is fine without it');
});

test('S06 cancelling the second order: inside the 5 days the prize comes back with the SAME end; after them it ends and its unit returns once', async () => {
  await seed();
  const s = (await spin(ALICE)).body.result;
  await plainOrder(ALICE, { deliverIt: true });
  const end = (await spinDoc(ALICE)).expiresAt.getTime();
  const o = cartOrder(ALICE, 'p-15', { discount: 4 });
  assert.equal((await place(ALICE, o, s.spinId)).status, 200);
  assert.equal((await setStatus(o.id, 'cancelled')).status, 200);
  let d = await spinDoc(ALICE);
  assert.equal(d.status, 'issued');
  assert.equal(d.expiresAt.getTime(), end);
  // used again in time, then cancelled AFTER the window
  const o2 = cartOrder(ALICE, 'p-15', { discount: 4 });
  assert.equal((await place(ALICE, o2, s.spinId)).status, 200);
  await rewrite(spinPath(ALICE), { expiresAt: new Date(Date.now() - 60_000) });
  assert.equal((await setStatus(o2.id, 'cancelled')).status, 200);
  d = await spinDoc(ALICE);
  assert.equal(d.status, 'expired');
  assert.equal(await remaining(), 3);
  await setStatus(o2.id, 'cancelled');
  await runCron(env());
  assert.equal(await remaining(), 3, 'never twice');
  // delivered second order: consumed for good
  await seed();
  const b = (await spin(BOB)).body.result;
  await plainOrder(BOB, { deliverIt: true });
  const ob = cartOrder(BOB, 'p-15', { discount: 4 });
  assert.equal((await place(BOB, ob, b.spinId)).status, 200);
  await deliver(ob.id);
  assert.equal((await spinDoc(BOB)).status, 'consumed');
});

test('S07 the first order CANCELLED (not delivered): the prize keeps waiting; the next order that IS delivered starts the 5 days', async () => {
  await seed();
  await spin(ALICE);
  const a = await plainOrder(ALICE);
  assert.equal((await setStatus(a.id, 'cancelled')).status, 200);
  assert.equal((await spinDoc(ALICE)).status, 'waiting');
  const b = await plainOrder(ALICE, { deliverIt: true });
  const d = await spinDoc(ALICE);
  assert.equal(d.status, 'issued');
  assert.equal(d.firstOrderId, b.id);
});

test('S08 eligibility at the draw: an account past its second order never gets (nor sees) this prize; one delivered order -> usable at once, for the rest of ITS 5 days', async () => {
  await seed();
  // past: two delivered orders
  await plainOrder(BOB, { deliverIt: true });
  await plainOrder(BOB, { deliverIt: true });
  const sb = await state(BOB);
  assert.ok(!sb.slots.some((x) => x.id === 'second-4'), 'not shown to an account that can never use it');
  assert.equal((await spin(BOB)).body.result.prizeId, 'none-1');
  // one delivered order 2 days ago: drawn, usable now, ends 3 days from now
  const first = await plainOrder(ALICE, { deliverIt: true });
  const twoDaysAgo = new Date(Date.now() - 48 * H);
  await rewrite(`orderLedger/${first.id}`, { deliveredAt: twoDaysAgo });
  const s = (await spin(ALICE)).body.result;
  assert.equal(s.prizeId, 'second-4');
  assert.equal(s.status, 'issued');
  assert.equal(Date.parse(s.expiresAt) - twoDaysAgo.getTime(), 120 * H);
  // one delivered order 6 days ago: its 5 days are over -> not drawn
  const CAROL = 'carolUid00000000000000000000C1';
  const fc = await plainOrder(CAROL, { deliverIt: true });
  await rewrite(`orderLedger/${fc.id}`, { deliveredAt: new Date(Date.now() - 144 * H) });
  assert.equal((await spin(CAROL)).body.result.prizeId, 'none-1');
});

test('S09 races: five different second orders with the prize at once -> ONE; deliveries racing the activation never restart the clock', async () => {
  await seed();
  const s = (await spin(ALICE)).body.result;
  const first = await plainOrder(ALICE);
  for (const st of ['processing', 'shipped']) await setStatus(first.id, st);
  await Promise.all([setStatus(first.id, 'delivered'), setStatus(first.id, 'delivered'), setStatus(first.id, 'delivered')]);
  const d = await spinDoc(ALICE);
  assert.equal(d.status, 'issued');
  const L = await getDecoded(`orderLedger/${first.id}`);
  assert.equal(d.activatedAt.getTime(), L.deliveredAt.getTime());
  const five = Array.from({ length: 5 }, () => cartOrder(ALICE, 'p-15', { discount: 4 }));
  const rr = await Promise.all(five.map((o) => place(ALICE, o, s.spinId)));
  assert.equal(rr.filter((r) => r.status === 200).length, 1, rr.map((r) => `${r.status}:${r.body?.code}`).join(','));
  assert.equal(await count('orders'), 2);
});

test('S10 guest spin wins it: kept 5 days unclaimed (not 60 min); claim -> waiting for the first delivery; an account past its second order -> refused, unit back, welcome used', async () => {
  await seed();
  const t = randomBytes(32).toString('base64url');
  const g = (await callWorker(env(), { method: 'POST', path: '/wheel/guest/spin', headers: ORIGIN, body: { ticket: t } })).body.result;
  assert.equal(g.prizeId, 'second-4');
  assert.equal(g.expiresAt, null);
  assert.ok(Math.abs(Date.parse(g.holdUntil) - Date.now() - 120 * H) < 60_000, 'kept 120 h for the claim');
  // 2 hours later: still claimable
  await rewrite(await guestPath(CID, t), { createdAt: new Date(Date.now() - 2 * H) });
  await runCron(env());
  const c = await callWorker(env(), { method: 'POST', path: '/wheel/guest/claim', headers: await authH(ALICE), body: { ticket: t } });
  assert.equal(c.status, 200, c.text);
  assert.equal((await spinDoc(ALICE)).status, 'waiting');
  // an account already past its second order
  await plainOrder(BOB, { deliverIt: true });
  await plainOrder(BOB, { deliverIt: true });
  const t2 = randomBytes(32).toString('base64url');
  await callWorker(env(), { method: 'POST', path: '/wheel/guest/spin', headers: ORIGIN, body: { ticket: t2 } });
  const before = await remaining();
  const c2 = await callWorker(env(), { method: 'POST', path: '/wheel/guest/claim', headers: await authH(BOB), body: { ticket: t2 } });
  assert.equal(c2.body.code, 'WHEEL_NOT_SECOND_ORDER', c2.text);
  assert.equal(await remaining(), before + 1);
  assert.equal((await spinDoc(BOB)).status, 'expired');
  // the claim used the WELCOME spin (n = 1); Bob's two delivered orders still earned him their own spins, nothing more
  const ent = await getDecoded(`wheelEntitlements/${CID}_${BOB}`);
  assert.equal(ent.used, 1);
  assert.equal(ent.granted, 3, 'welcome + one per delivered qualifying order');
});

test('S11 admin: a second-order discount below 15 JOD is refused by the server (owner\'s rule)', async () => {
  await seed();
  const r = await callWorker(env(), { method: 'POST', path: '/admin/wheel/campaign', headers: await authH(OWNER), body: { campaign: campaign([SECOND({ minOrderJod: 14 }), NONE]), baseUpdateTime: (await getDecoded(`wheelCampaigns/${CID}`)).__raw.updateTime } });
  assert.equal(r.status, 422, r.text);
  assert.ok(r.body.errors.some((e) => /الطلب الثاني يتطلب حدًا أدنى 15/.test(e)), JSON.stringify(r.body.errors));
});
