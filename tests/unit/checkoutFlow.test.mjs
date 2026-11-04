// Unit tests for src/services/checkoutFlow.ts and src/services/pricePreview.ts — fake fetch, no network.
//   node --test tests/unit/checkoutFlow.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSubmitLock, placeOrder, retrySameOrder, shouldClearCart, messageFor, whatsappUrl,
  confirmedOrders, checkSuccessPage, CONFIRMED_KEY, STORE_WHATSAPP, trackingKeys, TRACKING_KEYS_STORAGE,
} from '../../src/services/checkoutFlow.ts';
import { sessionAttemptStore } from '../../src/services/orderSubmit.ts';
import { previewServerPricing } from '../../src/services/pricePreview.ts';

const W = 'http://127.0.0.1:8787';
const draft = (over = {}) => ({
  userId: 'guest', status: 'new', seenByAdmin: false, createdAt: '2026-11-03T10:00:00.000Z',
  items: [{ productId: 'p-simple', name: 'Notebook', price: 2.5, quantity: 2, selectedVariant: null }],
  subtotal: 5, discountAmount: 0, shippingCost: 3, total: 8, shippingMethodId: 'standard', shippingMethod: 'Standard',
  paymentMethod: 'cod', customerEmail: 'buyer@example.com',
  address: { fullName: 'Test Buyer', city: 'Zarqa', street: 'Main St', phone: '+962791234567' },
  addressMeta: { country: 'Jordan', countryCode: 'JO', citySlug: 'zarqa', ammanAreaId: '' },
  ...over,
});
const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
function fakeFetch(createSteps, statusSteps = []) {
  const calls = [];
  const f = async (url, init = {}) => {
    const isStatus = /\/status$/.test(url);
    calls.push({ url, body: init.body, kind: isStatus ? 'status' : 'create' });
    const list = isStatus ? statusSteps : createSteps;
    const n = calls.filter((c) => c.kind === (isStatus ? 'status' : 'create')).length - 1;
    const step = list[Math.min(n, list.length - 1)];
    if (step === 'network') throw new TypeError('fetch failed');
    if (step === 'hang') return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
    const body = typeof step === 'function' ? step(JSON.parse(init.body || '{}')) : step.body;
    return { status: step.status ?? 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
  };
  f.calls = calls;
  f.creates = () => calls.filter((c) => c.kind === 'create');
  return f;
}
const opts ={ workerUrl: W, timeoutMs: 40, maxAttempts: 2, backoffMs: [1], statusChecks: 1, statusDelayMs: 1 };
const deps = (fetch, extra = {}) => ({ fetch, sleep: async () => {}, ...extra });
const run = (fetch, extra = {}) => {
  const store = sessionAttemptStore(mem());
  return { store, p: (d = draft(), lastPayload = null) => placeOrder({ draft: d, store, opts, deps: deps(fetch, extra), lock: createSubmitLock(), lastPayload }) };
};

// ------------------------------------------------------------------ lock / double click
test('submit lock: a second click while running is ignored (busy), released afterwards', async () => {
  const lock = createSubmitLock();
  const store = sessionAttemptStore(mem());
  let release;
  const gate = new Promise((r) => (release = r));
  const sent = [];
  const slowFetch = async (url, init) => { sent.push(url); await gate; return okFetch()(url, init); };
  const first = placeOrder({ draft: draft(), store, opts, deps: deps(slowFetch), lock });
  const second = await placeOrder({ draft: draft(), store, opts, deps: deps(slowFetch), lock });
  assert.deepEqual(second, { status: 'busy' });
  release();
  assert.equal((await first).status, 'confirmed');
  assert.equal(lock.busy, false);
  assert.equal(sent.length, 1, 'exactly one request for two clicks');
});

// ------------------------------------------------------------------ outcomes -> states, cart rule
const okFetch = (replay = false) => async (u, i) => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ ok: true, orderId: JSON.parse(i.body).order.id, replay }) });

test('confirmed -> clears the cart; every other state keeps it; a malformed 200 is never confirmed', async () => {
  const malformed = await run(fakeFetch([{ status: 200, body: { ok: true } }], [{ status: 404, body: { ok: true, exists: false } }])).p();
  assert.equal(malformed.status, 'not_confirmed');
  assert.equal(shouldClearCart(malformed), false);
  const confirmed = await run(okFetch()).p();
  assert.deepEqual([confirmed.status, confirmed.via], ['confirmed', 'create']);
  assert.equal(shouldClearCart(confirmed), true);
  for (const status of ['not_confirmed', 'blocked_previous', 'conflict', 'rejected', 'rate_limited', 'offline', 'misconfigured', 'busy']) {
    assert.equal(shouldClearCart({ status }), false, status);
  }
});

