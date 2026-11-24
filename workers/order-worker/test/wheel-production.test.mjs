// LOCAL ONLY: the real Worker (src/index.js) + Firestore EMULATOR (demo- project) + mock services with TEST keys.
//   node <emu.mjs> . demo-dairsharaf-orders "node --test --test-concurrency=1 test/wheel-production.test.mjs"
// The prize wheel with the PRODUCTION Worker settings (WHEEL_MODE=live, TURNSTILE_MODE=enforce, no ORDER_SIGN_IN,
// default per-IP guest limit, on_delivery + approval off) and the SHAPE of the production test campaign that failed on
// 2026-11-22 (1 JOD budget, one 1-JOD discount, "حظ أوفر", per-slot windows, unknown-cost prizes switched off).
// Cause found: the SIGNED-IN spin (/wheel/spin) sent no Turnstile token -> 403 TURNSTILE_FAILED -> "could not connect".
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startMockServices, makeEnv, callWorker, clearDb, seedProducts, putDoc, getDecoded, count, runCron, PROJECT_ID } from './helpers.mjs';
import { checkoutOrder, makeOrderId } from './fixtures.mjs';
import { makeTestSigner } from './token-signer.mjs';
import { clearKeyCache } from '../src/auth.js';
import { guestPath } from '../src/wheel-guest.js';

const CID = 'opening-1';
const OWNER = 'ownerUid00000000000000000000O1';
const ALICE = 'aliceUid000000000000000000A1';
const BIG = 1_000_000;
let mock;
let signer;
const origLog = console.log;
// production [vars] (wrangler.production.local.toml) — only the mock endpoints / test secrets differ
const PROD = {
  STOCK_POLICY: 'on_delivery', APPROVAL_MODE: 'off', WHEEL_MODE: 'live', WHEEL_CAMPAIGN: CID,
  TURNSTILE_MODE: 'enforce', PRICE_CHECK_MODE: 'enforce', STOCK_MODE: 'apply',
  WHEEL_PHONE_SECRET: 'test-only-wheel-phone-secret-prod-shape-0123456789',
};
const env = (o = {}) => makeEnv(mock.url, { ...PROD, ...o });
const ORIGIN = { origin: 'https://dairsharaf.com' };
const newTicket = () => randomBytes(32).toString('base64url');
const token = (uid) => signer.idToken({ projectId: PROJECT_ID, uid, extra: { email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'google.com' } } });

// the production campaign's shape (values as saved from the dashboard on 2026-11-22)
const W = (n) => ({ new: n, returning: n, loyal: n });
const off = (id, type, label, cost) => ({ id, type, label, description: '', icon: '', color: null, imageUrl: '', weight: 0, weights: W(0), costConfirmed: false, active: false, quantity: 0, unitCostJod: cost, valueJod: cost, minOrderJod: 15, appliesTo: 'this_order', productId: null, variantId: null, validDays: null });
const none = (id, w) => ({ id, type: 'none', label: 'حظ أوفر', description: '', icon: '', color: null, imageUrl: '', weight: w, weights: W(w), costConfirmed: false, active: true });
const disc = (w) => ({ id: 'disc-1', type: 'discount', label: 'خصم دينار', description: 'خصم بقيمة دينار واحد على طلب بقيمة 5 دنانير أو أكثر.', icon: '💸', color: '#146de1', imageUrl: '', weight: w, weights: W(w), costConfirmed: true, active: true, quantity: 1, unitCostJod: 1, valueJod: 1, minOrderJod: 5, appliesTo: 'this_order', productId: null, variantId: null, validDays: null });
const prodCampaign = ({ discWeight = 100, ...extra } = {}) => ({
  active: true, giftOnCancel: 'return', budgetJod: 1, budgetStartJod: 1, budgetPer100Jod: 0, noPrizeWeight: 0, freeFirstChance: true,
  minOrderJod: 5, prizeValidDays: 7, openGiftsPerPhone: 1, terms: 'شروط', startsAt: new Date(Date.now() - 3600e3), endsAt: new Date(Date.now() + 24 * 3600e3),
  prizes: [off('ship-1', 'free_delivery', 'توصيل مجاني', 3), disc(discWeight), none('none-1', 300), off('gift-2', 'gift', 'هدية بقيمة 2 د.أ', 2), none('none-2', 0), none('none-3', 0), off('disc-5', 'discount', 'خصم 5 د.أ', 5)],
  ...extra,
});
async function seed(opts) {
  const c = prodCampaign(opts);
  await putDoc(`wheelCampaigns/${CID}`, c);
  for (const p of c.prizes) if (p.type !== 'none') await putDoc(`wheelPool/${CID}_${p.id}`, { remaining: p.quantity });
}
const remaining = async (id) => (await getDecoded(`wheelPool/${CID}_${id}`))?.remaining;
const held = async () => (await getDecoded(`wheelBudget/${CID}`))?.heldMils ?? 0;
let ipN = 0;
const ipOf = () => `203.0.113.${++ipN}`;
const gSpin = (ticket, { e = env(), ip = ipOf() } = {}) => callWorker(e, { method: 'POST', path: '/wheel/guest/spin', headers: { ...ORIGIN, 'cf-connecting-ip': ip }, body: { ticket } });
const accSpin = async (uid, body = {}, e = env()) => callWorker(e, { method: 'POST', path: '/wheel/spin', headers: { ...ORIGIN, 'cf-connecting-ip': ipOf(), authorization: `Bearer ${await token(uid)}` }, body });
const turnstileCalls = () => mock.state.calls.filter((c) => c.channel === 'turnstile').length;

