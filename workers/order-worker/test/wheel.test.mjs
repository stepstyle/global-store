// LOCAL ONLY: the real Worker (src/index.js) + Firestore EMULATOR (demo- project) + mock JWKS with TEST keys.
//   node <emu.mjs> . demo-dairsharaf-orders "node --test --test-concurrency=1 test/wheel.test.mjs"
// Prize wheel, WHEEL_MODE=test, with TEST settings only (not real prizes, prices or probabilities).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runCron, startMockServices, makeEnv, callWorker, clearDb, seedProducts, putDoc, getDecoded, productStock, variantStock, count, PROJECT_ID } from './helpers.mjs';
import { checkoutOrder, makeOrderId, line } from './fixtures.mjs';
import { makeTestSigner } from './token-signer.mjs';
import { clearKeyCache } from '../src/auth.js';

const OWNER = 'ownerUid00000000000000000000O1';
const ALICE = 'aliceUid000000000000000000A1';
const BOB = 'bobUid00000000000000000000000B1';
const CID = 'test-campaign';

let mock;
let signer;
const origLog = console.log;
const WHEEL = { STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', WHEEL_MODE: 'test', WHEEL_CAMPAIGN: CID, WHEEL_PHONE_SECRET: 'test-only-wheel-phone-secret-0123456789' };
const env = (o = {}) => makeEnv(mock.url, { ...WHEEL, ...o });
const offEnv = () => makeEnv(mock.url, { STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply' });
// Google / verified e-mail accounts (email_verified true) unless a test says otherwise
const token = (uid, extra = { email: `${uid}@example.invalid`, email_verified: true }) => signer.idToken({ projectId: PROJECT_ID, uid, extra });
const authH = async (uid) => ({ origin: 'https://dairsharaf.com', authorization: `Bearer ${await token(uid)}` });

// one prize, always won while it lasts (noPrizeWeight 0) -> deterministic tests
const CAMPAIGN = {
  active: true, minOrderJod: 5, budgetJod: 10, noPrizeWeight: 0, giftOnCancel: 'return',
  startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', terms: 'شروط تجريبية',
  prizes: [{ id: 'test-a', label: 'جائزة تجريبية', productId: 'p-hundred', weight: 1, quantity: 3, unitCostJod: 1 }],
};
async function seedCampaign(c = CAMPAIGN, remaining = 3) {
  await putDoc(`wheelCampaigns/${CID}`, c);
  for (const p of c.prizes) await putDoc(`wheelPool/${CID}_${p.id}`, { remaining });
}

before(async () => {
  mock = await startMockServices();
  signer = await makeTestSigner('kid-wheel');
  console.log = () => {};
});
after(async () => { console.log = origLog; await mock?.close(); });
beforeEach(async () => {
  mock.reset();
  clearKeyCache();
  mock.state.jwks = { keys: [signer.jwk] };
  await clearDb();
  await seedProducts();
  await putDoc('config/roles', { ownerUid: OWNER });
  await seedCampaign();
});

const spin = async (uid, e = env()) => callWorker(e, { method: 'POST', path: '/wheel/spin', headers: uid ? await authH(uid) : { origin: 'https://dairsharaf.com' }, body: {} });
const state = async (uid, e = env()) => callWorker(e, { path: '/wheel/state', headers: await authH(uid) });
const pool = async () => (await getDecoded(`wheelPool/${CID}_test-a`)).remaining;
async function order(uid, { items, spinId, e = env() } = {}) {
  const o = checkoutOrder({ id: makeOrderId(), userId: uid || 'guest', ...(items ? { items } : {}) });
  const r = await callWorker(e, { method: 'POST', path: '/create-order', headers: uid ? await authH(uid) : {}, body: { order: o, ...(spinId !== undefined ? { wheelSpinId: spinId } : {}) } });
  return { o, r };
}
const setStatus = async (id, status, extra = {}) => callWorker(env(), { method: 'POST', path: `/admin/orders/${encodeURIComponent(id)}/status`, headers: await authH(OWNER), body: { status, ...extra } });
const reserved = async (pid) => (await getDecoded(`stockReservations/${pid}`))?.product || 0;

test('W01 wheel OFF (default): routes 404, a prize in an order is refused, normal orders unchanged', async () => {
  assert.equal((await spin(ALICE, offEnv())).status, 404);
  assert.equal((await state(ALICE, offEnv())).status, 404);
  const bad = await order(ALICE, { spinId: `${CID}_${ALICE}_1`, e: offEnv() });
  assert.equal(bad.r.status, 422);
  assert.equal(bad.r.body.code, 'WHEEL_OFF');
  const ok = await order(ALICE, { e: offEnv() });
  assert.equal(ok.r.status, 200, ok.r.text);
  assert.equal((await getDecoded(`orderLedger/${ok.o.id}`)).wheel, undefined);
  assert.equal(await count('wheelSpins'), 0);
});

test('W02 spin needs a verified account', async () => {
  const r = await spin(null);
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'AUTH_REQUIRED');
  const forged = await callWorker(env(), { method: 'POST', path: '/wheel/spin', headers: { authorization: 'Bearer not-a-token' }, body: {} });
  assert.equal(forged.status, 401);
});

test('W03 first spin: stored server-side, pool decremented once; a retry returns the SAME stored result', async () => {
  const a = await spin(ALICE);
  assert.equal(a.status, 200, a.text);
  assert.equal(a.body.repeated, false);
  assert.equal(a.body.result.prizeId, 'test-a');
  assert.equal(a.body.result.spinId, `${CID}_${ALICE}_1`);
  assert.equal(await pool(), 2);
  const b = await spin(ALICE);
  assert.equal(b.status, 200);
  assert.equal(b.body.repeated, true);
  assert.deepEqual(b.body.result, a.body.result);
  assert.equal(await pool(), 2, 'no second draw');
  const s = await state(ALICE);
  assert.equal(s.body.chancesLeft, 0);
  assert.equal(s.body.spins.length, 1);
});

test('W04 ten parallel spins of one account (tabs / double click): exactly one draw', async () => {
  const rs = await Promise.all(Array.from({ length: 10 }, () => spin(ALICE)));
  for (const r of rs) assert.equal(r.status, 200, r.text);
  assert.equal(rs.filter((r) => r.body.repeated === false).length, 1);
  assert.equal(await count('wheelSpins'), 1);
  assert.equal(await pool(), 2);
});

test('W05 pool exhaustion under concurrency: never more prizes than the quantity', async () => {
  await seedCampaign(CAMPAIGN, 2);
  const users = Array.from({ length: 6 }, (_, i) => `user${i}Uid0000000000000000000U${i}`);
  const rs = await Promise.all(users.map((u) => spin(u)));
  for (const r of rs) assert.equal(r.status, 200, r.text);
  const winners = rs.filter((r) => r.body.result.prizeId === 'test-a').length;
  assert.equal(winners, 2);
  assert.equal(rs.filter((r) => r.body.result.prizeId === 'none').length, 4);
  assert.equal(await pool(), 0);
});

test('W06 closed / ended campaign: no spin', async () => {
  await putDoc(`wheelCampaigns/${CID}`, { ...CAMPAIGN, active: false });
  const r = await spin(ALICE);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'CAMPAIGN_CLOSED');
  await putDoc(`wheelCampaigns/${CID}`, { ...CAMPAIGN, endsAt: '2026-02-01T00:00:00Z' });
  assert.equal((await spin(ALICE)).body.code, 'CAMPAIGN_ENDED');
  await putDoc(`wheelCampaigns/${CID}`, { ...CAMPAIGN, budgetJod: 1 }); // 3 x 1 JOD > 1 JOD
  assert.equal((await spin(ALICE)).body.code, 'CAMPAIGN_INVALID');
  assert.equal(await count('wheelSpins'), 0);
});

test('W07 prize redeemed with an order: gift line reserved, spin reserved, order shows the gift at price 0', async () => {
  const s = await spin(ALICE);
  const { o, r } = await order(ALICE, { spinId: s.body.result.spinId });
  assert.equal(r.status, 200, r.text);
  const L = await getDecoded(`orderLedger/${o.id}`);
  const gift = L.orderLines.find((l) => l.gift);
  assert.equal(gift.index, 1000);
  assert.equal(gift.productId, 'p-hundred');
  assert.equal(gift.unitPrice, 0);
  assert.equal(L.serverPricing.subtotal, 8, 'the gift is never priced');
  assert.equal(L.wheel.spinId, s.body.result.spinId);
  assert.equal(L.wheel.chanceEligible, true);
  assert.equal(await reserved('p-hundred'), 1);
  assert.equal(await productStock('p-hundred'), 100, 'nothing deducted before delivery');
  const sp = await getDecoded(`wheelSpins/${s.body.result.spinId}`);
  assert.equal(sp.status, 'reserved');
  assert.equal(sp.orderId, o.id);
  const O = await getDecoded(`orders/${o.id}`);
  assert.equal(O.items.filter((i) => i.gift).length, 1);
  assert.equal(O.items.find((i) => i.gift).price, 0);
  assert.equal(O.total, 8 - 0.8 + 1, 'the customer pays the same total');
});

test('W08 a prize cannot be used twice, by someone else, or by a guest', async () => {
  const s = await spin(ALICE);
  const id = s.body.result.spinId;
  assert.equal((await order(ALICE, { spinId: id })).r.status, 200);
  const again = await order(ALICE, { spinId: id });
  assert.equal(again.r.status, 422);
  assert.equal(again.r.body.code, 'WHEEL_PRIZE_USED');
  const bob = await order(BOB, { spinId: id });
  assert.equal(bob.r.body.code, 'WHEEL_PRIZE_INVALID');
  const guest = await order(null, { spinId: id });
  assert.equal(guest.r.status, 401);
  assert.equal(guest.r.body.code, 'WHEEL_SIGN_IN_REQUIRED');
  const forged = await order(ALICE, { spinId: '../products/p-simple' });
  assert.equal(forged.r.body.code, 'WHEEL_PRIZE_INVALID');
  assert.equal(await reserved('p-hundred'), 1);
});

test('W09 two orders racing for the same prize: only one gets it', async () => {
  const s = await spin(ALICE);
  const rs = await Promise.all([order(ALICE, { spinId: s.body.result.spinId }), order(ALICE, { spinId: s.body.result.spinId })]);
  assert.deepEqual(rs.map((x) => x.r.status).sort(), [200, 422]);
  assert.equal(await reserved('p-hundred'), 1);
});

test('W10 below the minimum (paid products only, shipping excluded): refused, nothing written, prize kept', async () => {
  const s = await spin(ALICE);
  // 1 x 2.5 + shipping 1 = 3.5 total, products 2.5 < 5
  const { o, r } = await order(ALICE, { items: [line('p-simple', 1)], spinId: s.body.result.spinId });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'WHEEL_MIN_ORDER');
  assert.equal(await getDecoded(`orderLedger/${o.id}`), null);
  assert.equal(await getDecoded(`orders/${o.id}`), null);
  assert.equal(await reserved('p-simple'), 0);
  assert.equal((await getDecoded(`wheelSpins/${s.body.result.spinId}`)).status, 'issued');
});