test('network loss -> not_confirmed with the number and payload kept; retry resends the SAME bytes', async () => {
  const f = fakeFetch(['network'], ['network']);
  const { store, p } = run(f);
  const r1 = await p();
  assert.equal(r1.status, 'not_confirmed');
  assert.ok(r1.payload && r1.payload.id === r1.orderId);
  assert.equal(store.get().state, 'uncertain');
  const sent = [];
  const spy = async (u, i) => { sent.push(i.body); return okFetch(true)(u, i); };
  const r2 = await retrySameOrder({ store, opts, deps: deps(spy), lock: createSubmitLock(), lastPayload: r1.payload });
  assert.deepEqual([r2.status, r2.orderId, r2.replay], ['confirmed', r1.orderId, true]);
  assert.deepEqual(JSON.parse(sent[0]).order, JSON.parse(JSON.stringify(r1.payload)), 'byte-identical order');
});

test('changed form after an uncertain attempt -> blocked_previous (no new number, no second order)', async () => {
  const { p } = run(fakeFetch(['network'], ['network']));
  const r1 = await p();
  const r2 = await p(draft({ address: { ...draft().address, street: 'Other St' } }));
  assert.deepEqual(r2, { status: 'blocked_previous', orderId: r1.orderId });
  const r3 = await p(draft({ createdAt: 'rebuilt later' })); // same content -> same number again
  assert.equal(r3.orderId, r1.orderId);
});

test('timeout after the Worker saved it -> status exists -> verified resend -> confirmed', async () => {
  let n = 0;
  const f = async (u, i) => {
    if (/status$/.test(u)) return { status: 200, headers: { get: () => null }, text: async () => '{"ok":true,"exists":true,"status":"new"}' };
    n++;
    if (n <= 2) return new Promise((_, rej) => i.signal?.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ ok: true, orderId: JSON.parse(i.body).order.id, replay: true }) };
  };
  const r = await run(f).p();
  assert.deepEqual([r.status, r.via, r.replay], ['confirmed', 'verify', true]);
});

test('403 / 409 / 429 / 503 / offline / misconfigured map to their states', async () => {
  assert.equal((await run(fakeFetch([{ status: 403, body: { ok: false, code: 'TURNSTILE_FAILED' } }])).p()).status, 'rejected');
  const c = await run(fakeFetch([{ status: 409, body: { ok: false, code: 'ORDER_ID_CONFLICT' } }], [{ status: 200, body: { ok: true, exists: true } }])).p();
  assert.deepEqual([c.status, c.code], ['conflict', 'ORDER_ID_CONFLICT']);
  assert.equal((await run(fakeFetch([{ status: 429, body: { ok: false, code: 'RATE_LIMITED' } }])).p()).status, 'rate_limited');
  const s503 = await run(fakeFetch([{ status: 503, body: { ok: false, code: 'RETRY_LATER' } }], [{ status: 404, body: { ok: true, exists: false } }])).p();
  assert.deepEqual([s503.status, s503.reason], ['not_confirmed', 'RETRY_LATER']);
  assert.equal((await run(fakeFetch([]), { isOnline: () => false }).p()).status, 'offline');
  const store = sessionAttemptStore(mem());
  const m = await placeOrder({ draft: draft(), store, opts: { ...opts, workerUrl: '' }, deps: deps(fakeFetch([])), lock: createSubmitLock() });
  assert.equal(m.status, 'misconfigured');
});

// ------------------------------------------------------------------ messages / WhatsApp
test('every non-confirmed state has a clear Arabic message; order number shown only when it matters', () => {
  const cases = {
    not_confirmed: [true, ['retry_same', 'whatsapp']], blocked_previous: [true, ['whatsapp']], conflict: [true, ['whatsapp']],
    rejected: [false, ['fix_form']], rate_limited: [false, ['wait_retry']], offline: [false, ['check_connection']], misconfigured: [false, ['whatsapp']],
  };
  for (const [status, [showId, actions]] of Object.entries(cases)) {
    const m = messageFor({ status, orderId: 'ORD-ABCD1234-XYZ1', code: 'INVALID_ORDER', field: 'address.phone' });
    assert.ok(m && /[؀-ۿ]/.test(m.titleAr) && /[؀-ۿ]/.test(m.bodyAr), status);
    assert.equal(m.showOrderId, showId, status);
    assert.deepEqual(m.actions, actions, status);
    assert.equal(/تم (تأكيد|استلام) طلبك/.test(m.titleAr + m.bodyAr), false, `${status}: never a success text`);
  }
  assert.match(messageFor({ status: 'rejected', code: 'INVALID_ORDER', field: 'address.phone' }).bodyAr, /رقم الهاتف/);
  assert.match(messageFor({ status: 'rejected', code: 'TURNSTILE_FAILED' }).titleAr, /التحقق الأمني/);
  assert.equal(messageFor({ status: 'confirmed' }), null);
});

