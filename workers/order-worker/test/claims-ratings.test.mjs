// LOCAL ONLY: the real Worker (src/index.js) + Firestore EMULATOR (demo- project) + mock JWKS with TEST keys.
//   firebase emulators:exec --only firestore --project demo-dairsharaf-orders --config test/firebase.claims.body \
//     "node --test --test-concurrency=1 test/claims-ratings.test.mjs"
// POST /orders/:id/claim (link a guest order to the signed-in account) and POST /products/:id/ratings.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMockServices, makeEnv, callWorker, clearDb, seedProducts, putDoc, getDecoded, productStock, PROJECT_ID } from './helpers.mjs';
import { checkoutOrder, makeOrderId } from './fixtures.mjs';
import { makeTestSigner } from './token-signer.mjs';
import { normalizeTrackingKey, hashTrackingKey } from '../src/tracking.js';
import { clearKeyCache } from '../src/auth.js';

const ALICE = 'aliceUid000000000000000000A1';
const MALLORY = 'malloryUid0000000000000000M1';
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const newKey = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => B32[b % 32]).join('');
const hashOf = async (k) => hashTrackingKey(normalizeTrackingKey(k));

let mock;
let signer;
let forger;
const logs = [];
const origLog = console.log;
const env = (o = {}) => makeEnv(mock.url, { STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', ...o });
const token = (uid) => signer.idToken({ projectId: PROJECT_ID, uid });

before(async () => {
  mock = await startMockServices();
  signer = await makeTestSigner('kid-claims');
  forger = await makeTestSigner('kid-claims');
  console.log = (...a) => { logs.push(a.join(' ')); };
});
after(async () => { console.log = origLog; await mock?.close(); });
beforeEach(async () => {
  mock.reset();
  clearKeyCache();
  mock.state.jwks = { keys: [signer.jwk] };
  logs.length = 0;
  await clearDb();
  await seedProducts();
});

async function guestOrder({ uidToken } = {}) {
  const key = newKey();
  const order = checkoutOrder({ id: makeOrderId(), userId: uidToken ? uidToken.uid : 'guest' });
  const r = await callWorker(env(), {
    method: 'POST', path: '/create-order', body: { order, trackingKeyHash: await hashOf(key) },
    headers: uidToken ? { authorization: `Bearer ${uidToken.token}` } : {},
  });
  assert.equal(r.status, 200, r.text);
  return { id: order.id, key };
}
const claim = (id, { key, tok } = {}) => callWorker(env(), {
  method: 'POST', path: `/orders/${encodeURIComponent(id)}/claim`,
  headers: { origin: 'https://dairsharaf.com', ...(key !== undefined ? { 'x-tracking-key': key } : {}), ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
});
const summary = (id, { key, tok } = {}) => callWorker(env(), {
  path: `/orders/${encodeURIComponent(id)}/summary`,
  headers: { ...(key !== undefined ? { 'x-tracking-key': key } : {}), ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
});

// ------------------------------------------------------------------ claim
test('C01 guest order + its tracking key + verified sign-in -> linked once (order.userId, ledger.ownerUid, claim record)', async () => {
  const { id, key } = await guestOrder();
  const before = await getDecoded(`orderLedger/${id}`);
  const r = await claim(id, { key, tok: await token(ALICE) });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { ok: true, linked: true });
  const o = await getDecoded(`orders/${id}`);
  const l = await getDecoded(`orderLedger/${id}`);
  assert.equal(o.userId, ALICE);
  assert.equal(o.userIdVerified, true);
  assert.ok(o.linkedAt instanceof Date, 'server time of the link');
  assert.equal(l.ownerUid, ALICE);
  assert.equal(l.claim.method, 'tracking-key');
  // nothing else of the order / ledger changed: status, totals, stock state, tracking hash
  assert.equal(o.status, 'new');
  assert.deepEqual(l.inventory, before.inventory);
  assert.equal(l.trackingKeyHash, before.trackingKeyHash);
  // the same customer again: already theirs, no write
  const again = await claim(id, { key, tok: await token(ALICE) });
  assert.deepEqual(again.body, { ok: true, linked: false, alreadyYours: true });
});

test('C02 an order already linked to another account is never moved (409), even with the right key', async () => {
  const { id, key } = await guestOrder();
  assert.equal((await claim(id, { key, tok: await token(ALICE) })).status, 200);
  const r = await claim(id, { key, tok: await token(MALLORY) });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'ALREADY_LINKED');
  assert.equal((await getDecoded(`orders/${id}`)).userId, ALICE);
  assert.equal((await getDecoded(`orderLedger/${id}`)).ownerUid, ALICE);
});

test('C03 an order placed while signed in belongs to that account: another account cannot claim it', async () => {
  const { id, key } = await guestOrder({ uidToken: { uid: ALICE, token: await token(ALICE) } });
  assert.equal((await claim(id, { key, tok: await token(MALLORY) })).status, 409);
  const mine = await claim(id, { key, tok: await token(ALICE) });
  assert.equal(mine.body.alreadyYours, true);
});

test('C04 wrong / missing / malformed key and unknown order: the same 404 (no hint that the order exists)', async () => {
  const { id } = await guestOrder();
  const tok = await token(ALICE);
  const answers = [
    await claim(id, { key: newKey(), tok }),
    await claim(id, { tok }),
    await claim(id, { key: 'not-a-key', tok }),
    await claim(makeOrderId(), { key: newKey(), tok }),
    await claim('ORD-1', { key: newKey(), tok }),
  ];
  for (const a of answers) assert.deepEqual([a.status, a.body], [404, { ok: false, code: 'NOT_FOUND' }]);
  assert.equal((await getDecoded(`orders/${id}`)).userId, 'guest', 'still a guest order');
});

test('C05 identity is verified: no token, a forged token, GET -> refused, nothing written', async () => {
  const { id, key } = await guestOrder();
  assert.equal((await claim(id, { key })).status, 401);
  const forged = await forger.idToken({ projectId: PROJECT_ID, uid: ALICE });
  assert.equal((await claim(id, { key, tok: forged })).status, 401);
  const get = await callWorker(env(), { path: `/orders/${id}/claim`, headers: { 'x-tracking-key': key } });
  assert.equal(get.status, 405);
  assert.equal((await getDecoded(`orders/${id}`)).userId, 'guest');
});

test('C06 five accounts claim the SAME order at the same moment: exactly one wins, the others get 409', async () => {
  const { id, key } = await guestOrder();
  const uids = ['u1', 'u2', 'u3', 'u4', 'u5'].map((x) => `${x}Uid00000000000000000000000`.slice(0, 28));
  const toks = await Promise.all(uids.map((u) => token(u)));
  const rs = await Promise.all(toks.map((tok) => claim(id, { key, tok })));
  const won = rs.filter((r) => r.status === 200 && r.body.linked === true);
  assert.equal(won.length, 1, JSON.stringify(rs.map((r) => [r.status, r.body])));
  assert.ok(rs.every((r) => r.status === 200 || (r.status === 409 && ['ALREADY_LINKED', 'BUSY'].includes(r.body.code))));
  const owner = (await getDecoded(`orderLedger/${id}`)).ownerUid;
  assert.ok(uids.includes(owner));
  assert.equal((await getDecoded(`orders/${id}`)).userId, owner);
});

test('C07 after linking: the device key still tracks it, the owner reads it with the token, others get 404', async () => {
  const { id, key } = await guestOrder();
  await claim(id, { key, tok: await token(ALICE) });
  assert.equal((await summary(id, { key })).status, 200, 'the tracking key keeps working');
  assert.equal((await summary(id, { tok: await token(ALICE) })).status, 200, 'owner by token');
  assert.equal((await summary(id, { tok: await token(MALLORY) })).status, 404);
});

test('C08 linking never touches stock or reservations', async () => {
  const { id, key } = await guestOrder();
  const stockBefore = await productStock('p-simple');
  const resBefore = await getDecoded('stockReservations/p-simple');
  await claim(id, { key, tok: await token(ALICE) });
  assert.equal(await productStock('p-simple'), stockBefore);
  assert.deepEqual(await getDecoded('stockReservations/p-simple'), resBefore);
});

test('C09 the logs keep the order number and outcome only (no uid, no key, no personal data)', async () => {
  const { id, key } = await guestOrder();
  await claim(id, { key, tok: await token(ALICE) });
  await claim(id, { key, tok: await token(MALLORY) });
  const text = logs.join('\n');
  assert.match(text, /order\.claimed/);
  assert.match(text, /order\.claim_refused/);
  for (const secret of [ALICE, MALLORY, key, 'Test Buyer', '0791234567', 'buyer@example.com']) assert.ok(!text.includes(secret), secret);
});

// ------------------------------------------------------------------ ratings
async function review(id, data) { await putDoc(`reviews/${id}`, { userName: 'x', comment: 'جيد جدا', likesCount: 0, ...data }); }
const ratings = (pid, tok) => callWorker(env(), { method: 'POST', path: `/products/${encodeURIComponent(pid)}/ratings`, headers: tok ? { authorization: `Bearer ${tok}` } : {} });

test('R01 ratings are computed from the PUBLISHED reviews only; only the 4 rating fields are written', async () => {
  const before = await getDecoded('products/p-simple');
  await review('p-simple_a', { productId: 'p-simple', userId: 'a', rating: 5, status: 'published' });
  await review('p-simple_b', { productId: 'p-simple', userId: 'b', rating: 4 });
  await review('p-simple_c', { productId: 'p-simple', userId: 'c', rating: 1, status: 'hidden' });
  await review('p-other_d', { productId: 'p-variants', userId: 'd', rating: 1, status: 'published' });
  const r = await ratings('p-simple', await token(ALICE));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.avg, r.body.count, r.body.changed], [4.5, 2, true]);
  const after = await getDecoded('products/p-simple');
  assert.deepEqual([after.ratingAvg, after.ratingCount, after.rating, after.reviews], [4.5, 2, 4.5, 2]);
  for (const k of ['name', 'price', 'stock', 'category']) assert.deepEqual(after[k], before[k], k);
  assert.equal((await ratings('p-simple', await token(ALICE))).body.changed, false, 'idempotent');
});

test('R02 ratings: sign-in required; bad / unknown product refused', async () => {
  assert.equal((await ratings('p-simple')).status, 401);
  assert.equal((await ratings('bad id!', await token(ALICE))).status, 400);
  assert.equal((await ratings('p-nope', await token(ALICE))).status, 404);
});