test('W11 delivered: the gift is deducted once, prize consumed, ONE new chance per order', async () => {
  const s = await spin(ALICE);
  const { o } = await order(ALICE, { spinId: s.body.result.spinId });
  assert.equal((await setStatus(o.id, 'delivered')).status, 200);
  assert.equal(await productStock('p-hundred'), 99);
  assert.equal(await reserved('p-hundred'), 0);
  assert.equal((await getDecoded(`wheelSpins/${s.body.result.spinId}`)).status, 'consumed');
  const e = await getDecoded(`wheelEntitlements/${CID}_${ALICE}`);
  assert.equal(e.granted, 2);
  assert.equal(e.used, 1);
  const again = await setStatus(o.id, 'delivered');
  assert.equal(again.body.result, 'unchanged');
  assert.equal((await getDecoded(`wheelEntitlements/${CID}_${ALICE}`)).granted, 2, 'never granted twice');
  assert.equal((await state(ALICE)).body.chancesLeft, 1);
});

test('W12 cancelled before delivery: gift reservation released, prize back to issued and usable again', async () => {
  const s = await spin(ALICE);
  const { o } = await order(ALICE, { spinId: s.body.result.spinId });
  assert.equal((await setStatus(o.id, 'cancelled')).status, 200);
  assert.equal(await reserved('p-hundred'), 0);
  assert.equal(await productStock('p-hundred'), 100);
  assert.equal((await getDecoded(`wheelSpins/${s.body.result.spinId}`)).status, 'issued');
  assert.equal(await count('wheelGrants'), 0, 'a cancelled order earns no chance');
  assert.equal((await order(ALICE, { spinId: s.body.result.spinId })).r.status, 200);
});

