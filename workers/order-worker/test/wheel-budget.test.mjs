// LOCAL ONLY: the real Worker (src/index.js) + Firestore EMULATOR (demo- project) + mock JWKS with TEST keys.
//   node <emu.mjs> . demo-dairsharaf-orders "node --test --test-concurrency=1 test/wheel-budget.test.mjs"
// CAMPAIGN BUDGET (owner: 12 JOD per 100 delivered orders): allowance = min(hard cap, opening + per100/100 x delivered
// orders). A prize is drawn (and shown) only if its cost fits in allowance - held - spent; concurrent spins never spend
// the same JOD; every release gives the cost back exactly once. TEST numbers (per100 scaled up so tests stay small).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startMockServices, makeEnv, callWorker, clearDb, seedProducts, putDoc, getDecoded, runCron, PROJECT_ID } from './helpers.mjs';
import { checkoutOrder, makeOrderId } from './fixtures.mjs';
import { makeTestSigner } from './token-signer.mjs';
import { clearKeyCache } from '../src/auth.js';

const OWNER = 'ownerUid00000000000000000000O1';
const CID = 'test-campaign';
const MIN = 60_000;

let mock;
let signer;
const origLog = console.log;
const WHEEL = { STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', PRICE_CHECK_MODE: 'enforce', WHEEL_MODE: 'test', WHEEL_CAMPAIGN: CID, WHEEL_PHONE_SECRET: 'test-only-wheel-phone-secret-0123456789', WHEEL_GUEST_PER_IP_DAY: '100' };
const env = (o = {}) => makeEnv(mock.url, { ...WHEEL, ...o });
const token = (uid) => signer.idToken({ projectId: PROJECT_ID, uid, extra: { email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'google.com' } } });
const authH = async (uid) => ({ origin: 'https://dairsharaf.com', authorization: `Bearer ${await token(uid)}` });
const uidN = (name) => `${name}${'0'.repeat(28 - name.length)}`;

