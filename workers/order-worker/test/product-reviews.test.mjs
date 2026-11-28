// LOCAL ONLY: the real Worker (src/index.js) + Firestore EMULATOR (demo- project) + mock JWKS with TEST keys.
//   firebase emulators:exec --only firestore --project demo-dairsharaf-orders --config test/firebase.json \
//     "node --test --test-concurrency=1 test/product-reviews.test.mjs"
// Verified-purchase reviews (src/reviews.js): only for a DELIVERED order, only its products, once per product per
// order, by the holder of the admin's private link or by the account that owns the order.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMockServices, makeEnv, callWorker, clearDb, seedProducts, putDoc, getDecoded, count, productStock, adminDb, PROJECT_ID } from './helpers.mjs';
import { checkoutOrder, makeOrderId, line } from './fixtures.mjs';
import { makeTestSigner } from './token-signer.mjs';
import { clearKeyCache } from '../src/auth.js';
import { cleanText, reviewableItems, normalizeReviewToken, newReviewToken, REVIEW_TOKEN_RE } from '../src/reviews.js';

const OWNER = 'ownerUid00000000000000000001';
const ADMIN = 'adminUid00000000000000000001';
const ALICE = 'aliceUid000000000000000000A1';
const MALLORY = 'malloryUid0000000000000000M1';
const ORIGIN = 'https://dairsharaf.com';

let mock;
let signer;
let forger;
const logs = [];
const origLog = console.log;
const env = (o = {}) => makeEnv(mock.url, { STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', ...o });
const token = (uid) => signer.idToken({ projectId: PROJECT_ID, uid });
const bearer = async (uid) => ({ authorization: `Bearer ${await token(uid)}` });

before(async () => {
  mock = await startMockServices();
  signer = await makeTestSigner('kid-reviews');
  forger = await makeTestSigner('kid-reviews');
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
  await putDoc('config/roles', { ownerUid: OWNER });
  await putDoc(`admins/${ADMIN}`, { active: true });
});

// ------------------------------------------------------------------ helpers
async function newOrder({ items, uid } = {}) {
  const o = checkoutOrder({ id: makeOrderId(), userId: uid || 'guest', ...(items ? { items } : {}) });
  const r = await callWorker(env(), { method: 'POST', path: '/create-order', body: { order: o }, headers: uid ? await bearer(uid) : {} });
  assert.equal(r.status, 200, r.text);
  return o.id;
}
const setStatus = async (id, status, extra = {}) => {
  const r = await callWorker(env(), { method: 'POST', path: `/admin/orders/${encodeURIComponent(id)}/status`, headers: { origin: ORIGIN, ...(await bearer(OWNER)) }, body: { status, ...extra } });
  assert.equal(r.status, 200, r.text);
};
async function deliveredOrder(opts) {
  const id = await newOrder(opts);
  await setStatus(id, 'delivered');
  return id;
}
const makeLink = async (id, { uid = ADMIN, rotate, headers } = {}) => callWorker(env(), {
  method: 'POST', path: `/admin/orders/${encodeURIComponent(id)}/review-link`,
  headers: { origin: ORIGIN, ...(headers ?? (uid ? await bearer(uid) : {})) },
  body: rotate === undefined ? {} : { rotate },
});
const tokenOf = (url) => decodeURIComponent(url.split('/').pop());
async function linkFor(id) {
  const r = await makeLink(id);
  assert.equal(r.status, 200, r.text);
  return tokenOf(r.body.url);
}
const state = (body, headers = {}) => callWorker(env(), { method: 'POST', path: '/reviews/state', headers: { origin: ORIGIN, ...headers }, body });
const submit = (body, headers = {}) => callWorker(env(), { method: 'POST', path: '/reviews/submit', headers: { origin: ORIGIN, ...headers }, body });
const ok5 = (orderId, tok, productId = 'p-simple', extra = {}) => ({ orderId, token: tok, productId, rating: 5, comment: 'ممتاز', name: 'سارة', ...extra });
const allReviews = async () => (await adminDb().runQuery({ from: [{ collectionId: 'reviews' }] })).map((d) => ({ id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, v])) }));
const productRating = async (pid) => { const p = await getDecoded(`products/${pid}`); return { avg: p.ratingAvg ?? null, count: p.ratingCount ?? null }; };

