// LOCAL ONLY: the real Worker (src/index.js) + Firestore EMULATOR (demo- project) + mock JWKS with TEST keys.
//   node <emu.mjs> . demo-dairsharaf-orders "node --test --test-concurrency=1 test/wheel-second-window.test.mjs"
// Owner's final rules for "4 JOD off the SECOND order":
//   5 days from the WIN to create the first order; created in time -> kept until it is delivered (not if cancelled);
//   delivered -> 5 NEW days for the actual second order (>= 15 JOD). The second-order check and the use of the discount
//   are ATOMIC with the account's order sequence: no discount on a third order nor on two simultaneous orders.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startMockServices, makeEnv, callWorker, clearDb, seedProducts, putDoc, getDecoded, count, runCron, adminDb, eq, PROJECT_ID } from './helpers.mjs';
import { checkoutOrder, makeOrderId } from './fixtures.mjs';
import { makeTestSigner } from './token-signer.mjs';
import { clearKeyCache } from '../src/auth.js';
import { guestPath } from '../src/wheel-guest.js';
import { accountSeqPath, accountSeqBump, accountSeqGuardedBump } from '../src/wheel.js';
import { isConflict } from '../src/firestore.js';

const OWNER = 'ownerUid00000000000000000000O1';
const ALICE = 'aliceUid000000000000000000A1';
const CID = 'test-campaign';
const H = 3_600_000;

let mock;
let signer;
const origLog = console.log;
const WHEEL = { STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', PRICE_CHECK_MODE: 'enforce', WHEEL_MODE: 'test', WHEEL_CAMPAIGN: CID, WHEEL_PHONE_SECRET: 'test-only-wheel-phone-secret-0123456789', WHEEL_GUEST_PER_IP_DAY: '100' };
const env = (o = {}) => makeEnv(mock.url, { ...WHEEL, ...o });
const token = (uid) => signer.idToken({ projectId: PROJECT_ID, uid, extra: { email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'google.com' } } });
const authH = async (uid) => ({ origin: 'https://dairsharaf.com', authorization: `Bearer ${await token(uid)}` });