before(async () => {
  mock = await startMockServices();
  signer = await makeTestSigner('kid-wheel-prod');
  console.log = () => {};
});
after(async () => { console.log = origLog; await mock?.close(); });
beforeEach(async () => {
  mock.reset();
  clearKeyCache();
  mock.state.jwks = { keys: [signer.jwk] };
  mock.state.turnstileSingleUse = true; // like Cloudflare: a token is accepted once
  await clearDb();
  await seedProducts({ 'p-5': { name: 'منتج 5', price: 5, stock: 20 } });
  await putDoc('config/roles', { ownerUid: OWNER });
});

test('WP01 the production failure, reproduced: a signed-in spin WITHOUT a Turnstile token -> 403 TURNSTILE_FAILED, nothing written; with a fresh token -> stored once; a reused token -> refused', async () => {
  await seed();
  const bare = await accSpin(ALICE); // exactly what the site sent before the fix: body {}
  assert.equal(bare.status, 403);
  assert.equal(bare.body.code, 'TURNSTILE_FAILED');
  const bad = await accSpin(ALICE, { turnstileToken: 'forged' });
  assert.equal(bad.body.code, 'TURNSTILE_FAILED');
  assert.equal(await count('wheelSpins'), 0, 'a refused spin writes nothing');
  assert.equal(await remaining('disc-1'), 1);
  assert.equal(await held(), 0);
  // the fix: the site sends a fresh single-use token with the signed-in spin
  const ok = await accSpin(ALICE, { turnstileToken: 'pass-alice-1' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.ok, true);
  assert.equal(await count('wheelSpins'), 1);
  const reused = await accSpin(ALICE, { turnstileToken: 'pass-alice-1' });
  assert.equal(reused.body.code, 'TURNSTILE_FAILED', 'a token works once');
  // the welcome chance is used: a second fresh token gives the SAME stored result, never a new draw
  const again = await accSpin(ALICE, { turnstileToken: 'pass-alice-2' });
  assert.equal(again.status, 200);
  assert.equal(again.body.repeated, true);
  assert.equal(again.body.result.spinId, ok.body.result.spinId);
  assert.equal(await count('wheelSpins'), 1);
});

test('WP02 the guest spin needs NO sign-in and NO Turnstile (owner\'s rule): stored, the same ticket returns the same result', async () => {
  await seed();
  const t = newTicket();
  const a = await gSpin(t);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.repeated, false);
  const b = await gSpin(t);
  assert.equal(b.body.repeated, true);
  assert.equal(b.body.result.prizeId, a.body.result.prizeId);
  assert.equal(await count('wheelGuestSpins'), 1);
  assert.equal(turnstileCalls(), 0, 'no Turnstile on the guest spin');
});

test('WP03 1-JOD budget: the won discount takes its unit AND its cost in ONE commit; afterwards nothing can be won (pool 0, budget 0)', async () => {
  await seed({ discWeight: BIG });
  const t = newTicket();
  const won = await gSpin(t);
  assert.equal(won.body.result.prizeId, 'disc-1');
  assert.equal(await remaining('disc-1'), 0);
  assert.equal(await held(), 1000, 'the 1 JOD is held at the spin');
  // the pool comes back (an admin edit) but the BUDGET is spent: still nothing to win
  await putDoc(`wheelPool/${CID}_disc-1`, { remaining: 5 });
  for (let i = 0; i < 5; i++) assert.equal((await gSpin(newTicket())).body.result.prizeId, 'none-1');
  assert.equal(await held(), 1000, 'never more than the 1 JOD budget');
  assert.equal((await gSpin(t)).body.result.prizeId, 'disc-1', 'the first ticket keeps its result');
});