// ------------------------------------------------------------------ pure helpers
test('RV00 pure: token format, cleaning, reviewable items (one per product, gifts excluded)', () => {
  for (let i = 0; i < 50; i++) assert.match(newReviewToken(), REVIEW_TOKEN_RE);
  assert.equal(normalizeReviewToken('abcd-efgh-jkmn-pqrs-tvwx-yz01'), 'ABCDEFGHJKMNPQRSTVWXYZ01');
  assert.equal(normalizeReviewToken('short'), null);
  assert.equal(normalizeReviewToken(42), null);
  assert.equal(cleanText('  a‮b\u0000c   d '), 'abc d');
  assert.equal(cleanText('line1\r\n\r\n\r\n\r\nline2', { multiline: true }), 'line1\n\nline2');
  assert.equal(cleanText(5), null);
  const items = reviewableItems({ items: [
    { productId: 'p-variants', name: 'قلم - أحمر', selectedVariant: { label: 'أحمر' } },
    { productId: 'p-variants', name: 'قلم - أزرق', selectedVariant: { label: 'أزرق' } },
    { productId: 'p-simple', name: 'دفتر' },
    { productId: 'p-last-one', name: 'هدية', gift: true },
    { productId: 'wheel-gift', name: 'هدية العجلة' },
    { productId: '../x', name: 'bad id' },
  ] });
  assert.deepEqual(items.map((i) => [i.productId, i.variants]), [['p-variants', ['أحمر', 'أزرق']], ['p-simple', []]]);
});

// ------------------------------------------------------------------ the admin's link
test('RV01 link: admin only, delivered orders only; the token is never stored (hash only)', async () => {
  const id = await newOrder();
  assert.equal((await makeLink(id, { uid: null })).status, 401, 'no token');
  assert.equal((await makeLink(id, { uid: ALICE })).status, 403, 'a customer');
  const forged = await forger.idToken({ projectId: PROJECT_ID, uid: OWNER });
  assert.equal((await makeLink(id, { headers: { authorization: `Bearer ${forged}` } })).status, 401, 'a token signed by an unknown key');
  for (const st of ['new', 'processing', 'shipped']) {
    if (st !== 'new') await setStatus(id, st);
    const r = await makeLink(id);
    assert.equal(r.status, 409, `${st}: ${r.text}`);
    assert.equal(r.body.code, 'NOT_DELIVERED');
  }
  await setStatus(id, 'delivered');
  const r = await makeLink(id);
  assert.equal(r.status, 200, r.text);
  assert.match(r.body.url, new RegExp(`^${ORIGIN}/#/review/${id}/[0-9A-HJKMNP-TV-Z]{24}$`));
  assert.equal(r.body.items, 2);
  const inv = await getDecoded(`reviewInvites/${id}`);
  const tok = tokenOf(r.body.url);
  assert.match(inv.tokenHash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(inv).includes(tok), 'the token itself is not stored');
  assert.ok(inv.expiresAt.getTime() - Date.now() > 89 * 86400e3, '90 days by default');
  assert.equal((await makeLink('ORD-NOPE-NOPE')).status, 404);
  const cancelled = await newOrder();
  await setStatus(cancelled, 'cancelled');
  assert.equal((await makeLink(cancelled)).body.code, 'NOT_DELIVERED');
});

test('RV02 link: a second request needs rotate=true, and the new link replaces the old one', async () => {
  const id = await deliveredOrder();
  const t1 = await linkFor(id);
  const again = await makeLink(id);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'LINK_EXISTS');
  assert.equal((await state({ orderId: id, token: t1 })).status, 200, 'old link still valid until replaced');
  const r = await makeLink(id, { rotate: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.replaced, true);
  const t2 = tokenOf(r.body.url);
  assert.notEqual(t1, t2);
  assert.equal((await state({ orderId: id, token: t1 })).status, 404, 'old link no longer works');
  assert.equal((await state({ orderId: id, token: t2 })).status, 200);
});

