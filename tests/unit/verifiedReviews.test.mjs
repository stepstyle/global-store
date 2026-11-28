// Verified-purchase reviews, browser side (src/services/verifiedReviews.ts): the private link's token leaves the
// address bar, requests carry the token OR the ID token (never both), inputs are checked like the Worker does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkReviewInput, loadReviewOrder, submitReview, createReviewLink,
  moderateReview, eligibleOrders, isPublicVerified, waPhone, reviewInviteMessage, reviewErrorAr,
  looksVerifiedOrder, LEGACY_ORDER_NO_LINK_AR,
} from '../../src/services/verifiedReviews.ts';
import { stashReviewToken, reviewTokenFor, forgetReviewToken } from '../../src/services/reviewLink.ts';

const ORDER = 'ORD-A1B2C3D4-MXYZ12';
const TOKEN = 'ABCDEFGHJKMNPQRSTVWXYZ01';
const memStore = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const recorder = (answer = { ok: true }, status = 200) => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: status >= 200 && status < 300, status, json: async () => answer }; };
  return { calls, fetch };
};

test('the link token leaves the address bar at once and is kept for this tab', () => {
  const store = memStore();
  const replaced = [];
  const history = { replaceState: (_d, _u, url) => replaced.push(url) };
  const id = stashReviewToken({ hash: `#/review/${ORDER}/${TOKEN}`, pathname: '/', search: '?utm_source=whatsapp' }, store, history);
  assert.equal(id, ORDER);
  assert.deepEqual(replaced, [`/?utm_source=whatsapp#/review/${ORDER}`], 'address without the token');
  assert.equal(reviewTokenFor(ORDER, store), TOKEN);
  assert.equal(reviewTokenFor(ORDER, null), TOKEN, 'kept in memory too (storage refused)');
  forgetReviewToken(ORDER, store);
  assert.equal(reviewTokenFor(ORDER, store), null);
});

test('other addresses are left alone; a malformed token is never stored; storage errors never throw', () => {
  const store = memStore();
  const history = { replaceState: () => { throw new Error('must not be called'); } };
  for (const hash of ['#/product/p1', `#/review/${ORDER}`, `#/review/${ORDER}/short`, `#/review/../x/${TOKEN}`, `#/review/${ORDER}/${TOKEN.toLowerCase()}`, '']) {
    assert.equal(stashReviewToken({ hash, pathname: '/', search: '' }, store, history), null, hash);
  }
  assert.equal(store.m.size, 0);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
  assert.equal(stashReviewToken({ hash: `#/review/ORD-ZZZZ0000-AAAA/${TOKEN}`, pathname: '/', search: '' }, broken, { replaceState: () => {} }), 'ORD-ZZZZ0000-AAAA');
  assert.equal(reviewTokenFor('ORD-ZZZZ0000-AAAA', broken), TOKEN);
  assert.equal(reviewTokenFor('ORD-NONE0000-AAAA', broken), null);
});

test('input check: 1..5 integer stars, optional comment up to 1000, display name 2..40', () => {
  assert.deepEqual(checkReviewInput({ rating: 5, comment: '', name: 'سارة' }), { ok: true });
  assert.deepEqual(checkReviewInput({ rating: 1, comment: undefined, name: 'Al' }), { ok: true });
  for (const rating of [0, 6, 4.5, '5', null]) assert.equal(checkReviewInput({ rating, comment: '', name: 'سارة' }).field, 'rating');
  assert.equal(checkReviewInput({ rating: 3, comment: 'x'.repeat(1001), name: 'سارة' }).field, 'comment');
  for (const name of ['', ' a ', 'x'.repeat(41)]) assert.equal(checkReviewInput({ rating: 3, comment: '', name }).field, 'name');
});

test('with the link: token in the BODY, no Authorization header, no cookies', async () => {
  const r = recorder({ ok: true, items: [] });
  const idToken = async () => 'ID-TOKEN';
  await loadReviewOrder({ fetch: r.fetch, base: 'https://w.example/', idToken }, ORDER, TOKEN);
  await submitReview({ fetch: r.fetch, base: 'https://w.example', idToken }, { orderId: ORDER, token: TOKEN, productId: 'p1', rating: 4, comment: '  جيد  ', name: '  سارة   م ' });
  assert.equal(r.calls[0].url, 'https://w.example/reviews/state');
  assert.deepEqual(r.calls[0].body, { orderId: ORDER, token: TOKEN });
  assert.equal(r.calls[0].init.headers.authorization, undefined);
  assert.equal(r.calls[0].init.credentials, 'omit');
  assert.deepEqual(r.calls[1].body, { orderId: ORDER, token: TOKEN, productId: 'p1', rating: 4, comment: 'جيد', name: 'سارة م' });
  assert.equal(r.calls[1].init.headers.authorization, undefined);
  assert.ok(!r.calls[0].url.includes(TOKEN) && !r.calls[1].url.includes(TOKEN), 'the token is never in a URL');
});

