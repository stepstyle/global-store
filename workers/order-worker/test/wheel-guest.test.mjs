// LOCAL ONLY: the real Worker (src/index.js) + Firestore EMULATOR (demo- project) + mock JWKS with TEST keys.
//   node <emu.mjs> . demo-dairsharaf-orders "node --test --test-concurrency=1 test/wheel-guest.test.mjs"
// The spin WITHOUT an account (owner's rule): stored server-side under the browser's random ticket, claimed by the
// Google account at checkout, then used by the order. TEST settings only.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startMockServices, makeEnv, callWorker, clearDb, seedProducts, putDoc, getDecoded, count, eq, runCron, PROJECT_ID } from './helpers.mjs';
import { checkoutOrder, makeOrderId } from './fixtures.mjs';
import { makeTestSigner } from './token-signer.mjs';
import { clearKeyCache } from '../src/auth.js';
import { guestPath } from '../src/wheel-guest.js';

const OWNER = 'ownerUid00000000000000000000O1';
const ALICE = 'aliceUid000000000000000000A1';
const BOB = 'bobUid00000000000000000000000B1';
const CID = 'test-campaign';

let mock;
let signer;
const origLog = console.log;
const WHEEL = { STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', PRICE_CHECK_MODE: 'enforce', WHEEL_MODE: 'test', WHEEL_CAMPAIGN: CID, WHEEL_PHONE_SECRET: 'test-only-wheel-phone-secret-0123456789', WHEEL_GUEST_PER_IP_DAY: '100', ORDER_SIGN_IN: 'google' };
const env = (o = {}) => makeEnv(mock.url, { ...WHEEL, ...o });
const token = (uid, extra = {}) => signer.idToken({ projectId: PROJECT_ID, uid, extra: { email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'google.com' }, ...extra } });
const authH = async (uid) => ({ origin: 'https://dairsharaf.com', authorization: `Bearer ${await token(uid)}` });
const ORIGIN = { origin: 'https://dairsharaf.com' };
const newTicket = () => randomBytes(32).toString('base64url');

const PRODUCTS = { 'p-5': { name: 'منتج 5', price: 5, stock: 20 }, 'p-15': { name: 'منتج 15', price: 15, stock: 20 } };
const NONES = [1, 2, 3].map((i) => ({ id: `none-${i}`, type: 'none', label: 'حظ أوفر', weight: 0 }));
const DISC = { id: 'disc-1', type: 'discount', label: 'خصم دينار', valueJod: 1, minOrderJod: 5, weight: 1, quantity: 5 };
const campaign = (prizes, extra = {}) => ({
  active: true, minOrderJod: 5, budgetJod: 500, giftOnCancel: 'return', prizeValidDays: 7,
  startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', terms: 'شروط تجريبية', prizes, ...extra,
});
async function seed(prizes, extra) {
  await putDoc(`wheelCampaigns/${CID}`, campaign(prizes, extra));
  for (const p of prizes) if (p.type !== 'none') await putDoc(`wheelPool/${CID}_${p.id}`, { remaining: p.quantity ?? 5 });
}
const remaining = async (id) => (await getDecoded(`wheelPool/${CID}_${id}`))?.remaining;