// ------------------------------------------------------------------ state
test('RV03 state with the link: the order products only, no personal data', async () => {
  const id = await deliveredOrder();
  const tok = await linkFor(id);
  const r = await state({ orderId: id, token: tok });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.via, 'link');
  assert.equal(r.body.suggestedName, 'Test');
  assert.deepEqual(r.body.items.map((i) => [i.productId, i.reviewed, i.available]), [['p-simple', false, true], ['p-variants', false, true]]);
  assert.deepEqual(r.body.items[1].variants, ['أحمر']);
  const text = JSON.stringify(r.body);
  for (const secret of ['0791234567', '962791234567', 'buyer@example.com', 'شارع 1', 'Test Buyer', 'اتصل قبل', 'النزهة']) assert.ok(!text.includes(secret), `no ${secret}`);
});

test('RV04 every refusal before the proof is the same 404 (wrong / malformed token, unknown order, other order\'s token)', async () => {
  const id = await deliveredOrder();
  const other = await deliveredOrder();
  const tok = await linkFor(id);
  const tokOther = await linkFor(other);
  const cases = [
    { orderId: id, token: newReviewToken() },
    { orderId: id, token: 'not a token' },
    { orderId: id, token: tokOther },
    { orderId: 'ORD-NOPE-NOPE', token: tok },
    { orderId: '../orders/x', token: tok },
    { orderId: id },
  ];
  for (const c of cases) {
    const r = await state(c);
    assert.equal(r.status, 404, JSON.stringify(c));
    assert.deepEqual(r.body, { ok: false, code: 'NOT_FOUND' });
    const s = await submit({ ...ok5(c.orderId, c.token) });
    assert.equal(s.status, 404, JSON.stringify(c));
  }
  const noLink = await deliveredOrder();
  assert.equal((await state({ orderId: noLink, token: tok })).status, 404, 'order without any link');
  assert.equal(await count('reviews'), 0);
});

test('RV05 an expired link answers LINK_EXPIRED; an order cancelled (returned) after the link answers NOT_DELIVERED', async () => {
  const id = await deliveredOrder();
  const tok = await linkFor(id);
  const inv = await getDecoded(`reviewInvites/${id}`);
  await putDoc(`reviewInvites/${id}`, { ...Object.fromEntries(Object.entries(inv).filter(([k]) => k !== '__raw')), expiresAt: new Date(Date.now() - 1000) });
  const r = await state({ orderId: id, token: tok });
  assert.equal(r.status, 410);
  assert.equal(r.body.code, 'LINK_EXPIRED');
  assert.equal((await submit(ok5(id, tok))).body.code, 'LINK_EXPIRED');

  const id2 = await deliveredOrder();
  const tok2 = await linkFor(id2);
  await setStatus(id2, 'cancelled', { confirmReturn: true });
  const s = await submit(ok5(id2, tok2));
  assert.equal(s.status, 409);
  assert.equal(s.body.code, 'NOT_DELIVERED');
  assert.equal(await count('reviews'), 0);
});

// ------------------------------------------------------------------ submit
test('RV06 submit with the link: verified review, no personal data in it, private key holds the order; figures updated', async () => {
  const id = await deliveredOrder();
  const tok = await linkFor(id);
  const stockBefore = await productStock('p-simple');
  const orderBefore = await getDecoded(`orders/${id}`);
  const ledgerBefore = await getDecoded(`orderLedger/${id}`);
  const r = await submit(ok5(id, tok, 'p-variants', { rating: 4, comment: 'جميل لكن <b>الغطاء</b> ضعيف', name: '  سارة  م. ' }));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.ratingAvg, 4);
  assert.equal(r.body.ratingCount, 1);
  const rv = await getDecoded(`reviews/${r.body.reviewId}`);
  assert.equal(rv.productId, 'p-variants');
  assert.equal(rv.rating, 4);
  assert.equal(rv.comment, 'جميل لكن <b>الغطاء</b> ضعيف', 'kept as text (the store never renders it as HTML)');
  assert.equal(rv.userName, 'سارة م.');
  assert.equal(rv.verifiedPurchase, true);
  assert.equal(rv.status, 'published');
  assert.equal(rv.purchasedVariant, 'أحمر');
  assert.ok(rv.createdAt instanceof Date);
  const publicText = JSON.stringify(rv);
  for (const secret of [id, '0791234567', 'buyer@example.com', 'Test Buyer', 'شارع 1']) assert.ok(!publicText.includes(secret), `public review has no ${secret}`);
  const key = await getDecoded(`reviewKeys/${id}__p-variants`);
  assert.equal(key.reviewId, r.body.reviewId);
  assert.equal(key.orderId, id);
  assert.equal(key.via, 'link');
  assert.deepEqual(await productRating('p-variants'), { avg: 4, count: 1 });
  // nothing about the order, its stock or its ledger changed
  assert.equal(await productStock('p-simple'), stockBefore);
  const orderAfter = await getDecoded(`orders/${id}`);
  const ledgerAfter = await getDecoded(`orderLedger/${id}`);
  assert.equal(orderAfter.__raw.updateTime, orderBefore.__raw.updateTime, 'order untouched');
  assert.equal(ledgerAfter.__raw.updateTime, ledgerBefore.__raw.updateTime, 'ledger untouched');
  const st = await state({ orderId: id, token: tok });
  assert.deepEqual(st.body.items.map((i) => [i.productId, i.reviewed]), [['p-simple', false], ['p-variants', true]]);
});

