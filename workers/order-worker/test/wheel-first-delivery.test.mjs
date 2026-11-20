// LOCAL ONLY: the real Worker (src/index.js) + Firestore EMULATOR (demo- project) + mock JWKS with TEST keys.
//   node <emu.mjs> . demo-dairsharaf-orders "node --test --test-concurrency=1 test/wheel-first-delivery.test.mjs"
// Owner's rule for "4 JOD off the SECOND order": a first order created in time keeps the prize only until it is
// DELIVERED within 168 h (7 days) of its creation. Past that, the prize ends by itself (existing cleanup), its unit comes
// back ONCE, and the first ORDER is never touched. Delivered in time -> 120 h from the delivery for the second order.
// The exact boundary and the delivery / cleanup race are tested with a controlled clock (direct calls).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startMockServices, makeEnv, callWorker, clearDb, seedProducts, putDoc, getDecoded, runCron, adminDb, PROJECT_ID } from './helpers.mjs';
import { checkoutOrder, makeOrderId } from './fixtures.mjs';
import { makeTestSigner } from './token-signer.mjs';
import { clearKeyCache } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { wheelStatusWrites, expireUnclaimedPrizes } from '../src/wheel.js';
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

const PRODUCTS = { 'p-5': { name: 'منتج 5', price: 5, stock: 50 }, 'p-15': { name: 'منتج 15', price: 15, stock: 50 } };
const SECOND = { id: 'second-4', type: 'discount', label: 'خصم 4 د.أ على الطلب الثاني', valueJod: 4, unitCostJod: 4, minOrderJod: 15, appliesTo: 'next_order', weight: 1_000_000, quantity: 3 };
const NONE = { id: 'none-1', type: 'none', label: 'حظ أوفر', weight: 1 };
async function seed() {
  await putDoc(`wheelCampaigns/${CID}`, { active: true, minOrderJod: 5, budgetJod: 500, giftOnCancel: 'return', prizeValidDays: 30, startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', terms: 'شروط تجريبية', prizes: [SECOND, NONE] });
  await putDoc(`wheelPool/${CID}_second-4`, { remaining: 3 });
}
const remaining = async () => (await getDecoded(`wheelPool/${CID}_second-4`))?.remaining;
const spinPath = (uid) => `wheelSpins/${CID}_${uid}_1`;
const spinDoc = (uid) => getDecoded(spinPath(uid));
const strip = (d) => { const { __raw, ...rest } = d; return rest; };
async function rewrite(path, patch) { await putDoc(path, { ...strip(await getDecoded(path)), ...patch }); }

before(async () => {
  mock = await startMockServices();
  signer = await makeTestSigner('kid-wheel-first-delivery');
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
  await seed();
});

const spin = async (uid) => callWorker(env(), { method: 'POST', path: '/wheel/spin', headers: await authH(uid), body: {} });
function cartOrder(uid, productId, { discount = 0, id = makeOrderId() } = {}) {
  const price = PRODUCTS[productId].price;
  const items = [{ productId, name: productId, price, quantity: 1, image: '', selectedVariant: null }];
  return checkoutOrder({ id, userId: uid, items, overrides: { subtotal: price, discountAmount: discount, shippingCost: 1, total: price - discount + 1 } });
}
const place = async (uid, o, spinId) => callWorker(env(), { method: 'POST', path: '/create-order', headers: await authH(uid), body: { order: o, ...(spinId ? { wheelSpinId: spinId } : {}) } });
const setStatus = async (id, status) => callWorker(env(), { method: 'POST', path: `/admin/orders/${encodeURIComponent(id)}/status`, headers: await authH(OWNER), body: { status } });
/** won while the first order is open: the prize is linked to it at once (deliveryBy = its creation + 168 h) */
async function linkedSetup(uid = ALICE) {
  const o = cartOrder(uid, 'p-5');
  assert.equal((await place(uid, o)).status, 200);
  await spin(uid);
  for (const s of ['processing', 'shipped']) assert.equal((await setStatus(o.id, s)).status, 200);
  const L = strip(await getDecoded(`orderLedger/${o.id}`));
  return { o, L, deliveryBy: L.createdAt.getTime() + 168 * H };
}
/** the order's 168 h are over: its stored deliveryBy (and the cleanup marker) moved into the past */
const sevenDaysOver = (uid) => rewrite(spinPath(uid), { deliveryBy: new Date(Date.now() - 60_000), issuedExpiry: new Date(Date.now() - 60_000) });

test('D01 linked to the first order: kept until it is delivered, at most 168 h after the ORDER was created — shown to the customer', async () => {
  const { o, L, deliveryBy } = await linkedSetup();
  const d = await spinDoc(ALICE);
  assert.equal(d.status, 'waiting');
  assert.equal(d.firstOrderId, o.id);
  assert.equal(d.deliveryBy.getTime(), deliveryBy, 'creation of the order + 168 h');
  assert.equal(d.deliveryBy.getTime() - L.createdAt.getTime(), 168 * H);
  assert.equal(d.issuedExpiry.getTime(), deliveryBy, 'the existing cleanup looks at it then');
  const st = (await callWorker(env(), { path: '/wheel/state', headers: await authH(ALICE) })).body;
  assert.equal(st.spins[0].deliveryBy, d.deliveryBy.toISOString());
  assert.equal(st.secondOrder, 'pending');
});

test('D02 delivered BEFORE the 7 days: 120 h from the delivery for the actual second order (>= 15 JOD)', async () => {
  const { o } = await linkedSetup();
  assert.equal((await setStatus(o.id, 'delivered')).status, 200);
  const d = await spinDoc(ALICE);
  const L = await getDecoded(`orderLedger/${o.id}`);
  assert.equal(d.status, 'issued');
  assert.equal(d.expiresAt.getTime() - L.deliveredAt.getTime(), 120 * H);
  assert.equal(d.deliveryBy, null, 'the delivery deadline is over: it was met');
  const r = await place(ALICE, cartOrder(ALICE, 'p-15', { discount: 4 }), `${CID}_${ALICE}_1`);
  assert.equal(r.status, 200, r.text);
});

test('D03 NOT delivered within 7 days: the prize ends by itself (cleanup), unit back ONCE — the first ORDER is untouched (status, reservation, stock)', async () => {
  const { o } = await linkedSetup();
  const before = await getDecoded(`orders/${o.id}`);
  const ledgerBefore = await getDecoded(`orderLedger/${o.id}`);
  const resBefore = await getDecoded('stockReservations/p-5');
  assert.equal(await remaining(), 2);
  await sevenDaysOver(ALICE);
  const c1 = await runCron(env());
  assert.equal(c1.wheel.expired, 1);
  const d = await spinDoc(ALICE);
  assert.equal(d.status, 'expired');
  assert.equal(d.expiredReason, 'first_order_not_delivered');
  assert.equal(await remaining(), 3);
  // the order: not one byte changed (same document version), still shipped, its reservation and stock as they were
  const after = await getDecoded(`orders/${o.id}`);
  assert.equal(after.__raw.updateTime, before.__raw.updateTime);
  assert.equal(after.status, 'shipped');
  assert.equal((await getDecoded(`orderLedger/${o.id}`)).__raw.updateTime, ledgerBefore.__raw.updateTime);
  assert.deepEqual(strip(await getDecoded('stockReservations/p-5')), strip(resBefore));
  assert.equal((await getDecoded('products/p-5')).stock, 50);
  // delivered LATE afterwards: the order is delivered normally; the prize stays ended, nothing returned twice
  assert.equal((await setStatus(o.id, 'delivered')).status, 200);
  assert.equal((await getDecoded(`orders/${o.id}`)).status, 'delivered');
  assert.equal((await getDecoded('products/p-5')).stock, 49, 'stock deducted on delivery as usual');
  assert.equal((await spinDoc(ALICE)).status, 'expired');
  await runCron(env());
  assert.equal(await remaining(), 3);
  assert.equal((await place(ALICE, cartOrder(ALICE, 'p-15', { discount: 4 }), `${CID}_${ALICE}_1`)).body.code, 'WHEEL_PRIZE_EXPIRED');
});

test('D04 the EXACT boundary (controlled clock): delivered 1 ms before 168 h -> activated; at exactly 168 h -> not; the cleanup ends it at exactly 168 h, not 1 ms before', async () => {
  const { o, L, deliveryBy } = await linkedSetup();
  const fs = adminDb();
  const cfg = loadConfig(env());
  const activates = (writes) => writes.some((w) => w.update?.name?.endsWith(spinPath(ALICE)) && w.update.fields.status?.stringValue === 'issued');
  assert.equal(activates(await wheelStatusWrites(fs, L, o.id, 'shipped', 'delivered', new Date(deliveryBy - 1))), true, '1 ms before: in time');
  assert.equal(activates(await wheelStatusWrites(fs, L, o.id, 'shipped', 'delivered', new Date(deliveryBy))), false, 'exactly 168 h: too late');
  assert.equal(activates(await wheelStatusWrites(fs, L, o.id, 'shipped', 'delivered', new Date(deliveryBy + 1))), false);
  assert.equal((await expireUnclaimedPrizes(fs, cfg, { now: deliveryBy - 1 })).expired, 0, '1 ms before: still kept');
  assert.equal((await spinDoc(ALICE)).status, 'waiting');
  assert.equal((await expireUnclaimedPrizes(fs, cfg, { now: deliveryBy })).expired, 1, 'exactly 168 h: ended');
  assert.equal((await spinDoc(ALICE)).status, 'expired');
  assert.equal(await remaining(), 3);
  assert.equal((await expireUnclaimedPrizes(fs, cfg, { now: deliveryBy + H })).expired, 0, 'never twice');
  assert.equal(await remaining(), 3);
});

test('D05 RACE delivery vs cleanup (deterministic): a delivery prepared before the deadline whose commit comes AFTER the cleanup ended the prize is refused by the prize version — nothing activated, unit returned once', async () => {
  const { o, L, deliveryBy } = await linkedSetup();
  const fs = adminDb();
  const cfg = loadConfig(env());
  // the delivery reads the waiting prize (version v1) and prepares its activation, 1 ms before the deadline...
  const writes = await wheelStatusWrites(fs, L, o.id, 'shipped', 'delivered', new Date(deliveryBy - 1));
  const activation = writes.find((w) => w.update?.name?.endsWith(spinPath(ALICE)));
  assert.ok(activation);
  // ...meanwhile the cleanup ends it (deadline reached)
  assert.equal((await expireUnclaimedPrizes(fs, cfg, { now: deliveryBy })).expired, 1);
  // ...the delivery's activation commits on v1: refused (the real status change retries and finds nothing to activate)
  const r = await fs.commit([activation]);
  assert.equal(r.ok, false);
  assert.ok(isConflict(r));
  assert.equal((await spinDoc(ALICE)).status, 'expired');
  assert.equal(await remaining(), 3);
  // the other order of events: the delivery activates first -> the cleanup's later run finds nothing to end
  await clearDb(); await seedProducts(PRODUCTS); await putDoc('config/roles', { ownerUid: OWNER }); await seed();
  const B = 'bobUid00000000000000000000000B1';
  const s2 = await linkedSetup(B);
  assert.equal((await setStatus(s2.o.id, 'delivered')).status, 200);
  // (now: the 120 h after that delivery are still running — a cleanup run finds nothing to end)
  assert.equal((await expireUnclaimedPrizes(fs, cfg, { now: Date.now() + 1000 })).expired, 0);
  assert.equal((await spinDoc(B)).status, 'issued');
  assert.equal(await remaining(), 2);
});

test('D06 RACE (real, concurrent): the delivery request and 3 cleanup runs at the same moment, deadline passed / not passed -> one consistent outcome, unit returned at most once, the order always delivered', async () => {
  for (const late of [true, false, true, false]) {
    await clearDb(); await seedProducts(PRODUCTS); await putDoc('config/roles', { ownerUid: OWNER }); await seed();
    const { o } = await linkedSetup();
    if (late) await sevenDaysOver(ALICE);
    const [del] = await Promise.all([setStatus(o.id, 'delivered'), runCron(env()), runCron(env()), runCron(env())]);
    assert.equal(del.status, 200, del.text);
    assert.equal((await getDecoded(`orders/${o.id}`)).status, 'delivered', 'the order is never blocked by the prize');
    const d = await spinDoc(ALICE);
    if (late) {
      assert.equal(d.status, 'expired');
      assert.equal(await remaining(), 3, 'returned exactly once');
    } else {
      assert.equal(d.status, 'issued');
      assert.equal(await remaining(), 2, 'still held for the second order');
    }
  }
});

test('D07 repeated cleanup: sequential and concurrent runs after the deadline return the unit exactly once', async () => {
  await linkedSetup();
  await sevenDaysOver(ALICE);
  const runs = await Promise.all([runCron(env()), runCron(env()), runCron(env()), runCron(env())]);
  for (let i = 0; i < 3; i++) runs.push(await runCron(env()));
  assert.equal(runs.reduce((n, r) => n + r.wheel.expired, 0), 1);
  assert.equal(await remaining(), 3);
});

test('D08 first order cancelled: re-evaluated as agreed — another order created in time takes its place only if IT can still be delivered within its own 168 h', async () => {
  const BOB = 'bobUid00000000000000000000000B1';
  const a = cartOrder(BOB, 'p-5');
  assert.equal((await place(BOB, a)).status, 200);
  const b = cartOrder(BOB, 'p-5');
  assert.equal((await place(BOB, b)).status, 200);
  await spin(BOB);
  // two open orders when winning = the account is already past its actual second order -> not drawn
  assert.notEqual((await spinDoc(BOB)).prizeId, 'second-4');
  // one open order: linked; then another order is created and the linked one cancelled
  const { o } = await linkedSetup(ALICE);
  const other = cartOrder(ALICE, 'p-5');
  assert.equal((await place(ALICE, other)).status, 200);
  // (i) the other order is fresh -> takes its place, with ITS OWN 168 h
  assert.equal((await setStatus(o.id, 'cancelled')).status, 200);
  let d = await spinDoc(ALICE);
  const OL = await getDecoded(`orderLedger/${other.id}`);
  assert.equal(d.firstOrderId, other.id);
  assert.equal(d.deliveryBy.getTime(), OL.createdAt.getTime() + 168 * H);
  // (ii) that order is 8 days old (its 168 h over) and it is the only candidate after a cancellation -> expired, once
  const C = 'carolUid00000000000000000000C1';
  const first = await linkedSetup(C);
  const old = cartOrder(C, 'p-5');
  assert.equal((await place(C, old)).status, 200);
  await rewrite(`orders/${old.id}`, { createdAt: new Date(Date.now() - 8 * 24 * H) });
  await rewrite(spinPath(C), { firstOrderBy: new Date(Date.now() + H) });
  assert.equal((await setStatus(first.o.id, 'cancelled')).status, 200);
  d = await spinDoc(C);
  assert.notEqual(d.firstOrderId, old.id, 'an order past its own 168 h never keeps the prize');
});

test('D09 guest spin linked at checkout while the first order is open: the 168 h count from that ORDER\'s creation; the customer sees the delivery deadline', async () => {
  const o = cartOrder(ALICE, 'p-5');
  assert.equal((await place(ALICE, o)).status, 200);
  const t = randomBytes(32).toString('base64url');
  await callWorker(env(), { method: 'POST', path: '/wheel/guest/spin', headers: { origin: 'https://dairsharaf.com' }, body: { ticket: t } });
  const c = await callWorker(env(), { method: 'POST', path: '/wheel/guest/claim', headers: await authH(ALICE), body: { ticket: t } });
  assert.equal(c.status, 200, c.text);
  const d = await spinDoc(ALICE);
  const OL = await getDecoded(`orderLedger/${o.id}`);
  assert.equal(d.status, 'waiting');
  assert.equal(d.firstOrderId, o.id);
  assert.equal(d.deliveryBy.getTime(), OL.createdAt.getTime() + 168 * H);
  // a first order created AFTER the win (not linked yet): the account still sees its delivery deadline
  const B = 'bobUid00000000000000000000000B1';
  await spin(B);
  const ob = cartOrder(B, 'p-5');
  assert.equal((await place(B, ob)).status, 200);
  const st = (await callWorker(env(), { path: '/wheel/state', headers: await authH(B) })).body;
  const OB = await getDecoded(`orderLedger/${ob.id}`);
  assert.equal(st.spins[0].deliveryBy, new Date(OB.createdAt.getTime() + 168 * H).toISOString());
  assert.equal(st.spins[0].firstOrderId, ob.id);
});