test('W13 giftOnCancel=expire: the prize is not given back', async () => {
  await putDoc(`wheelCampaigns/${CID}`, { ...CAMPAIGN, giftOnCancel: 'expire' });
  const s = await spin(ALICE);
  const { o } = await order(ALICE, { spinId: s.body.result.spinId });
  await setStatus(o.id, 'cancelled');
  assert.equal((await getDecoded(`wheelSpins/${s.body.result.spinId}`)).status, 'expired');
  // an expired prize is refused with its own code (the earlier generic WHEEL_PRIZE_USED became WHEEL_PRIZE_EXPIRED)
  assert.equal((await order(ALICE, { spinId: s.body.result.spinId })).r.body.code, 'WHEEL_PRIZE_EXPIRED');
});

test('W14 returned after delivery: the chance earned by the order is taken back (once)', async () => {
  const { o } = await order(ALICE);
  await setStatus(o.id, 'delivered');
  assert.equal((await getDecoded(`wheelEntitlements/${CID}_${ALICE}`)).granted, 2, 'first free chance + this order');
  const r = await setStatus(o.id, 'cancelled', { confirmReturn: true });
  assert.equal(r.status, 200, r.text);
  assert.equal((await getDecoded(`wheelEntitlements/${CID}_${ALICE}`)).granted, 1);
  assert.equal((await getDecoded(`wheelGrants/${o.id}`)).revoked, true);
});