test('RV07 one review per product per order: a repeat and 8 simultaneous submits give exactly one', async () => {
  const id = await deliveredOrder({ items: [line('p-hundred', 5)] });
  const tok = await linkFor(id);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => submit(ok5(id, tok, 'p-hundred', { rating: (i % 5) + 1 }))));
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409, 409, 409, 409, 409, 409, 409], results.map((r) => r.text).join('\n'));
  for (const r of results.filter((x) => x.status === 409)) assert.equal(r.body.code, 'ALREADY_REVIEWED');
  assert.equal(await count('reviews'), 1);
  assert.equal(await count('reviewKeys'), 1);
  const again = await submit(ok5(id, tok, 'p-hundred'));
  assert.equal(again.body.code, 'ALREADY_REVIEWED');
  // a NEW link for the same order does not allow a second review either
  const r2 = await makeLink(id, { rotate: true });
  assert.equal((await submit(ok5(id, tokenOf(r2.body.url), 'p-hundred'))).body.code, 'ALREADY_REVIEWED');
  assert.equal((await productRating('p-hundred')).count, 1);
});

test('RV08 the link cannot review a product that is not in the order, a wheel gift, or a deleted product', async () => {
  const id = await deliveredOrder();
  const tok = await linkFor(id);
  for (const pid of ['p-last-one', 'p-hundred', 'wheel-gift', '', null, 123]) {
    const r = await submit(ok5(id, tok, pid));
    assert.equal(r.status, 422, String(pid));
    assert.equal(r.body.code, 'PRODUCT_NOT_IN_ORDER');
  }
  // a gift line inside the order
  await putDoc(`orders/${id}`, { ...(await getDecoded(`orders/${id}`)), __raw: undefined, items: [...(await getDecoded(`orders/${id}`)).items, { productId: 'p-last-one', name: 'هدية', price: 0, quantity: 1, gift: true }] });
  assert.equal((await submit(ok5(id, tok, 'p-last-one'))).body.code, 'PRODUCT_NOT_IN_ORDER');
  // the product was deleted from the store meanwhile
  await adminDb().commit([{ delete: adminDb().name('products/p-simple') }]);
  const gone = await submit(ok5(id, tok, 'p-simple'));
  assert.equal(gone.status, 409);
  assert.equal(gone.body.code, 'PRODUCT_UNAVAILABLE');
  assert.equal(await count('reviews'), 0);
});

test('RV09 rating 1..5 integers only; comment optional (max 1000); display name 2..40', async () => {
  const id = await deliveredOrder();
  const tok = await linkFor(id);
  for (const rating of [0, 6, 4.5, '5', null, undefined, -1, true]) {
    const r = await submit(ok5(id, tok, 'p-simple', { rating }));
    assert.equal(r.body.code, 'INVALID_RATING', String(rating));
  }
  assert.equal((await submit(ok5(id, tok, 'p-simple', { comment: 'x'.repeat(1001) }))).body.code, 'INVALID_COMMENT');
  assert.equal((await submit(ok5(id, tok, 'p-simple', { comment: { a: 1 } }))).body.code, 'INVALID_COMMENT');
  for (const name of ['', 'a', ' ', 'x'.repeat(41), 7, null]) assert.equal((await submit(ok5(id, tok, 'p-simple', { name }))).body.code, 'INVALID_NAME', String(name));
  assert.equal(await count('reviews'), 0);
  // stars only, no comment: accepted (rating 1 is a valid, negative opinion)
  const r = await submit({ orderId: id, token: tok, productId: 'p-simple', rating: 1, name: 'Ali' });
  assert.equal(r.status, 200, r.text);
  assert.equal((await getDecoded(`reviews/${r.body.reviewId}`)).comment, '');
});