test('WhatsApp link: shop number + order number (+ CliQ ref / name only for the receipt), no phone/address', () => {
  const u = whatsappUrl(STORE_WHATSAPP, 'ORD-ABCD1234-XYZ1', { kind: 'unconfirmed' });
  assert.ok(u.startsWith(`https://wa.me/${STORE_WHATSAPP}?text=`));
  const text = decodeURIComponent(u.split('text=')[1]);
  assert.match(text, /ORD-ABCD1234-XYZ1/);
  assert.equal(/\+962|Main St|Zarqa/.test(text), false);
  const c = decodeURIComponent(whatsappUrl(STORE_WHATSAPP, 'ORD-ABCD1234-XYZ1', { kind: 'cliq_receipt', cliqReference: 'REF-1', customerName: 'Test Buyer' }).split('text=')[1]);
  assert.match(c, /REF-1/);
  assert.match(c, /Test Buyer/);
});

// ------------------------------------------------------------------ success page
test('success page: confirmed ONLY with a tab-recorded Worker confirmation AND status exists now', async () => {
  const s = mem();
  const conf = confirmedOrders(s);
  const id = 'ORD-ABCD1234-XYZ1';
  const st = (resp) => ({ fetch: async () => (resp === 'network' ? Promise.reject(new TypeError('x')) : { status: resp.status, headers: { get: () => null }, text: async () => JSON.stringify(resp.body) }) });
  const EX = { status: 200, body: { ok: true, exists: true, status: 'new' } };
  const NO = { status: 404, body: { ok: true, exists: false } };
  assert.equal(await checkSuccessPage(id, conf, opts, st(EX)), 'exists_unverified', 'navigation state / cache alone is not enough');
  conf.add(id);
  assert.equal(await checkSuccessPage(id, conf, opts, st(EX)), 'confirmed');
  assert.equal(await checkSuccessPage(id, conf, opts, st(NO)), 'not_found', 'recorded locally but the Worker does not know it');
  assert.equal(await checkSuccessPage(id, conf, opts, st('network')), 'unknown', 'Worker unreachable: nothing claimed');
  assert.equal(await checkSuccessPage('../x', conf, opts, st(EX)), 'invalid');
  assert.deepEqual(JSON.parse(s.getItem(CONFIRMED_KEY)), [id], 'only order numbers are stored');
  s.setItem(CONFIRMED_KEY, '["<script>","ORD-ZZZZ9999-YYYY"]');
  assert.equal(confirmedOrders(s).has('<script>'), false);
});

// ------------------------------------------------------------------ price preview (Worker's own pricing code)
const products = [
  { id: 'p-simple', name: 'Notebook', price: 2.5, stock: 10 },
  { id: 'p-variants', name: 'Pen', price: 0, stock: 0, variants: [{ id: 'var_red', label: 'Red', price: 3.2, stock: 5 }] },
];
test('price preview: no difference when page prices equal the Worker computation', () => {
  const p = previewServerPricing(draft(), products);
  assert.equal(p.ok, true);
  assert.deepEqual(p.diffs, []);
  assert.equal(p.server.total, 8);
});

test('price preview: stale page price -> subtotal/total differences and the per-line prices', () => {
  const d = draft({ items: [{ productId: 'p-simple', name: 'Notebook', price: 2, quantity: 2 }], subtotal: 4, total: 7 });
  const p = previewServerPricing(d, products);
  assert.deepEqual(p.diffs.sort(), ['subtotal', 'total']);
  assert.deepEqual(p.lines[0], { index: 0, productId: 'p-simple', serverUnitPrice: 2.5, clientUnitPrice: 2 });
  assert.equal(p.server.total, 8);
});

test('price preview: variant price, volume discount and Amman fast shipping as the Worker computes them', () => {
  const d = draft({
    items: [{ productId: 'p-variants', name: 'Pen', price: 3.2, quantity: 3, selectedVariant: { id: 'var_red', label: 'Red' } }],
    subtotal: 9.6, discountAmount: 0.96, shippingCost: 2, total: 10.64, shippingMethodId: 'fast',
    addressMeta: { citySlug: 'amman', ammanAreaId: 'a1' },
  });
  const p = previewServerPricing(d, products);
  assert.deepEqual(p.diffs, []);
  assert.deepEqual([p.server.discount, p.server.shipping, p.server.total], [0.96, 2, 10.64]);
});

test('price preview: unknown product -> incomplete (shown as "could not be checked")', () => {
  const p = previewServerPricing(draft({ items: [{ productId: 'gone', name: 'x', price: 1, quantity: 1 }], subtotal: 1, total: 4 }), products);
  assert.ok(p.diffs.includes('incomplete'));
});

test('price preview: invalid form (e.g. bad phone) -> not ok, no banner', () => {
  assert.equal(previewServerPricing(draft({ address: { ...draft().address, phone: '123' } }), products).ok, false);
});