const PRODUCTS = { 'p-5': { name: 'منتج 5', price: 5, stock: 500 }, 'p-15': { name: 'منتج 15', price: 15, stock: 500 } };
const SECOND = { id: 'second-4', type: 'discount', label: 'خصم 4 د.أ على الطلب الثاني', valueJod: 4, unitCostJod: 4, minOrderJod: 15, appliesTo: 'next_order', weight: 1_000_000, quantity: 40 };
const NONE = { id: 'none-1', type: 'none', label: 'حظ أوفر', weight: 1 };
async function seed(quantity = 3) {
  await putDoc(`wheelCampaigns/${CID}`, { active: true, minOrderJod: 5, budgetJod: 500, giftOnCancel: 'return', prizeValidDays: 30, startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', terms: 'شروط تجريبية', prizes: [{ ...SECOND, quantity }, NONE] });
  await putDoc(`wheelPool/${CID}_second-4`, { remaining: quantity });
}
const remaining = async () => (await getDecoded(`wheelPool/${CID}_second-4`))?.remaining;
const spinPath = (uid) => `wheelSpins/${CID}_${uid}_1`;
const spinDoc = (uid) => getDecoded(spinPath(uid));
async function rewrite(path, patch) {
  const { __raw, ...d } = await getDecoded(path);
  await putDoc(path, { ...d, ...patch });
}
/** the 5 days to create the first order are over (the stored deadline moved into the past) */
const pastDeadline = (uid) => rewrite(spinPath(uid), { firstOrderBy: new Date(Date.now() - 60_000), issuedExpiry: new Date(Date.now() - 60_000) });
/** the deadline passed JUST NOW — after the orders the test created a moment ago (they were created in time) */
async function deadlineJustPassed(uid) {
  await new Promise((r) => setTimeout(r, 1500));
  const t = new Date(Date.now() - 300);
  await rewrite(spinPath(uid), { firstOrderBy: t, issuedExpiry: t });
}

before(async () => {
  mock = await startMockServices();
  signer = await makeTestSigner('kid-wheel-second-window');
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
// one delivery number per account (the open-prize limit per number is a separate rule, tested elsewhere)
const phones = new Map();
const phoneOf = (uid) => { if (!phones.has(uid)) phones.set(uid, `+96279${String(phones.size + 1).padStart(7, '0')}`); return phones.get(uid); };
function cartOrder(uid, productId, { discount = 0, id = makeOrderId() } = {}) {
  const price = PRODUCTS[productId].price;
  const items = [{ productId, name: productId, price, quantity: 1, image: '', selectedVariant: null }];
  const o = checkoutOrder({ id, userId: uid, items, overrides: { subtotal: price, discountAmount: discount, shippingCost: 1, total: price - discount + 1 } });
  o.address = { ...o.address, phone: phoneOf(uid) };
  return o;
}
const place = async (uid, o, spinId) => callWorker(env(), { method: 'POST', path: '/create-order', headers: await authH(uid), body: { order: o, ...(spinId ? { wheelSpinId: spinId } : {}) } });
const setStatus = async (id, status) => callWorker(env(), { method: 'POST', path: `/admin/orders/${encodeURIComponent(id)}/status`, headers: await authH(OWNER), body: { status } });
async function deliver(id) { for (const s of ['processing', 'shipped', 'delivered']) assert.equal((await setStatus(id, s)).status, 200, s); }
async function plainOrder(uid, { deliverIt = false } = {}) {
  const o = cartOrder(uid, 'p-5');
  const r = await place(uid, o);
  assert.equal(r.status, 200, r.text);
  if (deliverIt) await deliver(o.id);
  return o;
}

test('T01 won with no order: 5 days (from the win) to CREATE the first order — shown to the customer; not usable meanwhile', async () => {
  await seed();
  const s = (await spin(ALICE)).body.result;
  const d = await spinDoc(ALICE);
  assert.equal(d.status, 'waiting');
  assert.equal(d.firstOrderBy.getTime() - d.createdAt.getTime(), 120 * H);
  assert.equal(d.issuedExpiry.getTime(), d.firstOrderBy.getTime(), 'the cron looks at it when the 5 days end');
  assert.equal(s.firstOrderBy, d.firstOrderBy.toISOString());
  const st = (await callWorker(env(), { path: '/wheel/state', headers: await authH(ALICE) })).body;
  assert.equal(st.spins[0].firstOrderBy, d.firstOrderBy.toISOString());
  assert.equal(st.secondOrder, 'none');
});

test('T02 no first order in 5 days: expired, its unit back ONCE (cron, another spin, again: never twice)', async () => {
  await seed();
  await spin(ALICE);
  assert.equal(await remaining(), 2);
  await pastDeadline(ALICE);
  const BOB = 'bobUid00000000000000000000000B1';
  await Promise.all([runCron(env()), runCron(env()), spin(BOB)]);
  assert.equal((await spinDoc(ALICE)).status, 'expired');
  const bobWon = (await spinDoc(BOB))?.prizeId === 'second-4' ? 1 : 0;
  assert.equal(await remaining() + bobWon, 3);
  await runCron(env());
  assert.equal(await remaining() + bobWon, 3);
});

test('T03 first order CREATED in time, delivered after the 5 days: kept (linked to that order), then 5 NEW days from the delivery', async () => {
  await seed();
  await spin(ALICE);
  const first = await plainOrder(ALICE);
  await deadlineJustPassed(ALICE);
  await runCron(env());
  let d = await spinDoc(ALICE);
  assert.equal(d.status, 'waiting', 'not expired: an order was created in time');
  assert.equal(d.firstOrderId, first.id);
  assert.equal(await remaining(), 2, 'the unit stays held');
  assert.equal((await runCron(env())).wheel.expired, 0);
  await deliver(first.id);
  d = await spinDoc(ALICE);
  const L = await getDecoded(`orderLedger/${first.id}`);
  assert.equal(d.status, 'issued');
  assert.equal(d.expiresAt.getTime() - L.deliveredAt.getTime(), 120 * H);
});

test('T04 first order created AFTER the 5 days: it does not keep the prize (not activated by its delivery); expired, unit back once', async () => {
  await seed();
  await spin(ALICE);
  await pastDeadline(ALICE);
  const late = await plainOrder(ALICE, { deliverIt: true });
  assert.equal((await spinDoc(ALICE)).status, 'waiting', 'the late order\'s delivery did not activate it');
  await runCron(env());
  const d = await spinDoc(ALICE);
  assert.equal(d.status, 'expired');
  assert.equal(await remaining(), 3);
  assert.equal((await place(ALICE, cartOrder(ALICE, 'p-15', { discount: 4 }), `${CID}_${ALICE}_1`)).body.code, 'WHEEL_PRIZE_EXPIRED');
  assert.ok(late.id);
});

test('T05 first order CANCELLED: re-evaluated — inside the 5 days: back to "create your first order"; after them: expired (unit back once); another order created in time: takes its place', async () => {
  // (a) won while an order is already open (linked at once), cancelled inside the 5 days
  await seed();
  const a = await plainOrder(ALICE);
  await spin(ALICE);
  let d = await spinDoc(ALICE);
  assert.equal(d.firstOrderId, a.id);
  assert.equal((await setStatus(a.id, 'cancelled')).status, 200);
  d = await spinDoc(ALICE);
  assert.equal(d.status, 'waiting');
  assert.equal(d.firstOrderId, null);
  assert.equal(d.issuedExpiry.getTime(), d.firstOrderBy.getTime());
  // (b) linked by the cron after the deadline, then cancelled: nothing created in time any more -> expired, once
  const b = await plainOrder(ALICE);
  await deadlineJustPassed(ALICE);
  await runCron(env());
  assert.equal((await spinDoc(ALICE)).firstOrderId, b.id);
  assert.equal((await setStatus(b.id, 'cancelled')).status, 200);
  d = await spinDoc(ALICE);
  assert.equal(d.status, 'expired');
  assert.equal(d.expiredReason, 'first_order_cancelled');
  assert.equal(await remaining(), 3);
  await runCron(env());
  await setStatus(b.id, 'cancelled');
  assert.equal(await remaining(), 3, 'never twice');
  // (c) two orders created in time, the linked one cancelled -> the other takes its place, and its delivery starts the 5 days
  await seed();
  const BOB = 'bobUid00000000000000000000000B1';
  await spin(BOB);
  const b1 = await plainOrder(BOB);
  const b2 = await plainOrder(BOB);
  await deadlineJustPassed(BOB);
  await runCron(env());
  assert.equal((await spinDoc(BOB)).firstOrderId, b1.id);
  await setStatus(b1.id, 'cancelled');
  assert.equal((await spinDoc(BOB)).firstOrderId, b2.id);
  await deliver(b2.id);
  assert.equal((await spinDoc(BOB)).status, 'issued');
});

test('T06 guest spin: after linking at checkout the 5 days count from the GUEST spin, not from the sign-in', async () => {
  await seed();
  const t = randomBytes(32).toString('base64url');
  await callWorker(env(), { method: 'POST', path: '/wheel/guest/spin', headers: { origin: 'https://dairsharaf.com' }, body: { ticket: t } });
  const spunAt = new Date(Date.now() - 30 * H);
  await rewrite(await guestPath(CID, t), { createdAt: spunAt });
  const c = await callWorker(env(), { method: 'POST', path: '/wheel/guest/claim', headers: await authH(ALICE), body: { ticket: t } });
  assert.equal(c.status, 200, c.text);
  const d = await spinDoc(ALICE);
  assert.equal(d.status, 'waiting');
  assert.equal(d.firstOrderBy.getTime(), spunAt.getTime() + 120 * H, '90 hours left, not 120');
});

test('T07 ATOMIC (primitive): a discount order whose read sequence is stale cannot commit; an unguarded bump never blocks', async () => {
  const fs = adminDb();
  const uid = 'seqUid0000000000000000000000S1';
  const missing = await fs.get(accountSeqPath(uid));
  assert.equal((await fs.commit([accountSeqBump(fs, uid)])).ok, true); // another order of the account meanwhile
  const stale = await fs.commit([accountSeqGuardedBump(fs, uid, missing)]);
  assert.equal(stale.ok, false);
  assert.ok(isConflict(stale), JSON.stringify(stale.data).slice(0, 200));
  const fresh = await fs.get(accountSeqPath(uid));
  await fs.commit([accountSeqBump(fs, uid)]);
  assert.equal(isConflict(await fs.commit([accountSeqGuardedBump(fs, uid, fresh)])), true);
  const now = await fs.get(accountSeqPath(uid));
  assert.equal((await fs.commit([accountSeqGuardedBump(fs, uid, now)])).ok, true);
  // 2 plain bumps + 1 guarded commit that was still current (the two stale ones wrote nothing)
  assert.equal((await getDecoded(accountSeqPath(uid))).seq, 3);
});

/**
 * The invariant of a second-order discount: when its order was saved, the account had EXACTLY ONE other live order,
 * delivered (read back from Firestore: server creation times of every order of the account).
 */
async function checkInvariant(uid) {
  const docs = await adminDb().runQuery({ from: [{ collectionId: 'orders' }], where: eq('userId', uid) });
  const orders = docs.map((d) => ({ id: d.name.split('/').pop(), ...(Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, v.timestampValue ?? v.stringValue ?? v]))) }));
  const withDiscount = [];
  for (const o of orders) {
    const L = await getDecoded(`orderLedger/${o.id}`);
    if (L?.wheel?.prizeId === 'second-4') withDiscount.push({ ...o, createdAt: Date.parse(o.createdAt) });
  }
  assert.ok(withDiscount.length <= 1, `discount used ${withDiscount.length} times`);
  for (const b of withDiscount) {
    const before = orders.filter((o) => o.id !== b.id && o.status !== 'cancelled' && Date.parse(o.createdAt) <= b.createdAt);
    assert.equal(before.length, 1, `the discount order had ${before.length} live orders before it (${JSON.stringify(before.map((o) => o.status))})`);
    assert.equal(before[0].status, 'delivered');
  }
  return withDiscount.length;
}

test('T08 CONCURRENCY (real): after the first delivery, the discount order and 1-2 other orders of the same account at the SAME moment, many rounds -> the discount only ever lands on the actual second order', async () => {
  await seed(40);
  let granted = 0;
  let refused = 0;
  for (let round = 0; round < 12; round++) {
    const uid = `raceUid${String(round).padStart(2, '0')}0000000000000000000R`;
    const s = (await spin(uid)).body.result;
    assert.equal(s.prizeId, 'second-4');
    await plainOrder(uid, { deliverIt: true });
    assert.equal((await spinDoc(uid)).status, 'issued');
    // the other orders start 0-180 ms later (round by round): sometimes the discount order commits first (granted:
    // the others are then 3rd+), sometimes they do (refused) — both while the requests overlap
    const delay = (round % 4) * 60;
    const others = Array.from({ length: 1 + (round % 2) }, () => new Promise((res) => setTimeout(res, delay)).then(() => place(uid, cartOrder(uid, 'p-5'))));
    const [b, ...rest] = await Promise.all([place(uid, cartOrder(uid, 'p-15', { discount: 4 }), s.spinId), ...others]);
    for (const r of rest) assert.equal(r.status, 200, r.text);
    if (b.status === 200) granted += 1;
    else { assert.equal(b.body.code, 'WHEEL_NOT_SECOND_ORDER', b.text); refused += 1; }
    assert.equal(await checkInvariant(uid), b.status === 200 ? 1 : 0);
    assert.equal((await spinDoc(uid)).status, b.status === 200 ? 'reserved' : 'issued', 'a refused discount stays usable');
  }
  // both outcomes are legitimate (who commits first); the invariant held in every round
  assert.equal(granted + refused, 12);
  process.stderr.write(`T08 rounds: discount granted ${granted}, refused ${refused}\n`);
});

test('T09 CONCURRENCY (real): two discount orders with the prize + a third order at once -> at most one discount, never on a third order', async () => {
  await seed(40);
  for (let round = 0; round < 6; round++) {
    const uid = `duoUid${String(round).padStart(2, '0')}00000000000000000000D`;
    const s = (await spin(uid)).body.result;
    await plainOrder(uid, { deliverIt: true });
    const res = await Promise.all([
      place(uid, cartOrder(uid, 'p-15', { discount: 4 }), s.spinId),
      place(uid, cartOrder(uid, 'p-15', { discount: 4 }), s.spinId),
      place(uid, cartOrder(uid, 'p-5')),
    ]);
    assert.ok(res.filter((r, i) => i < 2 && r.status === 200).length <= 1, res.map((r) => `${r.status}:${r.body?.code}`).join(','));
    assert.ok(await checkInvariant(uid) <= 1);
  }
  assert.ok((await count('orders')) >= 12);
});