test('W15 who earns a chance: signed-in + paid products >= minimum only (never guests, never small orders)', async () => {
  const small = await order(ALICE, { items: [line('p-simple', 1)] });
  assert.equal(small.r.status, 200, small.r.text);
  assert.equal((await getDecoded(`orderLedger/${small.o.id}`)).wheel.chanceEligible, false);
  await setStatus(small.o.id, 'delivered');
  assert.equal(await getDecoded(`wheelEntitlements/${CID}_${ALICE}`), null);
  const guest = await order(null);
  assert.equal((await getDecoded(`orderLedger/${guest.o.id}`)).wheel, undefined);
  await setStatus(guest.o.id, 'delivered');
  assert.equal(await count('wheelGrants'), 0);
});

test('W16 prize out of stock when ordering: refused, nothing written, prize kept', async () => {
  await seedProducts({ 'p-hundred': { name: 'مئة', price: 1, stock: 0 } });
  const s = await spin(ALICE);
  const { o, r } = await order(ALICE, { spinId: s.body.result.spinId });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'WHEEL_PRIZE_UNAVAILABLE');
  assert.equal(await getDecoded(`orders/${o.id}`), null);
  assert.equal((await getDecoded(`wheelSpins/${s.body.result.spinId}`)).status, 'issued');
  assert.equal(await variantStock('p-variants', 'var_red'), 5, 'paid lines untouched');
});

// ---------------- abuse cases ----------------
test('W17 two accounts, one delivery phone: ONE OPEN gift at a time; delivery or cancellation frees the slot (future gifts allowed)', async () => {
  const s1 = await spin(ALICE);
  const s2 = await spin(BOB);
  const a = await order(ALICE, { spinId: s1.body.result.spinId });
  assert.equal(a.r.status, 200, a.r.text);
  // same fixture phone (+962791234567) on Bob's order while Alice's gift is still open
  const b = await order(BOB, { spinId: s2.body.result.spinId });
  assert.equal(b.r.status, 422);
  assert.equal(b.r.body.code, 'WHEEL_PHONE_LIMIT');
  assert.equal((await getDecoded(`wheelSpins/${s2.body.result.spinId}`)).status, 'issued', 'Bob keeps his prize');
  await setStatus(a.o.id, 'delivered');
  const b2 = await order(BOB, { spinId: s2.body.result.spinId });
  assert.equal(b2.r.status, 200, 'after delivery the phone may receive another gift');
  await setStatus(b2.o.id, 'cancelled');
  // Alice's delivered order earned her a new chance: she spins and receives the new gift on the same phone
  const s3 = await spin(ALICE);
  assert.equal(s3.body.repeated, false);
  const a2 = await order(ALICE, { spinId: s3.body.result.spinId });
  assert.equal(a2.r.status, 200, a2.r.text);
  const raw = JSON.stringify(await getDecoded(`orderLedger/${a2.o.id}`));
  assert.ok(!raw.includes('791234567'), 'no phone number in the wheel data');
});