test('without a token (signed-in owner / admin): the ID token, no token field', async () => {
  const r = recorder({ ok: true, orders: [] });
  const deps = { fetch: r.fetch, base: 'https://w.example', idToken: async () => 'ID-TOKEN' };
  await loadReviewOrder(deps, ORDER, null);
  await eligibleOrders(deps, 'p1');
  await createReviewLink(deps, ORDER, true);
  await moderateReview(deps, 'vr_X', 'hide', 'abusive');
  assert.deepEqual(r.calls.map((c) => [c.url.replace('https://w.example', ''), c.init.headers.authorization]), [
    ['/reviews/state', 'Bearer ID-TOKEN'], ['/reviews/eligible', 'Bearer ID-TOKEN'], [`/admin/orders/${ORDER}/review-link`, 'Bearer ID-TOKEN'], ['/admin/reviews/vr_X/moderate', 'Bearer ID-TOKEN'],
  ]);
  assert.deepEqual(r.calls[0].body, { orderId: ORDER });
  assert.deepEqual(r.calls[2].body, { rotate: true });
  assert.deepEqual(r.calls[3].body, { action: 'hide', reason: 'abusive' });
});

test('failures come back as codes (never a fake success)', async () => {
  const r = recorder({ ok: false, code: 'ALREADY_REVIEWED' }, 409);
  const res = await submitReview({ fetch: r.fetch, base: 'https://w.example' }, { orderId: ORDER, token: TOKEN, productId: 'p1', rating: 5, comment: '', name: 'سارة' });
  assert.deepEqual(res, { ok: false, code: 'ALREADY_REVIEWED', status: 409 });
  const down = await loadReviewOrder({ fetch: async () => { throw new TypeError('offline'); }, base: 'https://w.example' }, ORDER, TOKEN);
  assert.equal(down.code, 'NETWORK');
  const odd = await loadReviewOrder({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ hello: 1 }) }), base: 'https://w.example' }, ORDER, TOKEN);
  assert.equal(odd.ok, false, 'a 200 without ok:true is not a success');
  assert.equal((await loadReviewOrder({ fetch: r.fetch, base: '' }, ORDER, TOKEN)).code, 'NOT_CONFIGURED');
  assert.match(reviewErrorAr('LINK_EXPIRED'), /انتهت/);
  assert.match(reviewErrorAr('whatever'), /تعذّر/);
});

test('public display: published AND verified only', () => {
  assert.equal(isPublicVerified({ status: 'published', verifiedPurchase: true }), true);
  assert.equal(isPublicVerified({ verifiedPurchase: true }), true);
  assert.equal(isPublicVerified({ status: 'hidden', verifiedPurchase: true }), false);
  assert.equal(isPublicVerified({ status: 'published' }), false, 'old browser-written review');
  assert.equal(isPublicVerified({ status: 'published', verifiedPurchase: 'true' }), false);
});

test('manual sending: wa.me phone + message with the link', () => {
  assert.equal(waPhone('0791234567'), '962791234567');
  assert.equal(waPhone('+962 79 123 4567'), '962791234567');
  assert.equal(waPhone('00962791234567'), '962791234567');
  assert.equal(waPhone('123'), null);
  assert.equal(waPhone(undefined), null);
  const m = reviewInviteMessage('https://dairsharaf.com/#/review/X/Y', 'سارة');
  assert.match(m, /مرحباً سارة/);
  assert.ok(m.endsWith('https://dairsharaf.com/#/review/X/Y'));
});

test('screen hint: only an order created AND delivered by the order Worker offers a review (the Worker decides)', () => {
  const w = { source: 'worker-v2', status: 'delivered', inventory: { policy: 'on_delivery', state: 'deducted' } };
  assert.equal(looksVerifiedOrder(w), true);
  assert.equal(looksVerifiedOrder({ ...w, inventory: { policy: 'on_acceptance', state: 'deducted' } }), true);
  assert.equal(looksVerifiedOrder({ ...w, status: 'Delivered' }), true);
  // old browser-written orders, however "delivered" they look
  assert.equal(looksVerifiedOrder({ status: 'delivered', userId: 'guest' }), false, 'no source, no stock record');
  assert.equal(looksVerifiedOrder({ status: 'delivered', source: 'worker-v2' }), false, 'a source a browser could type, no stock record');
  assert.equal(looksVerifiedOrder({ ...w, inventory: { policy: 'on_creation', state: 'deducted' } }), false);
  // a Worker order whose status was typed in (stock still reserved: the Worker never delivered it)
  assert.equal(looksVerifiedOrder({ ...w, inventory: { policy: 'on_delivery', state: 'reserved' } }), false);
  assert.equal(looksVerifiedOrder({ ...w, status: 'shipped' }), false);
  assert.equal(looksVerifiedOrder({ ...w, status: 'cancelled', inventory: { policy: 'on_delivery', state: 'restocked' } }), false);
  for (const x of [null, undefined, 'x', 3, {}]) assert.equal(looksVerifiedOrder(x), false);
});

test('messages for an order the Worker refuses as not verified', () => {
  assert.equal(LEGACY_ORDER_NO_LINK_AR, 'طلب قديم غير موثّق بالنظام، لا يمكن إنشاء رابط تقييم له');
  assert.match(reviewErrorAr('UNVERIFIED_ORDER'), /غير موثّق/);
  assert.match(reviewErrorAr('DELIVERY_NOT_RECORDED'), /لم يُسجَّل تسليم/);
  assert.notEqual(reviewErrorAr('UNVERIFIED_ORDER'), reviewErrorAr('SOMETHING_ELSE'));
});
