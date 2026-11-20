// LOCAL ONLY: the real Worker (src/index.js) + Firestore EMULATOR (demo- project) + mock JWKS with TEST keys.
//   node <emu.mjs> . demo-dairsharaf-orders "node --test --test-concurrency=1 test/wheel-tiers.test.mjs"
// LOYALTY TIERS (owner's decision): chances depend on the account's DELIVERED orders (server count, no time limit;
// cancelled / returned never count): new 0-1 · returning 2 · loyal 3+. A spin without an account uses 'new' and is
// never re-drawn. TEST weights only: each tier can draw exactly ONE prize here, so the tier used is visible.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startMockServices, makeEnv, callWorker, clearDb, seedProducts, putDoc, getDecoded, adminDb, PROJECT_ID } from './helpers.mjs';
import { checkoutOrder, makeOrderId } from './fixtures.mjs';
import { makeTestSigner } from './token-signer.mjs';
import { clearKeyCache } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { spinWheel, tierOfCount, accountTier, accountSeqBump, checkCampaign, drawPrize } from '../src/wheel.js';

const OWNER = 'ownerUid00000000000000000000O1';
const CID = 'test-campaign';

let mock;
let signer;
const origLog = console.log;
const WHEEL = { STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', PRICE_CHECK_MODE: 'enforce', WHEEL_MODE: 'test', WHEEL_CAMPAIGN: CID, WHEEL_PHONE_SECRET: 'test-only-wheel-phone-secret-0123456789', WHEEL_GUEST_PER_IP_DAY: '100' };
const env = (o = {}) => makeEnv(mock.url, { ...WHEEL, ...o });
const token = (uid) => signer.idToken({ projectId: PROJECT_ID, uid, extra: { email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'google.com' } } });
const authH = async (uid) => ({ origin: 'https://dairsharaf.com', authorization: `Bearer ${await token(uid)}` });
const uidN = (name) => `${name}${'0'.repeat(28 - name.length)}`;