test('W18 freeFirstChance=false: a brand-new account cannot spin until a qualifying order is delivered', async () => {
  await putDoc(`wheelCampaigns/${CID}`, { ...CAMPAIGN, freeFirstChance: false });
  const r = await spin(ALICE);
  assert.equal(r.status, 200);
  assert.equal(r.body.repeated, true);
  assert.equal(r.body.result, null, 'no draw at all');
  assert.equal(await count('wheelSpins'), 0);
  const { o } = await order(ALICE);
  await setStatus(o.id, 'delivered');
  assert.equal((await getDecoded(`wheelEntitlements/${CID}_${ALICE}`)).granted, 1);
  const s = await spin(ALICE);
  assert.equal(s.body.repeated, false);
  assert.equal(s.body.result.prizeId, 'test-a');
});

test('W19 the browser cannot choose the prize, the product or the price of the gift', async () => {
  const s = await spin(ALICE);
  const o = checkoutOrder({ id: makeOrderId(), userId: ALICE });
  // a forged extra "gift" line inside the order is just a normal PAID line (priced by the server), never free
  o.items.push({ productId: 'p-last-one', name: 'هدية', price: 0, quantity: 1, image: '', selectedVariant: null });
  const r = await callWorker(env({ PRICE_CHECK_MODE: 'enforce' }), { method: 'POST', path: '/create-order', headers: await authH(ALICE), body: { order: o, wheelSpinId: s.body.result.spinId, wheelPrize: { productId: 'p-last-one' } } });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'PRICE_CHANGED');
  assert.equal((await getDecoded(`wheelSpins/${s.body.result.spinId}`)).status, 'issued');
});

test('W20 an account WITHOUT a verified e-mail cannot spin (cheap throw-away accounts)', async () => {
  const r = await callWorker(env(), { method: 'POST', path: '/wheel/spin', headers: { origin: 'https://dairsharaf.com', authorization: `Bearer ${await token(ALICE, { email: 'x@example.invalid', email_verified: false })}` }, body: {} });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'WHEEL_ACCOUNT_NOT_VERIFIED');
  assert.equal(await count('wheelSpins'), 0);
});

test('W21 an unclaimed prize expires after prizeValidDays: cannot be redeemed, and the cron returns it to the pool once', async () => {
  await putDoc(`wheelCampaigns/${CID}`, { ...CAMPAIGN, prizeValidDays: 7 });
  const s = await spin(ALICE);
  assert.equal(await pool(), 2);
  const sp = await getDecoded(`wheelSpins/${s.body.result.spinId}`);
  assert.ok(sp.expiresAt instanceof Date);
  assert.ok(sp.issuedExpiry instanceof Date, 'unclaimed prize carries the cron marker');
  await backdate(s.body.result.spinId);
  const r = await order(ALICE, { spinId: s.body.result.spinId });
  assert.equal(r.r.body.code, 'WHEEL_PRIZE_EXPIRED');
  await runCron(env());
  await runCron(env());
  assert.equal((await getDecoded(`wheelSpins/${s.body.result.spinId}`)).status, 'expired');
  assert.equal(await pool(), 3, 'returned exactly once');
});

test('W22 connection lost after the order was saved: the resend is a replay (one order, one reservation, prize reserved once)', async () => {
  const s = await spin(ALICE);
  const o = checkoutOrder({ id: makeOrderId(), userId: ALICE });
  const send = async () => callWorker(env(), { method: 'POST', path: '/create-order', headers: await authH(ALICE), body: { order: o, wheelSpinId: s.body.result.spinId } });
  assert.equal((await send()).status, 200);
  const again = await send();
  assert.equal(again.status, 200, again.text);
  assert.equal(again.body.replay, true);
  assert.equal(await reserved('p-hundred'), 1);
  assert.equal((await getDecoded(`wheelSpins/${s.body.result.spinId}`)).orderId, o.id);
});

const backdate = async (spinId) => {
  const { __raw, ...data } = await getDecoded(`wheelSpins/${spinId}`);
  const past = new Date(Date.now() - 1000);
  await putDoc(`wheelSpins/${spinId}`, { ...data, expiresAt: past, ...(data.issuedExpiry ? { issuedExpiry: past } : {}) });
};

