// LOCAL ONLY: the real Worker (src/index.js) + Firestore EMULATOR (demo- project) + mock JWKS with TEST keys.
//   node <emu.mjs> . demo-dairsharaf-orders "node --test --test-concurrency=1 test/wheel-hold.test.mjs"
// Owner's rule: a won prize is valid 60 MINUTES from the spin. Past it: unusable, its unit goes back by itself (cron +
// before every spin), exactly once. Attached to an order in time: it follows the order, not the clock.
// Time is moved by rewriting the stored dates into the past (the Worker reads them like any other value).
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
const MIN = 60_000;

let mock;
let signer;
const origLog = console.log;
const WHEEL = { STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', PRICE_CHECK_MODE: 'enforce', WHEEL_MODE: 'test', WHEEL_CAMPAIGN: CID, WHEEL_PHONE_SECRET: 'test-only-wheel-phone-secret-0123456789', WHEEL_GUEST_PER_IP_DAY: '100' };
const env = (o = {}) => makeEnv(mock.url, { ...WHEEL, ...o });
const token = (uid) => signer.idToken({ projectId: PROJECT_ID, uid, extra: { email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'google.com' } } });
const authH = async (uid) => ({ origin: 'https://dairsharaf.com', authorization: `Bearer ${await token(uid)}` });
const ORIGIN = { origin: 'https://dairsharaf.com' };

const PRODUCTS = { 'p-5': { name: 'منتج 5', price: 5, stock: 20 }, 'p-15': { name: 'منتج 15', price: 15, stock: 20 }, 'p-watch': { name: 'ساعة هدية', price: 9, stock: 3 } };
const DISC = (o = {}) => ({ id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5, weight: 1_000_000, quantity: 2, ...o });
const WATCH = (o = {}) => ({ id: 'watch', type: 'gift', label: 'ساعة', productId: 'p-watch', unitCostJod: 9, minOrderJod: 5, weight: 1_000_000, quantity: 2, ...o });
const NONE = { id: 'none-1', type: 'none', label: 'حظ أوفر', weight: 1 };
const campaign = (prizes, extra = {}) => ({
  active: true, minOrderJod: 5, budgetJod: 500, giftOnCancel: 'return', prizeValidDays: 30,
  startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', terms: 'شروط تجريبية', prizes, ...extra,
});
async function seed(prizes, extra) {
  await putDoc(`wheelCampaigns/${CID}`, campaign(prizes, extra));
  for (const p of prizes) if (p.type !== 'none') await putDoc(`wheelPool/${CID}_${p.id}`, { remaining: p.quantity });
}
const remaining = async (id = 'disc-1') => (await getDecoded(`wheelPool/${CID}_${id}`))?.remaining;
const spinPath = (uid, n = 1) => `wheelSpins/${CID}_${uid}_${n}`;
const spinDoc = (uid, n = 1) => getDecoded(spinPath(uid, n));
/** moves the stored window of a document `minutes` into the past (only the date fields that exist) */
async function age(path, minutes = 61) {
  const { __raw, ...d } = await getDecoded(path);
  const past = new Date(Date.now() - minutes * MIN);
  for (const f of ['expiresAt', 'issuedExpiry', 'holdExpiry']) if (d[f] instanceof Date) d[f] = past;
  await putDoc(path, d);
}