const PRODUCTS = { 'p-5': { name: 'منتج 5', price: 5, stock: 500 } };
const DISC = { id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, unitCostJod: 1, costConfirmed: true, minOrderJod: 5, weight: 1_000_000, quantity: 50 };
const NONE = { id: 'none-1', type: 'none', label: 'حظ أوفر', weight: 1 };
async function seed({ per100 = 12, start = 0, cap = 500, prizes = [DISC, NONE] } = {}) {
  await putDoc(`wheelCampaigns/${CID}`, { active: true, minOrderJod: 5, budgetJod: cap, budgetPer100Jod: per100, budgetStartJod: start, giftOnCancel: 'return', prizeValidDays: 30, startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', terms: '', prizes });
  for (const p of prizes) if (p.type !== 'none') await putDoc(`wheelPool/${CID}_${p.id}`, { remaining: p.quantity });
}
const budget = async () => (await getDecoded(`wheelBudget/${CID}`)) || { deliveredOrders: 0, heldMils: 0, spentMils: 0 };
const spinDoc = (uid, n = 1) => getDecoded(`wheelSpins/${CID}_${uid}_${n}`);
async function rewrite(path, patch) { const { __raw, ...d } = await getDecoded(path); await putDoc(path, { ...d, ...patch }); }

before(async () => {
  mock = await startMockServices();
  signer = await makeTestSigner('kid-wheel-budget');
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
const pub = async () => (await callWorker(env(), { path: '/wheel/public', headers: { origin: 'https://dairsharaf.com' } })).body;
const setStatus = async (id, status, extra = {}) => callWorker(env(), { method: 'POST', path: `/admin/orders/${encodeURIComponent(id)}/status`, headers: await authH(OWNER), body: { status, ...extra } });
let phoneN = 0;
async function order(uid, { deliver = false, spinId = null, discount = 0 } = {}) {
  const o = checkoutOrder({ id: makeOrderId(), userId: uid, items: [{ productId: 'p-5', name: 'p', price: 5, quantity: 1, image: '', selectedVariant: null }], overrides: { subtotal: 5, discountAmount: discount, shippingCost: 1, total: 6 - discount } });
  o.address = { ...o.address, phone: `+96277${String(++phoneN).padStart(7, '0')}` };
  const r = await callWorker(env(), { method: 'POST', path: '/create-order', headers: await authH(uid), body: { order: o, ...(spinId ? { wheelSpinId: spinId } : {}) } });
  assert.equal(r.status, 200, r.text);
  if (deliver) for (const s of ['processing', 'shipped', 'delivered']) assert.equal((await setStatus(o.id, s)).status, 200, s);
  return o;
}

test('B01 opening 0, nothing delivered yet: NO prize can be drawn — nor shown; the wheel still works ("حظ أوفر")', async () => {
  await seed({ start: 0 });
  assert.deepEqual((await pub()).slots.map((s) => s.id), ['none-1'], 'a prize the budget cannot pay is not shown');
  for (const u of ['b1a', 'b1b', 'b1c']) assert.equal((await spin(uidN(u))).body.result.prizeId, 'none-1');
  assert.equal((await budget()).heldMils, 0);
});

test('B02 CONCURRENCY: the budget pays exactly ONE prize -> 8 accounts spinning at the same moment get exactly one prize; held = its cost', async () => {
  await seed({ start: 1 }); // 1 JOD = one 1-JOD prize
  const res = await Promise.all(Array.from({ length: 8 }, (_, i) => spin(uidN(`cc${i}`))));
  for (const r of res) assert.equal(r.status, 200, r.text);
  assert.equal(res.filter((r) => r.body.result.prizeId === 'disc-1').length, 1, res.map((r) => r.body.result.prizeId).join(','));
  const b = await budget();
  assert.equal(b.heldMils, 1000);
  assert.equal((await getDecoded(`wheelPool/${CID}_disc-1`)).remaining, 49);
  assert.deepEqual((await pub()).slots.map((s) => s.id), ['none-1'], 'nothing left to pay: hidden');
});

test('B03 DELIVERED orders grow the allowance (per100 / 100 per order); a RETURN shrinks it again — counted once per transition', async () => {
  await seed({ start: 0, per100: 100 }); // TEST scale: 1 JOD per delivered order
  const U = uidN('grow');
  const o = await order(U, { deliver: true });
  assert.equal((await budget()).deliveredOrders, 1);
  assert.equal((await spin(U)).body.result.prizeId, 'disc-1', '1 JOD earned -> one prize affordable');
  await setStatus(o.id, 'delivered'); // repeated: unchanged
  assert.equal((await budget()).deliveredOrders, 1);
  assert.equal((await setStatus(o.id, 'cancelled', { confirmReturn: true })).status, 200);
  const b = await budget();
  assert.equal(b.deliveredOrders, 0, 'a returned order no longer counts');
  assert.equal(b.heldMils, 1000, 'the prize already won stays held (it is a commitment)');
});

test('B04 an unused prize that ends gives its cost back EXACTLY ONCE (cron x3 + a spin); a cancelled order\'s ended prize too', async () => {
  await seed({ start: 2 });
  const U = uidN('rel');
  await spin(U);
  assert.equal((await budget()).heldMils, 1000);
  const past = new Date(Date.now() - 61 * MIN);
  await rewrite(`wheelSpins/${CID}_${U}_1`, { expiresAt: past, issuedExpiry: past });
  await Promise.all([runCron(env()), runCron(env()), runCron(env()), spin(uidN('other'))]);
  const otherWon = (await spinDoc(uidN('other')))?.prizeId === 'disc-1' ? 1000 : 0;
  assert.equal((await budget()).heldMils, otherWon, 'released once (the other spin may hold it again)');
  await runCron(env());
  assert.equal((await budget()).heldMils, otherWon);
  // policy "expire": an order with the prize cancelled -> ended + cost back once
  await seed({ start: 2, prizes: [DISC, NONE] });
  await putDoc(`wheelCampaigns/${CID}`, { ...(await getDecoded(`wheelCampaigns/${CID}`)), giftOnCancel: 'expire' });
  const V = uidN('canc');
  const s = (await spin(V)).body.result;
  const before = (await budget()).heldMils;
  const o = await order(V, { spinId: s.spinId, discount: 1 });
  assert.equal((await setStatus(o.id, 'cancelled')).status, 200);
  assert.equal((await budget()).heldMils, before - 1000);
  await setStatus(o.id, 'cancelled');
  assert.equal((await budget()).heldMils, before - 1000, 'never twice');
});

test('B05 a prize used by a DELIVERED order moves from held to SPENT (once); the allowance accounts for both', async () => {
  await seed({ start: 3 });
  const U = uidN('spend');
  const s = (await spin(U)).body.result;
  const o = await order(U, { spinId: s.spinId, discount: 1 });
  assert.deepEqual([(await budget()).heldMils, (await budget()).spentMils], [1000, 0]);
  for (const st of ['processing', 'shipped', 'delivered']) await setStatus(o.id, st);
  await setStatus(o.id, 'delivered');
  const b = await budget();
  assert.equal(b.heldMils, 0);
  assert.equal(b.spentMils, 1000);
  assert.equal(b.deliveredOrders, 1);
});

test('B06 guest spins hold the budget too; a refused / expired ticket gives it back once; a claimed one keeps it with the account', async () => {
  await seed({ start: 2 });
  const t1 = randomBytes(32).toString('base64url');
  const t2 = randomBytes(32).toString('base64url');
  const g = (t) => callWorker(env(), { method: 'POST', path: '/wheel/guest/spin', headers: { origin: 'https://dairsharaf.com' }, body: { ticket: t } });
  assert.equal((await g(t1)).body.result.prizeId, 'disc-1');
  assert.equal((await g(t2)).body.result.prizeId, 'disc-1');
  assert.equal((await budget()).heldMils, 2000);
  assert.equal((await g(randomBytes(32).toString('base64url'))).body.result.prizeId, 'none-1', 'budget used up by held tickets');
  const A = uidN('claimA');
  const c = await callWorker(env(), { method: 'POST', path: '/wheel/guest/claim', headers: await authH(A), body: { ticket: t1 } });
  assert.equal(c.status, 200, c.text);
  assert.equal((await spinDoc(A)).costMils, 1000, 'the held cost moved to the account result');
  const { guestPath } = await import('../src/wheel-guest.js');
  const p2 = await guestPath(CID, t2);
  await rewrite(p2, { holdExpiry: new Date(Date.now() - MIN), expiresAt: new Date(Date.now() - MIN) });
  await Promise.all([runCron(env()), runCron(env())]);
  assert.equal((await budget()).heldMils, 1000, 'the expired ticket released once; the claimed one still held');
});

test('B07 admin: allowance, held, spent, available and % used — read from the server; a campaign with opening 0 is warned', async () => {
  await seed({ start: 2, per100: 12 });
  await spin(uidN('adm'));
  const r = await callWorker(env(), { path: '/admin/wheel', headers: await authH(OWNER) });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.budget, { deliveredOrders: 0, allowanceJod: 2, capJod: 500, heldJod: 1, spentJod: 0, availableJod: 1, usedPct: 50, per100Jod: 12, startJod: 2 });
  await seed({ start: 0 });
  const w = await callWorker(env(), { path: '/admin/wheel', headers: await authH(OWNER) });
  assert.ok(w.body.warnings.some((x) => /الرصيد الافتتاحي 0/.test(x)));
  // a customer never reads it
  assert.equal((await callWorker(env(), { path: '/admin/wheel', headers: await authH(uidN('cust')) })).status, 403);
});

test('B08 the hard cap still applies above the per-100 allowance; a prize whose cost is unconfirmed is warned', async () => {
  // (the existing rule already refuses quantities whose worst-case cost exceeds the hard cap)
  await seed({ start: 1, cap: 2, prizes: [{ ...DISC, quantity: 2 }, NONE] });
  // 100 delivered orders: per100 would allow 1 + 12 = 13 JOD — the hard cap (2 JOD) wins
  await putDoc(`wheelBudget/${CID}`, { campaignId: CID, deliveredOrders: 100, heldMils: 0, spentMils: 0 });
  const adm = await callWorker(env(), { path: '/admin/wheel', headers: await authH(OWNER) });
  assert.equal(adm.body.budget.allowanceJod, 2, 'the cap, not 13');
  const res = [];
  for (const u of ['h1', 'h2', 'h3', 'h4']) res.push((await spin(uidN(u))).body.result.prizeId);
  assert.equal(res.filter((x) => x === 'disc-1').length, 2, 'never more than the cap');
  const r = await callWorker(env(), { method: 'POST', path: '/admin/wheel/campaign', headers: await authH(OWNER), body: { campaign: { active: true, minOrderJod: 5, budgetJod: 10, budgetPer100Jod: 12, budgetStartJod: 0, giftOnCancel: 'return', startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', terms: '', prizes: [{ ...DISC, quantity: 5, costConfirmed: false }, NONE] }, baseUpdateTime: (await getDecoded(`wheelCampaigns/${CID}`)).__raw.updateTime } });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.body.warnings.some((x) => /تكلفتها الفعلية غير مؤكدة/.test(x)));
});

test('B09 honesty: each visible segment carries its REAL chance for this customer (sums to 100%); an unaffordable prize is 0 and hidden', async () => {
  await seed({ start: 5, prizes: [{ ...DISC, weight: 1 }, { id: 'none-1', type: 'none', label: 'حظ أوفر', weight: 3 }, { id: 'none-2', type: 'none', label: 'حظ أوفر', weight: 0 }, { id: 'none-3', type: 'none', label: 'حظ أوفر', weight: 0 }] });
  const p = await pub();
  const ch = Object.fromEntries(p.slots.map((s) => [s.id, s.chance]));
  assert.deepEqual(ch, { 'disc-1': 0.25, 'none-1': 0.75, 'none-2': 0, 'none-3': 0 });
  await seed({ start: 0, prizes: [{ ...DISC, weight: 1 }, { id: 'none-1', type: 'none', label: 'حظ أوفر', weight: 3 }] });
  assert.deepEqual((await pub()).slots.map((s) => [s.id, s.chance]), [['none-1', 1]]);
});