test('W23 a prize RESERVED for an open order is never expired or returned to the pool, even past its date', async () => {
  const s = await spin(ALICE);
  const { o } = await order(ALICE, { spinId: s.body.result.spinId });
  await backdate(s.body.result.spinId);
  await Promise.all([runCron(env()), runCron(env())]);
  assert.equal((await getDecoded(`wheelSpins/${s.body.result.spinId}`)).status, 'reserved');
  assert.equal(await pool(), 2);
  assert.equal((await setStatus(o.id, 'delivered')).status, 200);
  assert.equal((await getDecoded(`wheelSpins/${s.body.result.spinId}`)).status, 'consumed');
  assert.equal(await productStock('p-hundred'), 99, 'gift deducted once');
  await runCron(env());
  assert.equal(await pool(), 2, 'a delivered prize is never returned');
});

test('W24 three cron runs at once on one expired prize: returned exactly once', async () => {
  const s = await spin(ALICE);
  await backdate(s.body.result.spinId);
  await Promise.all([runCron(env()), runCron(env()), runCron(env())]);
  assert.equal(await pool(), 3);
  assert.equal((await getDecoded(`wheelSpins/${s.body.result.spinId}`)).status, 'expired');
});

test('W25 order vs cron racing on a prize at its expiry: either the order gets it or the pool does, never both', async () => {
  const s = await spin(ALICE);
  await backdate(s.body.result.spinId);
  const [, ord] = await Promise.all([runCron(env()), order(ALICE, { spinId: s.body.result.spinId })]);
  const st = (await getDecoded(`wheelSpins/${s.body.result.spinId}`)).status;
  const p = await pool();
  // the order re-checks the date itself, so a past-date prize is refused even if the cron has not run yet
  assert.equal(ord.r.status, 422);
  assert.equal(st, 'expired');
  assert.equal(p, 3);
  assert.equal(await reserved('p-hundred'), 0);
});

test('W26 an order cancelled AFTER the prize date: the prize comes back as issued-but-expired and only the cron returns it (once)', async () => {
  const s = await spin(ALICE);
  const { o } = await order(ALICE, { spinId: s.body.result.spinId });
  await backdate(s.body.result.spinId);
  await setStatus(o.id, 'cancelled');
  assert.equal((await order(ALICE, { spinId: s.body.result.spinId })).r.body.code, 'WHEEL_PRIZE_EXPIRED');
  await runCron(env());
  await runCron(env());
  assert.equal(await pool(), 3);
  assert.equal((await getDecoded(`wheelPhoneGifts/${(await getDecoded(`orderLedger/${o.id}`)).wheel.phoneKey}`)).open, 0, 'phone slot freed once');
});

test('W27 starvation: 60 UNEXPIRED prizes listed first never hide expired ones (any campaign); 4 overlapping crons return each once', async () => {
  const BIG = { ...CAMPAIGN, budgetJod: 200, prizes: [{ ...CAMPAIGN.prizes[0], quantity: 100 }] };
  await seedCampaign(BIG, 100);
  // 60 accounts whose ids sort FIRST ("a…") keep valid prizes; 5 accounts sorting LAST ("z…") hold expired ones
  const fresh = Array.from({ length: 60 }, (_, i) => `aUid${String(i).padStart(3, '0')}00000000000000000000`);
  const old = Array.from({ length: 5 }, (_, i) => `zUid${String(i).padStart(3, '0')}00000000000000000000`);
  for (const u of [...fresh, ...old]) assert.equal((await spin(u)).status, 200);
  assert.equal(await pool(), 35);
  for (const u of old) await backdate(`${CID}_${u}_1`);
  // another campaign's expired prize is handled too (its own pool)
  await putDoc('wheelPool/other-camp_test-a', { remaining: 0 });
  await putDoc('wheelSpins/other-camp_zOther_1', { campaignId: 'other-camp', uid: 'zOther', n: 1, prizeId: 'test-a', label: 'x', status: 'issued', issuedExpiry: new Date(Date.now() - 5000), expiresAt: new Date(Date.now() - 5000) });
  await Promise.all([runCron(env()), runCron(env()), runCron(env()), runCron(env())]);
  assert.equal(await pool(), 40, 'all 5 expired returned exactly once');
  assert.equal((await getDecoded('wheelPool/other-camp_test-a')).remaining, 1);
  for (const u of old) assert.equal((await getDecoded(`wheelSpins/${CID}_${u}_1`)).status, 'expired');
  for (const u of fresh.slice(0, 3)) assert.equal((await getDecoded(`wheelSpins/${CID}_${u}_1`)).status, 'issued', 'valid prizes untouched');
});