// ------------------------------------------------------------------ signed-in owner
test('RV10 the signed-in OWNER reviews a delivered order without a link; another account or a forged token cannot', async () => {
  const id = await deliveredOrder({ uid: ALICE });
  const st = await state({ orderId: id }, await bearer(ALICE));
  assert.equal(st.status, 200, st.text);
  assert.equal(st.body.via, 'account');
  assert.equal(st.body.suggestedName, '', 'no name taken from the order for the account path');
  assert.equal((await state({ orderId: id }, await bearer(MALLORY))).status, 404);
  assert.equal((await state({ orderId: id })).status, 404, 'no identity');
  const forged = await forger.idToken({ projectId: PROJECT_ID, uid: ALICE });
  assert.equal((await state({ orderId: id }, { authorization: `Bearer ${forged}` })).status, 404);
  assert.equal((await submit(ok5(id, undefined), await bearer(MALLORY))).status, 404);
  const r = await submit(ok5(id, undefined), await bearer(ALICE));
  assert.equal(r.status, 200, r.text);
  const key = await getDecoded(`reviewKeys/${id}__p-simple`);
  assert.equal(key.via, 'account');
  assert.equal(key.uid, ALICE);
  const rv = await getDecoded(`reviews/${r.body.reviewId}`);
  assert.ok(!JSON.stringify(rv).includes(ALICE), 'the account id is not public');
  // the same product of the same order through a link afterwards: still one review
  const tok = await linkFor(id);
  assert.equal((await submit(ok5(id, tok))).body.code, 'ALREADY_REVIEWED');
});

test('RV11 an order whose userId was NOT verified by the Worker (written by a browser / old site) gives the account nothing', async () => {
  // an old-style order: userId set by the browser, no ledger
  const id = makeOrderId();
  await putDoc(`orders/${id}`, { ...checkoutOrder({ id, userId: ALICE }), status: 'delivered' });
  assert.equal((await state({ orderId: id }, await bearer(ALICE))).status, 404);
  assert.equal((await submit(ok5(id, undefined), await bearer(ALICE))).status, 404);
  // the admin can still vouch for it with a link (the admin sees the order was delivered)
  const tok = await linkFor(id);
  assert.equal((await submit(ok5(id, tok))).status, 200);
});

test('RV12 not delivered yet: the owner is told NOT_DELIVERED, nothing is written', async () => {
  const id = await newOrder({ uid: ALICE });
  await setStatus(id, 'shipped');
  const r = await submit(ok5(id, undefined), await bearer(ALICE));
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'NOT_DELIVERED');
  assert.equal(await count('reviews'), 0);
});

test('RV13 eligible: the account\'s delivered, verified, not yet reviewed orders of THIS product', async () => {
  const a = await deliveredOrder({ uid: ALICE });
  const b = await deliveredOrder({ uid: ALICE, items: [line('p-simple', 1)] });
  await newOrder({ uid: ALICE }); // not delivered
  await deliveredOrder({ uid: MALLORY });
  const fake = makeOrderId();
  await putDoc(`orders/${fake}`, { ...checkoutOrder({ id: fake, userId: ALICE }), status: 'delivered' }); // no ledger
  const call = async (pid, uid = ALICE) => callWorker(env(), { method: 'POST', path: '/reviews/eligible', headers: { origin: ORIGIN, ...(uid ? await bearer(uid) : {}) }, body: { productId: pid } });
  assert.equal((await call('p-simple', null)).status, 401);
  const r = await call('p-simple');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.orders.map((o) => o.orderId).sort(), [a, b].sort());
  assert.deepEqual((await call('p-variants')).body.orders.map((o) => [o.orderId, o.variants]), [[a, ['أحمر']]]);
  await submit(ok5(a, undefined), await bearer(ALICE));
  assert.deepEqual((await call('p-simple')).body.orders.map((o) => o.orderId), [b], 'reviewed order no longer listed');
  assert.equal((await call('../x')).status, 400);
});