// ------------------------------------------------------------------ signed-in customers (Firebase ID token)
test('auth: signed-in checkout without a usable token -> auth_required, cart KEPT, same number on "retry same" -> confirmed', async () => {
  const UID = 'aliceUid000000000000000000A1';
  const store = sessionAttemptStore(mem());
  const lock = createSubmitLock();
  const d = draft({ userId: UID });
  let token = null; // signed out / session expired
  const getAuthToken = async () => token;
  const seen = [];
  const f = async (u, i) => {
    seen.push(i.headers?.authorization || null);
    return okFetch()(u, i);
  };
  const first = await placeOrder({ draft: d, store, opts: { ...opts, getAuthToken }, deps: deps(f), lock });
  assert.equal(first.status, 'auth_required');
  assert.equal(shouldClearCart(first), false, 'cart kept');
  assert.equal(seen.length, 0, 'nothing sent without the token (never as guest)');
  const m = messageFor(first);
  assert.ok(m.actions.includes('retry_same'));
  assert.equal(m.showOrderId, true);
  assert.match(m.bodyAr, /سجّل الدخول/);
  // signs in again -> "retry with the same number" resends the exact payload
  token = 'fresh-token';
  const second = await retrySameOrder({ store, opts: { ...opts, getAuthToken }, deps: deps(f), lock, lastPayload: first.payload });
  assert.equal(second.status, 'confirmed');
  assert.equal(second.orderId, first.orderId, 'same order number');
  assert.deepEqual(seen, ['Bearer fresh-token']);
});

test('auth: USERID_MISMATCH has its own clear message (no order created)', () => {
  const m = messageFor({ status: 'rejected', orderId: 'ORD-AAAA1111-BBBB', code: 'USERID_MISMATCH' });
  assert.equal(m.tone, 'error');
  assert.match(m.bodyAr, /الحساب/);
});

// ------------------------------------------------------------------ tracking key in the checkout flow
test('tracking key: kept on this device ONLY after a confirmed order; the same hash is sent on "retry same"', async () => {
  const kv = mem();
  const keys = trackingKeys(kv);
  const store = sessionAttemptStore(mem());
  const lock = createSubmitLock();
  const sent = [];
  let fail = true;
  const f = async (u, i) => {
    const b = JSON.parse(i.body);
    sent.push(b.trackingKeyHash);
    if (fail) throw new TypeError('network down');
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ ok: true, orderId: b.order.id, replay: false }) };
  };
  const first = await placeOrder({ draft: draft(), store, opts: { ...opts, maxAttempts: 1, statusChecks: 1 }, deps: deps(f, { fetch: async (u, i) => (/status$/.test(u) ? { status: 404, headers: { get: () => null }, text: async () => '{"ok":true,"exists":false}' } : f(u, i)) }), lock, trackingKeys: keys });
  assert.equal(first.status, 'not_confirmed');
  assert.equal(keys.get(first.orderId), null, 'nothing kept before a confirmation');
  fail = false;
  const second = await retrySameOrder({ store, opts, deps: deps(f), lock, lastPayload: first.payload, trackingKeys: keys });
  assert.equal(second.status, 'confirmed');
  assert.equal(second.orderId, first.orderId);
  assert.ok(sent.length >= 2 && sent.every((h) => /^[a-f0-9]{64}$/.test(h) && h === sent[0]), 'same hash on every send');
  const kept = keys.get(first.orderId);
  assert.match(kept, /^[0-9A-HJKMNP-TV-Z]{24}$/);
  assert.equal(JSON.stringify(first.payload).includes(kept), false, 'the key is not in the order payload');
});

test('trackingKeys store: validated entries only, newest first, max 30', () => {
  const kv = mem();
  const keys = trackingKeys(kv);
  keys.add('ORD-AAAA1111-BBBB', '7k3m-9p2q-4r6t-8v0w-1x5y-7z9a');
  assert.equal(keys.get('ORD-AAAA1111-BBBB'), '7K3M9P2Q4R6T8V0W1X5Y7Z9A');
  keys.add('bad-id', '7K3M9P2Q4R6T8V0W1X5Y7Z9A');
  keys.add('ORD-CCCC2222-DDDD', 'not a key');
  assert.equal(JSON.parse(kv.getItem(TRACKING_KEYS_STORAGE)).length, 1);
  for (let i = 0; i < 40; i++) keys.add(`ORD-AAAA${String(1000 + i)}-BBBB`, '7K3M9P2Q4R6T8V0W1X5Y7Z9A');
  assert.equal(JSON.parse(kv.getItem(TRACKING_KEYS_STORAGE)).length, 30);
  kv.setItem(TRACKING_KEYS_STORAGE, '{broken');
  assert.equal(keys.get('ORD-AAAA1111-BBBB'), null);
});