before(async () => {
  mock = await startMockServices();
  signer = await makeTestSigner('kid-wheel-guest');
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

const gSpin = (ticket, { e = env(), ip } = {}) => callWorker(e, { method: 'POST', path: '/wheel/guest/spin', headers: { ...ORIGIN, ...(ip ? { 'cf-connecting-ip': ip } : {}) }, body: { ticket } });
const gState = (ticket, e = env()) => callWorker(e, { method: 'POST', path: '/wheel/guest/state', headers: ORIGIN, body: { ticket } });
const gClaim = async (uid, ticket, e = env()) => callWorker(e, { method: 'POST', path: '/wheel/guest/claim', headers: uid ? await authH(uid) : ORIGIN, body: { ticket } });
const accSpin = async (uid, e = env()) => callWorker(e, { method: 'POST', path: '/wheel/spin', headers: await authH(uid), body: {} });
const accState = async (uid, e = env()) => callWorker(e, { path: '/wheel/state', headers: await authH(uid) });
function cartOrder(uid, productId, { discount = 0, shipping = 1, id = makeOrderId() } = {}) {
  const price = PRODUCTS[productId].price;
  const items = [{ productId, name: productId, price, quantity: 1, image: '', selectedVariant: null }];
  return checkoutOrder({ id, userId: uid, items, overrides: { subtotal: price, discountAmount: discount, shippingCost: shipping, total: Math.max(0, price - discount + shipping) } });
}
const place = async (uid, o, spinId) => callWorker(env(), { method: 'POST', path: '/create-order', headers: await authH(uid), body: { order: o, ...(spinId ? { wheelSpinId: spinId } : {}) } });

test('G01 spin WITHOUT an account: no token, no Turnstile; the result is stored; the same ticket never draws again', async () => {
  await seed([DISC, ...NONES]);
  const t = newTicket();
  const r = await gSpin(t, { e: env({ TURNSTILE_MODE: 'enforce', TURNSTILE_SECRET: 'x' }) });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.repeated, false);
  assert.equal(r.body.result.prizeId, 'disc-1');
  assert.equal(r.body.result.status, 'held');
  assert.equal(r.body.result.valueJod, 1);
  assert.equal(r.body.result.minOrderJod, 5);
  assert.ok(r.body.result.holdUntil && r.body.result.expiresAt);
  // the answer never carries the ticket hash, an IP key or campaign figures
  for (const k of ['weight', 'quantity', 'remaining', 'unitCostJod', 'ticket', 'ip']) assert.ok(!JSON.stringify(r.body).includes(`"${k}`), k);
  // retry after a lost answer / refresh / second tab: the SAME result, one document, one pool unit
  for (let i = 0; i < 3; i++) {
    const again = await gSpin(t);
    assert.equal(again.body.repeated, true);
    assert.deepEqual(again.body.result, r.body.result);
  }
  assert.equal(await count('wheelGuestSpins'), 1);
  assert.equal(await remaining('disc-1'), 4);
  assert.equal(await count('wheelSpins'), 0);
  const s = await gState(t);
  assert.equal(s.status, 200);
  assert.equal(s.body.result.prizeId, 'disc-1');
  // only the HASH of the ticket is a key
  const doc = await getDecoded(await guestPath(CID, t));
  assert.ok(doc);
  assert.ok(!JSON.stringify(doc).includes(t));
  // malformed tickets are refused before anything is read
  for (const bad of ['', 'short', 'x'.repeat(44), `${'a'.repeat(42)}!`, 123]) assert.equal((await gSpin(bad)).status, 400, String(bad));
  assert.equal((await gState(newTicket())).status, 404);
});

test('G02 the prize terms are FIXED at the spin: an admin edit afterwards never changes a won prize', async () => {
  await seed([DISC]);
  const t = newTicket();
  await gSpin(t);
  await putDoc(`wheelCampaigns/${CID}`, campaign([{ ...DISC, label: 'خصم معدّل', valueJod: 3, minOrderJod: 20 }]));
  const s = await gState(t);
  assert.equal(s.body.result.label, 'خصم دينار');
  assert.equal(s.body.result.valueJod, 1);
  assert.equal(s.body.result.minOrderJod, 5);
  const c = await gClaim(ALICE, t);
  assert.equal(c.status, 200, c.text);
  const spin = await getDecoded(`wheelSpins/${CID}_${ALICE}_1`);
  assert.equal(spin.valueJod, 1);
  assert.equal(spin.minOrderJod, 5);
  assert.equal(spin.label, 'خصم دينار');
});

test('G03 claim after Google sign-in: the ticket becomes the account\'s welcome result ONCE; never claimed by a second account; no extra spin', async () => {
  await seed([DISC]);
  const t = newTicket();
  const g = (await gSpin(t)).body.result;
  assert.equal((await gClaim(null, t)).status, 401);
  const c = await gClaim(ALICE, t);
  assert.equal(c.status, 200, c.text);
  assert.equal(c.body.spinId, `${CID}_${ALICE}_1`);
  const spin = await getDecoded(`wheelSpins/${CID}_${ALICE}_1`);
  assert.equal(spin.status, 'issued');
  assert.equal(spin.prizeId, g.prizeId);
  assert.equal(spin.fromGuest, true);
  assert.equal(spin.expiresAt.toISOString(), g.expiresAt);
  assert.equal((await getDecoded(`wheelEntitlements/${CID}_${ALICE}`)).used, 1);
  // the same account again: the same answer (two tabs / a retry)
  const again = await gClaim(ALICE, t);
  assert.equal(again.status, 200);
  assert.equal(again.body.repeated, true);
  // another account with the same ticket (copied from the browser): refused
  const bob = await gClaim(BOB, t);
  assert.equal(bob.status, 409);
  assert.equal(bob.body.code, 'WHEEL_GUEST_CLAIMED');
  assert.equal(await count('wheelSpins'), 1);
  // signing in gives NO second welcome spin: the account's spin returns the claimed result
  const s = await accSpin(ALICE);
  assert.equal(s.body.repeated, true);
  assert.equal(s.body.result.spinId, `${CID}_${ALICE}_1`);
  assert.equal((await accState(ALICE)).body.chancesLeft, 0);
  // the pool unit was taken ONCE (at the spin), not again at the claim
  assert.equal(await remaining('disc-1'), 4);
});

test('G04 full sequence: guest spin -> cart -> Google sign-in -> claim -> order with the prize (discount applied by the server, once)', async () => {
  await seed([DISC]);
  const t = newTicket();
  await gSpin(t);
  // before signing in, an order is refused (ORDER_SIGN_IN=google) and the prize is untouched
  const guestTry = await callWorker(env(), { method: 'POST', path: '/create-order', headers: ORIGIN, body: { order: cartOrder('guest', 'p-5', { discount: 1 }) } });
  assert.equal(guestTry.status, 401);
  assert.equal(guestTry.body.code, 'SIGN_IN_REQUIRED');
  const c = await gClaim(ALICE, t);
  assert.equal(c.status, 200, c.text);
  const o = cartOrder(ALICE, 'p-5', { discount: 1 });
  const r = await place(ALICE, o, c.body.spinId);
  assert.equal(r.status, 200, r.text);
  const L = await getDecoded(`orderLedger/${o.id}`);
  assert.equal(L.wheel.discountJod, 1);
  assert.equal(L.serverPricing.total, 5);
  assert.equal((await getDecoded(`wheelSpins/${c.body.spinId}`)).status, 'reserved');
  // the same prize on a second order: refused
  const o2 = cartOrder(ALICE, 'p-15', { discount: 1 });
  const r2 = await place(ALICE, o2, c.body.spinId);
  assert.equal(r2.status, 422, r2.text);
  assert.equal(r2.body.code, 'WHEEL_PRIZE_USED');
});

test('G05 an account that ALREADY spun keeps its own result: the guest result is refused and its unit goes back to the pool', async () => {
  await seed([DISC, { ...NONES[0], weight: 0 }]);
  const own = await accSpin(ALICE);
  assert.equal(own.status, 200, own.text);
  const before = await remaining('disc-1');
  const t = newTicket();
  await gSpin(t);
  assert.equal(await remaining('disc-1'), before - 1);
  const c = await gClaim(ALICE, t);
  assert.equal(c.status, 409);
  assert.equal(c.body.code, 'WHEEL_ACCOUNT_HAS_SPIN');
  assert.equal(await remaining('disc-1'), before);
  assert.equal(await count('wheelSpins'), 1);
  assert.equal((await getDecoded(await guestPath(CID, t))).status, 'refused');
  // the closed ticket cannot be claimed by another account afterwards either
  assert.equal((await gClaim(BOB, t)).body.code, 'WHEEL_ACCOUNT_HAS_SPIN');
  assert.equal(await remaining('disc-1'), before);
});

test('G06 an unclaimed ticket holds its unit for a limited time: expired at the claim -> refused; the cron returns other held units once', async () => {
  await seed([{ ...DISC, quantity: 3 }]);
  const t1 = newTicket();
  const t2 = newTicket();
  await gSpin(t1);
  await gSpin(t2);
  assert.equal(await remaining('disc-1'), 1);
  // both holds run out (the stored hold end is moved into the past)
  for (const t of [t1, t2]) {
    const p = await guestPath(CID, t);
    const { __raw, ...d } = await getDecoded(p);
    await putDoc(p, { ...d, holdExpiry: new Date(Date.now() - 60_000) });
  }
  const c = await gClaim(ALICE, t1);
  assert.equal(c.status, 409);
  assert.equal(c.body.code, 'WHEEL_GUEST_EXPIRED');
  assert.equal(await remaining('disc-1'), 2);
  const cron1 = await runCron(env());
  assert.equal(cron1.guest.released, 1);
  const cron2 = await runCron(env());
  assert.equal(cron2.guest.released, 0);
  assert.equal(await remaining('disc-1'), 3);
  assert.equal((await getDecoded(await guestPath(CID, t2))).status, 'expired');
  assert.equal((await gClaim(BOB, t2)).body.code, 'WHEEL_GUEST_EXPIRED');
  // a late claim still USES the account's welcome spin (recorded as expired): signing in late never gives a new draw
  assert.equal(await count('wheelSpins'), 2);
  for (const uid of [ALICE, BOB]) {
    assert.equal((await getDecoded(`wheelSpins/${CID}_${uid}_1`)).status, 'expired');
    const again = await accSpin(uid);
    assert.equal(again.body.repeated, true, uid);
  }
  // and the units came back exactly once each (claim, cron, repeated claims, spins: never twice)
  assert.equal((await gClaim(ALICE, t1)).body.code, 'WHEEL_GUEST_EXPIRED');
  await runCron(env());
  assert.equal(await remaining('disc-1'), 3);
});

test('G07 per-IP limit for guest spins (an obstacle, not a proof): the 3rd ticket from one IP is refused; another IP passes; a stored ticket still answers', async () => {
  await seed([DISC]);
  const e = env({ WHEEL_GUEST_PER_IP_DAY: '2' });
  const first = newTicket();
  assert.equal((await gSpin(first, { e, ip: '198.51.100.7' })).status, 200);
  assert.equal((await gSpin(newTicket(), { e, ip: '198.51.100.7' })).status, 200);
  const third = await gSpin(newTicket(), { e, ip: '198.51.100.7' });
  assert.equal(third.status, 429);
  assert.equal(third.body.code, 'WHEEL_GUEST_LIMIT');
  assert.equal((await gSpin(newTicket(), { e, ip: '198.51.100.8' })).status, 200);
  const replay = await gSpin(first, { e, ip: '198.51.100.7' });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.repeated, true);
  // the IP itself is never stored
  const docs = JSON.stringify(await adminDump('wheelGuestIps'));
  assert.ok(!docs.includes('198.51.100'));
  assert.equal((await gSpin(newTicket(), { e: env({ WHEEL_GUEST_PER_IP_DAY: '0' }) })).body.code, 'WHEEL_GUEST_OFF');
});