const PRODUCTS = { 'p-5': { name: 'منتج 5', price: 5, stock: 500 } };
const disc = (id, weights) => ({ id, type: 'discount', label: `خصم ${id}`, valueJod: 1, minOrderJod: 5, weight: 0, weights, quantity: 20 });
const NONES = [1, 2, 3].map((i) => ({ id: `none-${i}`, type: 'none', label: 'حظ أوفر', weight: 0 }));
// each tier can draw exactly one prize (TEST weights)
const PRIZES = [disc('for-new', { new: 1, returning: 0, loyal: 0 }), disc('for-returning', { new: 0, returning: 1, loyal: 0 }), disc('for-loyal', { new: 0, returning: 0, loyal: 1 }), ...NONES];
async function seed(prizes = PRIZES) {
  await putDoc(`wheelCampaigns/${CID}`, { active: true, minOrderJod: 5, budgetJod: 500, giftOnCancel: 'return', prizeValidDays: 30, startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', terms: 'شروط تجريبية', prizes });
  for (const p of prizes) if (p.type !== 'none') await putDoc(`wheelPool/${CID}_${p.id}`, { remaining: p.quantity });
}
const strip = (d) => { const { __raw, ...rest } = d; return rest; };

before(async () => {
  mock = await startMockServices();
  signer = await makeTestSigner('kid-wheel-tiers');
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

const spin = async (uid, body = {}) => callWorker(env(), { method: 'POST', path: '/wheel/spin', headers: await authH(uid), body });
const state = async (uid) => (await callWorker(env(), { path: '/wheel/state', headers: await authH(uid) })).body;
const place = async (uid, o) => callWorker(env(), { method: 'POST', path: '/create-order', headers: await authH(uid), body: { order: o } });
const setStatus = async (id, status, extra = {}) => callWorker(env(), { method: 'POST', path: `/admin/orders/${encodeURIComponent(id)}/status`, headers: await authH(OWNER), body: { status, ...extra } });
/** a delivered order RETURNED (delivered -> cancelled, confirmed in the dashboard) */
const returnOrder = (id) => setStatus(id, 'cancelled', { confirmReturn: true });
let phoneN = 0;
async function order(uid, { deliver = false, upTo = null } = {}) {
  const o = checkoutOrder({ id: makeOrderId(), userId: uid, items: [{ productId: 'p-5', name: 'p', price: 5, quantity: 1, image: '', selectedVariant: null }], overrides: { subtotal: 5, discountAmount: 0, shippingCost: 1, total: 6 } });
  o.address = { ...o.address, phone: `+96278${String(++phoneN).padStart(7, '0')}` };
  const r = await place(uid, o);
  assert.equal(r.status, 200, r.text);
  const steps = deliver ? ['processing', 'shipped', 'delivered'] : upTo ? ['processing', 'shipped'].slice(0, ['processing', 'shipped'].indexOf(upTo) + 1) : [];
  for (const s of steps) assert.equal((await setStatus(o.id, s)).status, 200, s);
  return o;
}
async function withDelivered(uid, n) { const out = []; for (let i = 0; i < n; i++) out.push(await order(uid, { deliver: true })); return out; }
const spinDoc = (uid, n) => getDecoded(`wheelSpins/${CID}_${uid}_${n}`);

test('L01 tier = DELIVERED orders counted by the server: 0-1 new, 2 returning, 3+ loyal; open, cancelled and RETURNED orders never count', async () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(tierOfCount), ['new', 'new', 'returning', 'loyal', 'loyal', 'loyal']);
  const fs = adminDb();
  const U = uidN('tierU');
  assert.deepEqual(await accountTier(fs, U), { tier: 'new', delivered: 0 });
  await withDelivered(U, 1);
  await order(U); // open, not delivered
  const c = await order(U);
  await setStatus(c.id, 'cancelled');
  assert.deepEqual(await accountTier(fs, U), { tier: 'new', delivered: 1 });
  const [d2] = await withDelivered(U, 1);
  assert.equal((await accountTier(fs, U)).tier, 'returning');
  await withDelivered(U, 1);
  assert.equal((await accountTier(fs, U)).tier, 'loyal');
  // a delivered order RETURNED (delivered -> cancelled) no longer counts
  assert.equal((await returnOrder(d2.id)).status, 200);
  assert.deepEqual(await accountTier(fs, U), { tier: 'returning', delivered: 2 });
  const st = await state(U);
  assert.equal(st.tier, 'returning');
  assert.equal(st.deliveredOrders, 2);
});

test('L02 each tier draws with ITS weights (server-side); the tier and the count are stored with the result', async () => {
  const cases = [['newT', 0, 'for-new', 'new'], ['oneT', 1, 'for-new', 'new'], ['retT', 2, 'for-returning', 'returning'], ['loyT', 3, 'for-loyal', 'loyal'], ['loy5T', 5, 'for-loyal', 'loyal']];
  for (const [name, n, prize, tier] of cases) {
    const U = uidN(name);
    await withDelivered(U, n);
    const r = await spin(U);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.result.prizeId, prize, `${name}: ${n} delivered`);
    assert.equal(r.body.result.tier, tier);
    const d = await spinDoc(U, 1);
    assert.equal(d.tier, tier);
    assert.equal(d.deliveredCount, Math.min(n, 3));
  }
});

test('L03 what each customer SEES: the prizes of their tier + the THREE "حظ أوفر" segments always visible (even at weight 0)', async () => {
  const pub = (await callWorker(env(), { path: '/wheel/public', headers: { origin: 'https://dairsharaf.com' } })).body;
  assert.deepEqual(pub.slots.map((s) => s.id), ['for-new', 'none-1', 'none-2', 'none-3'], 'a visitor without an account: the new-customer wheel');
  const L = uidN('seeL');
  await withDelivered(L, 3);
  const st = await state(L);
  assert.deepEqual(st.slots.map((s) => s.id), ['for-loyal', 'none-1', 'none-2', 'none-3']);
  for (const k of ['weight', 'weights', 'quantity', 'unitCostJod']) assert.ok(!JSON.stringify(st.slots).includes(`"${k}"`), k);
});

test('L04 the tier follows deliveries and returns: a delivery moves the account up for its NEXT spin; a return moves it down', async () => {
  const U = uidN('moveU');
  await withDelivered(U, 1);
  assert.equal((await spin(U)).body.result.prizeId, 'for-new'); // welcome spin as "new" (1 delivered)
  const [o2] = await withDelivered(U, 1); // 2 delivered -> returning; earns a spin
  const s2 = await spin(U);
  assert.equal(s2.body.repeated, false);
  assert.equal(s2.body.result.prizeId, 'for-returning');
  // a return of a delivered order: back to "new" for the next spin (and that order's spin is taken back)
  await withDelivered(U, 1); // 3 delivered -> loyal, one more spin earned
  assert.equal((await returnOrder(o2.id)).status, 200); // returned -> 2 delivered
  const st = await state(U);
  assert.equal(st.tier, 'returning');
  if (st.chancesLeft > 0) assert.equal((await spin(U)).body.result.prizeId, 'for-returning');
});

test('L05 spin WITHOUT an account: always the NEW-customer chances; signing in with a loyal account keeps that result (never re-drawn), later spins use the real tier', async () => {
  const L = uidN('guestL');
  await withDelivered(L, 3);
  const t = randomBytes(32).toString('base64url');
  const g = await callWorker(env(), { method: 'POST', path: '/wheel/guest/spin', headers: { origin: 'https://dairsharaf.com' }, body: { ticket: t, tier: 'loyal' } });
  assert.equal(g.body.result.prizeId, 'for-new', 'no trusted history before signing in: new-customer weights');
  const c = await callWorker(env(), { method: 'POST', path: '/wheel/guest/claim', headers: await authH(L), body: { ticket: t } });
  assert.equal(c.status, 200, c.text);
  const d = await spinDoc(L, 1);
  assert.equal(d.prizeId, 'for-new', 'the result is kept as it was drawn');
  assert.equal(d.tier, 'new');
  // the claim used the welcome spin; the spins earned by the 3 deliveries use the REAL tier
  const next = await spin(L);
  assert.equal(next.body.repeated, false);
  assert.equal(next.body.result.prizeId, 'for-loyal');
  assert.equal((await spinDoc(L, 2)).tier, 'loyal');
  // the claimed result is never re-drawn: claiming again / spinning again never changes spin 1
  await callWorker(env(), { method: 'POST', path: '/wheel/guest/claim', headers: await authH(L), body: { ticket: t } });
  assert.equal((await spinDoc(L, 1)).prizeId, 'for-new');
});

test('L06 tampering: a tier / count sent by the browser is ignored; open (undelivered) orders do not raise the tier; nothing can re-draw a stored result', async () => {
  const U = uidN('cheatU');
  for (let i = 0; i < 4; i++) await order(U); // 4 OPEN orders, none delivered
  const r = await spin(U, { tier: 'loyal', deliveredCount: 9, weights: { loyal: 1 } });
  assert.equal(r.body.result.prizeId, 'for-new');
  assert.equal((await spinDoc(U, 1)).deliveredCount, 0);
  const again = await spin(U, { tier: 'loyal' });
  assert.equal(again.body.repeated, true);
  assert.equal(again.body.result.prizeId, 'for-new');
  // the guest route ignores any tier too
  const g = await callWorker(env(), { method: 'POST', path: '/wheel/guest/spin', headers: { origin: 'https://dairsharaf.com' }, body: { ticket: randomBytes(32).toString('base64url'), tier: 'loyal', deliveredCount: 7 } });
  assert.equal(g.body.result.prizeId, 'for-new');
});

test('L07 RACE (deterministic): a delivery committed between the count and the spin\'s commit -> the spin re-reads and uses the NEW tier (never a stale count)', async () => {
  const U = uidN('raceU');
  await withDelivered(U, 2); // returning
  const third = await order(U, { upTo: 'shipped' });
  const base = adminDb();
  let injected = 0;
  let commits = 0;
  // a Firestore client that, right after the FIRST count of delivered orders, delivers the third order (as the
  // dashboard would: order status + the account's sequence moved in one commit)
  const fs = Object.create(base);
  fs.runQuery = async (q) => {
    const res = await base.runQuery(q);
    if (!injected && JSON.stringify(q).includes('"delivered"')) {
      injected = 1;
      const { __raw, ...o } = await getDecoded(`orders/${third.id}`);
      await putDoc(`orders/${third.id}`, { ...o, status: 'delivered' });
      assert.equal((await base.commit([accountSeqBump(base, U)])).ok, true);
    }
    return res;
  };
  fs.commit = async (w) => { commits += 1; return base.commit(w); };
  const r = await spinWheel(fs, loadConfig(env()), U, { email: '' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(injected, 1);
  assert.equal(commits, 2, 'first commit refused (sequence moved), second one with the fresh count');
  assert.equal(r.body.result.prizeId, 'for-loyal');
  const d = await spinDoc(U, 1);
  assert.equal(d.tier, 'loyal');
  assert.equal(d.deliveredCount, 3);
});

test('L08 RACE (real, concurrent): spin and delivery of the 3rd order at the same moment, many rounds -> the stored tier always matches the stored count and the prize drawn', async () => {
  const seen = new Set();
  for (let round = 0; round < 8; round++) {
    const U = uidN(`r${round}U`);
    await withDelivered(U, 2);
    const third = await order(U, { upTo: 'shipped' });
    const [s] = await Promise.all([spin(U), setStatus(third.id, 'delivered')]);
    assert.equal(s.status, 200, s.text);
    const d = await spinDoc(U, 1);
    assert.ok([2, 3].includes(d.deliveredCount), String(d.deliveredCount));
    assert.equal(d.tier, tierOfCount(d.deliveredCount));
    assert.equal(d.prizeId, d.tier === 'loyal' ? 'for-loyal' : 'for-returning');
    seen.add(d.tier);
  }
  assert.ok(seen.size >= 1);
});

test('L09 admin: weights per tier are saved and checked by the server; shares and cost per tier in the warnings; budget, quantities and other limits unchanged', async () => {
  const fs = adminDb();
  const cur = await getDecoded(`wheelCampaigns/${CID}`);
  const base = { active: true, minOrderJod: 5, budgetJod: 500, giftOnCancel: 'return', prizeValidDays: 30, startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', terms: '', prizes: [] };
  const save = async (campaign, upd) => callWorker(env(), { method: 'POST', path: '/admin/wheel/campaign', headers: await authH(OWNER), body: { campaign, baseUpdateTime: upd } });
  const prizes = [
    { id: 'small', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5, weight: 0, weights: { new: 60, returning: 65, loyal: 70 }, quantity: 10, unitCostJod: 1 },
    { id: 'big', type: 'gift', label: 'ساعة', valueJod: 9, minOrderJod: 15, weight: 0, weights: { new: 1, returning: 2, loyal: 4 }, quantity: 2, unitCostJod: 9 },
    ...NONES.map((n) => ({ ...n, weights: { new: 100, returning: 95, loyal: 90 } })),
  ];
  const ok = await save({ ...base, prizes }, cur.__raw.updateTime);
  assert.equal(ok.status, 200, ok.text);
  const stored = await getDecoded(`wheelCampaigns/${CID}`);
  assert.deepEqual(stored.prizes.find((p) => p.id === 'big').weights, { new: 1, returning: 2, loyal: 4 });
  assert.ok(ok.body.warnings.some((w) => /متوسط التكلفة المتوقعة لكل لفة[\s\S]*جديد[\s\S]*راجع[\s\S]*دائم/.test(w)), JSON.stringify(ok.body.warnings));
  // invalid tier weight -> refused, nothing written
  const bad = await save({ ...base, prizes: [{ ...prizes[0], weights: { new: -1 } }, ...prizes.slice(1)] }, stored.__raw.updateTime);
  assert.equal(bad.status, 422);
  assert.ok(bad.body.errors.some((e) => /وزن الفئة/.test(e)));
  // a tier with nothing drawable while active -> refused (each tier must have chances)
  const empty = await save({ ...base, prizes: prizes.map((p) => ({ ...p, weights: { ...p.weights, loyal: 0 } })) }, stored.__raw.updateTime);
  assert.equal(empty.status, 422);
  assert.ok(empty.body.errors.some((e) => /«دائم»/.test(e)));
  // the budget rule is unchanged
  const over = await save({ ...base, budgetJod: 5, prizes }, stored.__raw.updateTime);
  assert.equal(over.status, 422);
  // the weights checked as a draw (unit, no Firestore): loyal draws the big prize more often than new, both rare
  const c = checkCampaign({ ...base, prizes }).campaign;
  const rem = new Map([['small', 10], ['big', 2]]);
  const count = (tier) => { let big = 0; for (let r = 0; r < 365; r++) if (drawPrize(c, rem, () => r, Date.now(), tier) === 'big') big += 1; return big; };
  assert.equal(count('new'), 1); // 1 / 361 of the weight space
  assert.equal(count('loyal'), 4); // 4 / 344
  assert.ok(fs);
});