test('WP04 prize sold out (quantity 0): only "حظ أوفر" is drawn, nothing is held', async () => {
  await seed({ discWeight: BIG });
  await putDoc(`wheelPool/${CID}_disc-1`, { remaining: 0 });
  for (let i = 0; i < 4; i++) assert.equal((await gSpin(newTicket())).body.result.prizeId, 'none-1');
  assert.equal(await held(), 0);
});

test('WP05 an unclaimed held prize expires: the cron gives back its unit and its budget exactly once', async () => {
  await seed({ discWeight: BIG });
  const t = newTicket();
  assert.equal((await gSpin(t)).body.result.prizeId, 'disc-1');
  const p = await guestPath(CID, t);
  const { __raw, ...d } = await getDecoded(p);
  await putDoc(p, { ...d, holdExpiry: new Date(Date.now() - 60_000) });
  assert.equal((await runCron(env())).guest.released, 1);
  assert.equal((await runCron(env())).guest.released, 0);
  assert.equal(await remaining('disc-1'), 1);
  assert.equal(await held(), 0);
  assert.equal((await getDecoded(p)).status, 'expired');
});

test('WP06 limits: the default per-IP guest limit (10 a day) -> 429 WHEEL_GUEST_LIMIT; the request rate limiter -> 429 RATE_LIMITED', async () => {
  await seed();
  const ip = '198.51.100.77';
  for (let i = 0; i < 10; i++) assert.equal((await gSpin(newTicket(), { ip })).status, 200, `spin ${i + 1}`);
  const eleventh = await gSpin(newTicket(), { ip });
  assert.equal(eleventh.status, 429);
  assert.equal(eleventh.body.code, 'WHEEL_GUEST_LIMIT');
  const tight = env({ RATE_LIMIT_CREATE_PER_MIN: '1' });
  const rip = '198.51.100.78';
  assert.equal((await gSpin(newTicket(), { e: tight, ip: rip })).status, 200);
  const limited = await gSpin(newTicket(), { e: tight, ip: rip });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'RATE_LIMITED');
});

test('WP07 closed campaign (active=false, as production is now): guest and signed-in spins -> 409 CAMPAIGN_CLOSED, nothing written', async () => {
  await seed({ active: false });
  const g = await gSpin(newTicket());
  assert.equal(g.status, 409);
  assert.equal(g.body.code, 'CAMPAIGN_CLOSED');
  const a = await accSpin(ALICE, { turnstileToken: 'pass-closed-1' });
  assert.equal(a.status, 409);
  assert.equal(a.body.code, 'CAMPAIGN_CLOSED');
  assert.equal(await count('wheelGuestSpins'), 0);
  assert.equal(await count('wheelSpins'), 0);
  assert.equal(await held(), 0);
  const pub = await callWorker(env(), { path: '/wheel/public', headers: ORIGIN });
  assert.equal(pub.body.campaign, 'CAMPAIGN_CLOSED');
});

test('WP08 the store is not affected: a guest order after wheel spins is accepted (new), stock reserved and NOT deducted; the wheel docs are untouched by it', async () => {
  await seed({ discWeight: BIG });
  await gSpin(newTicket());
  const before = { pool: await remaining('disc-1'), held: await held(), spins: await count('wheelGuestSpins') };
  const o = checkoutOrder({ id: makeOrderId(), items: [{ productId: 'p-5', name: 'منتج 5', price: 5, quantity: 2, image: '', selectedVariant: null }], overrides: { subtotal: 10, discountAmount: 0, shippingCost: 1, total: 11 } });
  const r = await callWorker(env(), { method: 'POST', path: '/create-order', headers: ORIGIN, body: { order: o, turnstileToken: 'pass-order-1' } });
  assert.equal(r.status, 200, r.text);
  assert.equal((await getDecoded(`orders/${o.id}`)).status, 'new');
  assert.equal((await getDecoded('products/p-5')).stock, 20, 'nothing deducted before delivery');
  assert.equal((await getDecoded('stockReservations/p-5'))?.product, 2, 'reserved');
  assert.deepEqual({ pool: await remaining('disc-1'), held: await held(), spins: await count('wheelGuestSpins') }, before);
});