test('G08 races: 6 identical guest spins, 6 claims by two accounts, a claim against the account\'s own spin -> one result each, never two', async () => {
  await seed([DISC, { ...NONES[0], weight: 1 }]);
  const t = newTicket();
  const spins = await Promise.all(Array.from({ length: 6 }, () => gSpin(t)));
  assert.ok(spins.every((s) => s.status === 200), spins.map((s) => s.text).join('\n'));
  assert.equal(new Set(spins.map((s) => s.body.result.prizeId)).size, 1);
  assert.equal(await count('wheelGuestSpins'), 1);
  const claims = await Promise.all(Array.from({ length: 6 }, (_, i) => gClaim(i % 2 ? BOB : ALICE, t)));
  const owners = new Set(claims.filter((c) => c.status === 200).map((c) => c.body.spinId.split('_')[1]));
  assert.equal(owners.size, 1, claims.map((c) => `${c.status} ${c.body?.code}`).join(','));
  assert.equal(await count('wheelSpins'), 1);
  // a fresh account: claim and own spin at the same time -> exactly ONE welcome result
  const t2 = newTicket();
  await gSpin(t2);
  const CAROL = 'carolUid00000000000000000000C1';
  await Promise.all([gClaim(CAROL, t2), accSpin(CAROL), gClaim(CAROL, t2), accSpin(CAROL)]);
  assert.equal(await count('wheelSpins', eq('uid', CAROL)), 1);
  assert.equal((await getDecoded(`wheelEntitlements/${CID}_${CAROL}`)).used, 1);
});