before(async () => {
  mock = await startMockServices();
  signer = await makeTestSigner('kid-wheel-hold');
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

const spin = async (uid, e = env()) => callWorker(e, { method: 'POST', path: '/wheel/spin', headers: await authH(uid), body: {} });
const gSpin = (ticket, e = env()) => callWorker(e, { method: 'POST', path: '/wheel/guest/spin', headers: ORIGIN, body: { ticket } });
const gClaim = async (uid, ticket) => callWorker(env(), { method: 'POST', path: '/wheel/guest/claim', headers: await authH(uid), body: { ticket } });
function cartOrder(uid, productId, { discount = 0, shipping = 1, id = makeOrderId() } = {}) {
  const price = PRODUCTS[productId].price;
  const items = [{ productId, name: productId, price, quantity: 1, image: '', selectedVariant: null }];
  return checkoutOrder({ id, userId: uid, items, overrides: { subtotal: price, discountAmount: discount, shippingCost: shipping, total: Math.max(0, price - discount + shipping) } });
}
const place = async (uid, o, spinId) => callWorker(env(), { method: 'POST', path: '/create-order', headers: await authH(uid), body: { order: o, ...(spinId ? { wheelSpinId: spinId } : {}) } });
const setStatus = async (id, status) => callWorker(env(), { method: 'POST', path: `/admin/orders/${encodeURIComponent(id)}/status`, headers: await authH(OWNER), body: { status } });
const reservedOf = async (pid) => (await getDecoded(`stockReservations/${pid}`))?.product || 0;

test('H01 a won prize is valid 60 minutes from the spin (account and guest); the window is a server setting', async () => {
  await seed([DISC({ quantity: 5 })]);
  const s = await spin(ALICE);
  const d = await spinDoc(ALICE);
  assert.equal(d.expiresAt.getTime() - d.createdAt.getTime(), 60 * MIN);
  assert.equal(d.issuedExpiry.getTime(), d.expiresAt.getTime());
  assert.equal(s.body.result.expiresAt, d.expiresAt.toISOString(), 'the customer is shown the same end time');
  const g = (await gSpin(randomBytes(32).toString('base64url'))).body.result;
  assert.equal(Date.parse(g.expiresAt) - Date.parse(g.holdUntil), 0);
  assert.ok(Math.abs(Date.parse(g.expiresAt) - Date.now() - 60 * MIN) < 30_000);
  const pub = await callWorker(env(), { path: '/wheel/public', headers: ORIGIN });
  assert.equal(pub.body.prizeHoldMinutes, 60);
  // WHEEL_PRIZE_HOLD_MINUTES changes it (bounded 5..1440)
  await spin(BOB, env({ WHEEL_PRIZE_HOLD_MINUTES: '15' }));
  const b = await spinDoc(BOB);
  assert.equal(b.expiresAt.getTime() - b.createdAt.getTime(), 15 * MIN);
});

test('H02 past 60 minutes: the prize cannot be used (nothing written); the cron frees its unit ONCE; the state shows it expired', async () => {
  await seed([DISC()]);
  const s = (await spin(ALICE)).body.result;
  assert.equal(await remaining(), 1);
  await age(spinPath(ALICE));
  const o = cartOrder(ALICE, 'p-5', { discount: 1 });
  const r = await place(ALICE, o, s.spinId);
  assert.equal(r.body.code, 'WHEEL_PRIZE_EXPIRED', r.text);
  assert.equal(await getDecoded(`orders/${o.id}`), null);
  assert.equal(await count('orders'), 0);
  const c1 = await runCron(env());
  assert.equal(c1.wheel.expired, 1);
  assert.equal((await runCron(env())).wheel.expired, 0);
  assert.equal(await remaining(), 2, 'the unit came back once');
  assert.equal((await spinDoc(ALICE)).status, 'expired');
  // the same order WITHOUT the prize still goes through (the prize never blocks shopping)
  assert.equal((await place(ALICE, cartOrder(ALICE, 'p-5'))).status, 200);
});

test('H03 an expired prize is never counted as held: the next spin frees it first (no wait for the cron)', async () => {
  await seed([DISC({ quantity: 1 }), NONE]);
  assert.equal((await spin(ALICE)).body.result.prizeId, 'disc-1');
  assert.equal(await remaining(), 0);
  // while valid, the last unit is Alice's: Bob cannot win it
  const early = await spin(BOB);
  assert.equal(early.body.result.prizeId, 'none-1');
  await age(spinPath(ALICE));
  const CAROL = 'carolUid00000000000000000000C1';
  const late = await spin(CAROL);
  assert.equal(late.body.result.prizeId, 'disc-1', 'freed before the draw');
  assert.equal((await spinDoc(ALICE)).status, 'expired');
  assert.equal(await remaining(), 0);
  assert.equal((await runCron(env())).wheel.expired, 0, 'nothing left for the cron: never returned twice');
});

test('H04 attached to an order IN TIME: the 60 minutes passing afterwards changes nothing; delivery consumes it', async () => {
  await seed([DISC()]);
  const s = (await spin(ALICE)).body.result;
  const o = cartOrder(ALICE, 'p-5', { discount: 1 });
  assert.equal((await place(ALICE, o, s.spinId)).status, 200);
  assert.equal((await spinDoc(ALICE)).status, 'reserved');
  await age(spinPath(ALICE));
  assert.equal((await runCron(env())).wheel.expired, 0, 'the cron never touches a prize held by an order');
  assert.equal((await spin(BOB)).status, 200); // the release before a spin does not touch it either
  assert.equal((await spinDoc(ALICE)).status, 'reserved');
  for (const st of ['processing', 'shipped', 'delivered']) assert.equal((await setStatus(o.id, st)).status, 200, st);
  assert.equal((await spinDoc(ALICE)).status, 'consumed');
  assert.equal((await getDecoded(`orders/${o.id}`)).wheelPrize.discountJod, 1);
});

test('H05 cancelled AFTER the window ("return" policy): the prize ends (not given back), its unit and the gift stock come back ONCE', async () => {
  await seed([WATCH()]);
  const s = (await spin(ALICE)).body.result;
  assert.equal(s.prizeId, 'watch');
  const o = cartOrder(ALICE, 'p-5');
  assert.equal((await place(ALICE, o, s.spinId)).status, 200);
  assert.equal(await reservedOf('p-watch'), 1);
  assert.equal(await remaining('watch'), 1);
  await age(spinPath(ALICE));
  assert.equal((await setStatus(o.id, 'cancelled')).status, 200);
  const d = await spinDoc(ALICE);
  assert.equal(d.status, 'expired');
  assert.equal(d.orderId, null);
  assert.equal(await remaining('watch'), 2, 'unit back');
  assert.equal(await reservedOf('p-watch'), 0, 'gift stock reservation released');
  assert.equal((await getDecoded('products/p-watch')).stock, 3, 'nothing deducted');
  // repeated cancellation / cron / next spin: never twice
  const again = await setStatus(o.id, 'cancelled');
  assert.equal(again.body.result, 'unchanged', again.text);
  await runCron(env());
  await spin(BOB);
  assert.equal(await remaining('watch') + ((await spinDoc(BOB)).prizeId === 'watch' ? 1 : 0), 2);
  assert.equal((await place(ALICE, cartOrder(ALICE, 'p-5'), s.spinId)).body.code, 'WHEEL_PRIZE_EXPIRED');
});

test('H06 cancelled INSIDE the window ("return"): the prize is usable again until the SAME end time; then freed once', async () => {
  await seed([DISC()]);
  const s = (await spin(ALICE)).body.result;
  const end = (await spinDoc(ALICE)).expiresAt.getTime();
  const o = cartOrder(ALICE, 'p-5', { discount: 1 });
  assert.equal((await place(ALICE, o, s.spinId)).status, 200);
  assert.equal((await setStatus(o.id, 'cancelled')).status, 200);
  const d = await spinDoc(ALICE);
  assert.equal(d.status, 'issued');
  assert.equal(d.expiresAt.getTime(), end, 'never a longer window');
  assert.equal(d.issuedExpiry.getTime(), end);
  assert.equal(await remaining(), 1);
  await age(spinPath(ALICE));
  assert.equal((await runCron(env())).wheel.expired, 1);
  assert.equal((await runCron(env())).wheel.expired, 0);
  assert.equal(await remaining(), 2);
});

test('H07 policy "expire": a cancelled order ends the prize and frees its unit once (inside the window too)', async () => {
  await seed([DISC()], { giftOnCancel: 'expire' });
  const s = (await spin(ALICE)).body.result;
  const o = cartOrder(ALICE, 'p-5', { discount: 1 });
  assert.equal((await place(ALICE, o, s.spinId)).status, 200);
  assert.equal((await setStatus(o.id, 'cancelled')).status, 200);
  assert.equal((await spinDoc(ALICE)).status, 'expired');
  assert.equal(await remaining(), 2);
  await runCron(env());
  assert.equal(await remaining(), 2);
});

test('H08 races: orders + crons + spins at the expiry moment; several different orders on one valid prize -> never two uses, units back once', async () => {
  await seed([DISC({ quantity: 3 }), NONE]);
  const s = (await spin(ALICE)).body.result;
  await age(spinPath(ALICE));
  const orders = [1, 2, 3].map(() => cartOrder(ALICE, 'p-5', { discount: 1 }));
  const res = await Promise.all([...orders.map((o) => place(ALICE, o, s.spinId)), runCron(env()), runCron(env()), runCron(env()), spin(BOB), spin(BOB)]);
  for (const r of res.slice(0, 3)) assert.equal(r.body.code, 'WHEEL_PRIZE_EXPIRED', r.text);
  assert.equal(await count('orders'), 0);
  assert.equal((await spinDoc(ALICE)).status, 'expired');
  const bobWon = (await spinDoc(BOB))?.prizeId === 'disc-1' ? 1 : 0;
  assert.equal(await remaining() + bobWon, 3, 'Alice\'s unit came back exactly once');
  // a VALID prize, five DIFFERENT orders at once: exactly one gets it
  const CAROL = 'carolUid00000000000000000000C1';
  const c = (await spin(CAROL)).body.result;
  assert.equal(c.prizeId, 'disc-1');
  const five = Array.from({ length: 5 }, () => cartOrder(CAROL, 'p-5', { discount: 1 }));
  const rr = await Promise.all(five.map((o) => place(CAROL, o, c.spinId)));
  assert.equal(rr.filter((r) => r.status === 200).length, 1, rr.map((r) => `${r.status}:${r.body?.code}`).join(','));
  // every other one refused: the prize is taken, or (same delivery number) its open-prize slot is — either refusal is right
  assert.ok(rr.filter((r) => r.status !== 200).every((r) => ['WHEEL_PRIZE_USED', 'WHEEL_PHONE_LIMIT'].includes(r.body.code)), rr.map((r) => `${r.status}:${r.body?.code}`).join(','));
  assert.equal(await count('orders'), 1);
});

test('H09 guest ticket: claimed in time, then unused past the 60 minutes -> unusable, unit back ONCE (ticket and account never both)', async () => {
  await seed([DISC()]);
  const t = randomBytes(32).toString('base64url');
  await gSpin(t);
  assert.equal(await remaining(), 1);
  const c = await gClaim(ALICE, t);
  assert.equal(c.status, 200, c.text);
  await age(spinPath(ALICE));
  const r = await runCron(env());
  assert.equal(r.wheel.expired + r.guest.released, 1);
  await runCron(env());
  assert.equal(await remaining(), 2);
  assert.equal((await place(ALICE, cartOrder(ALICE, 'p-5', { discount: 1 }), c.body.spinId)).body.code, 'WHEEL_PRIZE_EXPIRED');
  assert.equal((await getDecoded(await guestPath(CID, t))).status, 'claimed');
});