test('W28 open-gift counter: never negative, never stuck — deliver, cancel, repeated status calls, return after delivery', async () => {
  const counter = async (orderId) => (await getDecoded(`wheelPhoneGifts/${(await getDecoded(`orderLedger/${orderId}`)).wheel.phoneKey}`)).open;
  const s1 = await spin(ALICE);
  const a = await order(ALICE, { spinId: s1.body.result.spinId });
  assert.equal(await counter(a.o.id), 1);
  await Promise.all([setStatus(a.o.id, 'delivered'), setStatus(a.o.id, 'delivered'), setStatus(a.o.id, 'delivered')]);
  assert.equal(await counter(a.o.id), 0, 'freed once on delivery');
  // the delivery earned a new chance: spin it BEFORE the return (a return takes back an UNUSED earned chance)
  const s2 = await spin(ALICE);
  assert.equal(s2.body.repeated, false);
  assert.equal((await setStatus(a.o.id, 'cancelled', { confirmReturn: true })).status, 200);
  assert.equal(await counter(a.o.id), 0, 'a return after delivery does not free it again (no -1)');
  const b = await order(ALICE, { spinId: s2.body.result.spinId });
  assert.equal(await counter(b.o.id), 1);
  await Promise.all([setStatus(b.o.id, 'cancelled'), setStatus(b.o.id, 'cancelled')]);
  assert.equal(await counter(b.o.id), 0, 'freed once on cancellation');
  assert.equal((await setStatus(b.o.id, 'delivered')).status, 409, 'a cancelled order cannot be delivered (no second release)');
  assert.equal(await counter(b.o.id), 0);
  // an ordinary order of the same customer (no gift) never touches the counter
  const c = await order(ALICE);
  await setStatus(c.o.id, 'delivered');
  assert.equal((await getDecoded(`orderLedger/${c.o.id}`)).wheel.phoneKey, null);
  assert.equal(await counter(b.o.id), 0);
});

test('W29 notifications: ONE Telegram message + ONE e-mail per gift order, gift clearly marked FREE; totals unchanged; variant label kept', async () => {
  await putDoc(`wheelCampaigns/${CID}`, { ...CAMPAIGN, prizes: [{ id: 'test-a', label: 'جائزة تجريبية', productId: 'p-variants', variantId: 'var_blue', weight: 1, quantity: 3, unitCostJod: 1 }] });
  const s = await spin(ALICE);
  const { o, r } = await order(ALICE, { spinId: s.body.result.spinId });
  assert.equal(r.status, 200, r.text);
  await runCron(env()); // a retry run must not send again
  const tg = mock.state.calls.filter((c) => c.channel === 'telegram' && c.orderId === o.id);
  const mail = mock.state.calls.filter((c) => c.channel === 'email' && c.orderId === o.id);
  assert.equal(tg.length, 1, 'exactly one Telegram message');
  assert.equal(mail.length, 1, 'exactly one e-mail');
  const text = tg[0].body.text;
  assert.match(text, /- 🎁 هدية عجلة الجوائز: جائزة تجريبية \(أزرق\)\n  الكمية: 1 — مجانية، لا تُحصَّل قيمتها/);
  assert.match(text, /يتضمن الطلب هدية من عجلة الجوائز/);
  assert.match(text, /💰 إجمالي الطلب: 8\.20/, 'the amount to collect is the paid order only');
  assert.ok(!/جائزة تجريبية[^\n]*\n  الكمية: 1 × /.test(text), 'the gift has no price line');
  const O = await getDecoded(`orders/${o.id}`);
  const g = O.items.find((i) => i.gift);
  assert.equal(g.selectedVariant.id, 'var_blue');
  assert.equal(g.selectedVariant.label, 'أزرق');
  assert.equal(g.selectedVariant.price, undefined, 'no price copied into the gift');
  assert.equal(O.total, 8.2);
  assert.equal(await variantStock('p-variants', 'var_blue'), 1, 'nothing deducted before delivery');
  assert.equal((await setStatus(o.id, 'delivered')).status, 200);
  assert.equal(await variantStock('p-variants', 'var_blue'), 0, 'gift deducted once on delivery');
  assert.equal(await variantStock('p-variants', 'var_red'), 4, 'paid line deducted once');
});