test('G09 a "حظ أوفر" guest result also counts as the welcome spin: signing in does not give a new draw', async () => {
  await seed([{ ...DISC, weight: 0 }, { ...NONES[1], weight: 1 }]);
  const t = newTicket();
  const g = (await gSpin(t)).body.result;
  assert.equal(g.status, 'none');
  assert.equal(g.prizeId, 'none-2');
  assert.equal(g.holdUntil, null);
  const c = await gClaim(ALICE, t);
  assert.equal(c.status, 200, c.text);
  const s = await accSpin(ALICE);
  assert.equal(s.body.repeated, true);
  assert.equal(s.body.result.status, 'none');
  assert.equal(await count('wheelSpins'), 1);
});

test('G10 wheel off -> 404 before anything is read; no welcome spin in the campaign -> refused; closed campaign -> refused', async () => {
  await seed([DISC]);
  const off = env({ WHEEL_MODE: 'off' });
  for (const p of ['/wheel/guest/spin', '/wheel/guest/state', '/wheel/guest/claim']) {
    assert.equal((await callWorker(off, { method: 'POST', path: p, headers: ORIGIN, body: { ticket: newTicket() } })).status, 404, p);
  }
  await seed([DISC], { freeFirstChance: false });
  assert.equal((await gSpin(newTicket())).body.code, 'WHEEL_NO_WELCOME_SPIN');
  await seed([DISC], { active: false });
  assert.equal((await gSpin(newTicket())).body.code, 'CAMPAIGN_CLOSED');
  assert.equal(await count('wheelGuestSpins'), 0);
});

async function adminDump(collectionId) {
  const { adminDb } = await import('./helpers.mjs');
  return adminDb().runQuery({ from: [{ collectionId }], limit: 50 });
}