// ------------------------------------------------------------------ figures + moderation
test('RV14 figures count verified, published reviews only (older browser-written reviews are not counted)', async () => {
  await putDoc('reviews/p-simple_oldUid', { productId: 'p-simple', userId: 'oldUid', userName: 'قديم', rating: 1, comment: 'قديم', status: 'published' });
  const id = await deliveredOrder();
  const tok = await linkFor(id);
  await submit(ok5(id, tok, 'p-simple', { rating: 5 }));
  assert.deepEqual(await productRating('p-simple'), { avg: 5, count: 1 });
  const id2 = await deliveredOrder();
  await submit(ok5(id2, await linkFor(id2), 'p-simple', { rating: 2 }));
  assert.deepEqual(await productRating('p-simple'), { avg: 3.5, count: 2 });
});

test('RV15 moderation: admin only; flag/hide need a reason; there is no "negative" reason; hide updates the figures', async () => {
  const id = await deliveredOrder();
  const tok = await linkFor(id);
  const low = await submit(ok5(id, tok, 'p-simple', { rating: 1, comment: 'سيئ جدا' }));
  const id2 = await deliveredOrder();
  await submit(ok5(id2, await linkFor(id2), 'p-simple', { rating: 5 }));
  assert.deepEqual(await productRating('p-simple'), { avg: 3, count: 2 });
  const mod = async (body, uid = ADMIN, rid = low.body.reviewId) => callWorker(env(), { method: 'POST', path: `/admin/reviews/${rid}/moderate`, headers: { origin: ORIGIN, ...(uid ? await bearer(uid) : {}) }, body });
  assert.equal((await mod({ action: 'hide', reason: 'abusive' }, null)).status, 401);
  assert.equal((await mod({ action: 'hide', reason: 'abusive' }, ALICE)).status, 403);
  for (const reason of ['negative', 'low_rating', '', undefined]) assert.equal((await mod({ action: 'hide', reason })).body.code, 'INVALID_REASON', String(reason));
  assert.equal((await mod({ action: 'hide', reason: 'other' })).body.code, 'NOTE_REQUIRED');
  assert.equal((await mod({ action: 'delete' })).body.code, 'INVALID_ACTION');
  assert.equal((await getDecoded(`reviews/${low.body.reviewId}`)).status, 'published', 'nothing changed by the refusals');

  const f = await mod({ action: 'flag', reason: 'personal_data', note: 'رقم هاتف؟' });
  assert.equal(f.status, 200, f.text);
  let rv = await getDecoded(`reviews/${low.body.reviewId}`);
  assert.equal(rv.status, 'published', 'a flag keeps it visible until reviewed');
  assert.equal(rv.moderation.flagged, true);
  assert.equal(rv.moderation.reason, 'personal_data');
  const h = await mod({ action: 'hide', reason: 'personal_data' });
  assert.equal(h.status, 200);
  rv = await getDecoded(`reviews/${low.body.reviewId}`);
  assert.equal(rv.status, 'hidden');
  assert.equal(rv.moderation.log.length, 2);
  assert.deepEqual(await productRating('p-simple'), { avg: 5, count: 1 });
  assert.equal((await mod({ action: 'publish' })).status, 200);
  assert.deepEqual(await productRating('p-simple'), { avg: 3, count: 2 });
  assert.equal((await getDecoded(`reviews/${low.body.reviewId}`)).moderation.flagged, false);
  assert.equal((await mod({ action: 'hide', reason: 'spam' }, ADMIN, 'nope')).status, 404);
});

test('RV16 logs carry no token, no phone, no name', async () => {
  const id = await deliveredOrder();
  const r = await makeLink(id);
  const tok = tokenOf(r.body.url);
  await submit(ok5(id, tok, 'p-simple', { name: 'سارة', comment: 'تعليق خاص' }));
  const all = logs.join('\n');
  for (const s of [tok, '0791234567', 'سارة', 'تعليق خاص', 'Test Buyer']) assert.ok(!all.includes(s), `log has no ${s}`);
  assert.match(all, /review\.created/);
});
