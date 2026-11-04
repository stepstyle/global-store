// Unit tests for src/services/orderSubmit.ts — fake fetch, fake sleep, no network.
//   node --test tests/unit/orderSubmit.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  submitOrder, checkOrderStatus, newOrderId, normalizeWorkerUrl, ORDER_ID_RE, identityHash, attemptKey,
  prepareAttempt, recordOutcome, resolvePreviousAttempt, abandonPreviousAttempt, sessionAttemptStore, ATTEMPT_STORAGE_KEY, SETTLE_MS,
  submitPrepared, mayHaveBeenSaved, localAttemptStore, resolvePendingAttempts, ATTEMPTS_V2_KEY, openAttempts, recordFor,
  newTrackingKey, normalizeTrackingKey, formatTrackingKey, trackingKeyHash, TRACKING_KEY_RE, fetchOrderSummary, fetchOrderStatus,
} from '../../src/services/orderSubmit.ts';
import { validateOrderInput, orderHash } from '../../workers/order-worker/src/validate.js';

const W = 'http://127.0.0.1:8787';
const ID = 'ORD-ABCD1234-MXYZ01';
const order = (over = {}) => ({
  id: ID, userId: 'guest', status: 'new',
  items: [{ productId: 'p-simple', name: 'Notebook', price: 2.5, quantity: 2, selectedVariant: null }, { productId: 'p-variants', name: 'Pen - Red', price: 3.2, quantity: 1, selectedVariant: { id: 'var_red', label: 'Red' } }],
  subtotal: 8.2, discountAmount: 0, shippingCost: 0, total: 8.2, paymentMethod: 'cod', shippingMethodId: 'standard', shippingMethod: 'Standard',
  customerEmail: 'buyer@example.com', consents: { acceptedStorePolicies: true, acceptedDeliveryPolicy: true },
  address: { fullName: 'Test Buyer', city: 'Amman', street: 'Rainbow St', phone: '+962791234567' },
  addressMeta: { country: 'Jordan', countryCode: 'JO', citySlug: 'amman', ammanAreaId: 'a1', phoneDial: '+962', phoneLocal: '791234567' },
  createdAt: '2026-11-03T10:00:00.000Z', createdAtMs: 1, updatedAt: '2026-11-03T10:00:00.000Z', date: '2026-11-03', note: 'ring twice', ...over,
});

/** Scripted fetch. Steps: {status, body, headers} | 'network' | 'hang' | 'text:<raw>'; separate script for status calls. */
function fakeFetch(createSteps, statusSteps = []) {
  const calls = [];
  const f = async (url, init = {}) => {
    const isStatus = /\/orders\/[^/]+\/status$/.test(url);
    calls.push({ url, method: init.method, body: init.body, kind: isStatus ? 'status' : 'create' });
    const list = isStatus ? statusSteps : createSteps;
    const n = calls.filter((c) => c.kind === (isStatus ? 'status' : 'create')).length - 1;
    const step = list[Math.min(n, list.length - 1)];
    if (step === undefined) throw new Error(`no scripted ${isStatus ? 'status' : 'create'} response #${n}`);
    if (step === 'network') throw new TypeError('fetch failed');
    if (step === 'hang') return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    if (typeof step === 'string' && step.startsWith('text:')) return { status: 200, headers: { get: () => null }, text: async () => step.slice(5) };
    const h = Object.fromEntries(Object.entries(step.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { status: step.status, headers: { get: (n) => h[n.toLowerCase()] ?? null }, text: async () => JSON.stringify(step.body ?? {}) };
  };
  f.calls = calls;
  f.creates = () => calls.filter((c) => c.kind === 'create');
  f.statuses = () => calls.filter((c) => c.kind === 'status');
  return f;
}
const deps = (fetch, extra = {}) => {
  const waits = [];
  return { fetch, sleep: async (ms) => { waits.push(ms); }, waits, ...extra };
};
const opts = (over = {}) => ({ workerUrl: W, timeoutMs: 40, maxAttempts: 3, backoffMs: [1000, 3000], statusChecks: 2, statusDelayMs: 2000, ...over });
const OK = (replay = false, id = ID) => ({ status: 200, body: { ok: true, orderId: id, replay } });
const EXISTS = { status: 200, body: { ok: true, exists: true, status: 'new' } };
const MISSING = { status: 404, body: { ok: true, exists: false } };
const E403 = { status: 403, body: { ok: false, code: 'TURNSTILE_FAILED' } };
const E400 = { status: 400, body: { ok: false, code: 'INVALID_ORDER', field: 'items' } };
const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

// ================================================================== 1. identityHash == Worker orderHash
test('identityHash is byte-identical to the Worker orderHash (parity over 24 variants)', async () => {
  const variants = {
    base: (o) => o,
    'no shippingMethodId (Worker -> standard)': (o) => { delete o.shippingMethodId; },
    'empty shippingMethodId': (o) => { o.shippingMethodId = ''; },
    'fast shipping': (o) => { o.shippingMethodId = 'fast'; },
    'item.id instead of productId': (o) => { o.items[0] = { id: 'p-simple', quantity: 2 }; },
    'item.variantId field ignored by Worker': (o) => { o.items[1] = { ...o.items[1], variantId: 'var_blue' }; },
    'selectedVariant id empty string': (o) => { o.items[1].selectedVariant = { id: '', label: 'Red' }; },
    'selectedVariant without id': (o) => { o.items[1].selectedVariant = { label: 'Red' }; },
    'no selectedVariant key': (o) => { delete o.items[0].selectedVariant; },
    'no addressMeta': (o) => { delete o.addressMeta; },
    'addressMeta without area': (o) => { delete o.addressMeta.ammanAreaId; },
    'logged-in user': (o) => { o.userId = 'uid_ABC-123'; },
    cliq: (o) => { o.paymentMethod = 'cliq'; o.paymentDetails = { cliqReference: 'R1' }; },
    'float total 0.1+0.2': (o) => { o.total = 0.1 + 0.2; },
    'total 8.2049': (o) => { o.total = 8.2049; },
    'total 8.2051': (o) => { o.total = 8.2051; },
    'quantity 99': (o) => { o.items[0].quantity = 99; },
    'one item': (o) => { o.items = [o.items[0]]; },
    'arabic product id': (o) => { o.items[0].productId = 'CSV 001 دفتر'; },
    'other phone': (o) => { o.address.phone = '+962771111111'; },
    'other city': (o) => { o.addressMeta.citySlug = 'irbid'; delete o.addressMeta.ammanAreaId; },
    'other name/street/note (not identity)': (o) => { o.address.fullName = 'X'; o.address.street = 'Y'; o.note = 'Z'; },
    'other id': (o) => { o.id = 'ORD-ZZZZ9999-ABCDEF'; },
    'extra unknown fields': (o) => { o.hacked = true; o.status = 'delivered'; },
  };
  for (const [name, f] of Object.entries(variants)) {
    const o = order();
    f(o);
    const parsed = validateOrderInput(o);
    assert.ok(parsed.ok, `${name}: payload valid for the Worker (${parsed.field})`);
    assert.equal(await identityHash(o), await orderHash(parsed.value), name);
  }
});

// ================================================================== 2. attemptKey: every content change counts, no PII stored
test('attemptKey changes with ANY content (name, street, city, e-mail, note, CliQ reference, prices …)', async () => {
  const k = await attemptKey(order());
  const changes = {
    fullName: (o) => { o.address.fullName = 'Other Name'; },
    street: (o) => { o.address.street = 'Other St'; },
    'city text': (o) => { o.address.city = 'Zarqa'; },
    email: (o) => { o.customerEmail = 'other@example.com'; },
    note: (o) => { o.note = 'leave at door'; },
    'cliq reference': (o) => { o.paymentMethod = 'cliq'; o.paymentDetails = { cliqReference: 'R2' }; },
    phone: (o) => { o.address.phone = '+962790000000'; },
    'item price': (o) => { o.items[0].price = 3; },
    'variant label': (o) => { o.items[1].selectedVariant.label = 'Blue'; },
    'shipping method': (o) => { o.shippingMethodId = 'fast'; },
    consents: (o) => { o.consents.acceptedDeliveryPolicy = false; },
    'phoneLocal meta': (o) => { o.addressMeta.phoneLocal = '790000000'; },
  };
  for (const [name, f] of Object.entries(changes)) {
    const o = order();
    f(o);
    assert.notEqual(await attemptKey(o), k, name);
  }
  const c1 = order({ paymentMethod: 'cliq', paymentDetails: { cliqReference: 'R1' } });
  const c2 = order({ paymentMethod: 'cliq', paymentDetails: { cliqReference: 'R2' } });
  assert.notEqual(await attemptKey(c1), await attemptKey(c2), 'CliQ reference R1 -> R2');
});

test('attemptKey ignores only volatile fields (id, status, timestamps, date, seenByAdmin, images)', async () => {
  const k = await attemptKey(order());
  const o = order({ id: 'ORD-OTHER999-XXXXXX', status: 'x', seenByAdmin: true, createdAt: 'later', createdAtMs: 99, updatedAt: 'later', date: '2027-01-01' });
  o.items[0].image = 'https://cdn.example/new.png';
  assert.equal(await attemptKey(o), k);
  assert.equal(await attemptKey(order({ note: '  ring twice  ' })), k, 'surrounding whitespace');
});

// ================================================================== success / replay / retries
test('success: confirmed only on a well-formed 200 for this order id (via create)', async () => {
  const f = fakeFetch([OK(false)]);
  assert.deepEqual(await submitOrder(order(), opts(), deps(f)), { kind: 'confirmed', orderId: ID, replay: false, via: 'create', attempts: 1 });
  assert.equal(f.creates()[0].url, `${W}/create-order`);
});

test('network error / timeout then success: same id, byte-identical payload', async () => {
  for (const first of ['network', 'hang']) {
    const f = fakeFetch([first, OK(first === 'hang')]);
    const r = await submitOrder(order(), opts(), deps(f));
    assert.equal(r.kind, 'confirmed');
    assert.equal(f.creates()[0].body, f.creates()[1].body);
  }
});

test('payload is frozen: changing the caller object after the call cannot leak into retries', async () => {
  const o = order();
  const f = fakeFetch(['network', OK(false)]);
  const p = submitOrder(o, opts(), { fetch: f, sleep: async () => { o.address.street = 'CHANGED'; } });
  await p;
  assert.equal(JSON.parse(f.creates()[1].body).order.address.street, 'Rainbow St');
});

test('concurrent double submit sends the same id twice (Worker dedupes)', async () => {
  const f = fakeFetch([OK(false), OK(true)]);
  const rs = await Promise.all([submitOrder(order(), opts(), deps(f)), submitOrder(order(), opts(), deps(f))]);
  assert.deepEqual(rs.map((r) => r.kind), ['confirmed', 'confirmed']);
});

// ================================================================== uncertain: status is never enough
test('all attempts time out + status exists + verification resend replays -> confirmed via verify', async () => {
  const f = fakeFetch(['hang', 'hang', 'hang', OK(true)], [EXISTS]);
  const r = await submitOrder(order(), opts(), deps(f));
  assert.deepEqual(r, { kind: 'confirmed', orderId: ID, replay: true, via: 'verify', attempts: 4 });
});

test('status exists but the verification resend cannot get through -> not_confirmed (unverified), NEVER confirmed', async () => {
  const f = fakeFetch(['hang'], [EXISTS]);
  const r = await submitOrder(order(), opts(), deps(f));
  assert.deepEqual([r.kind, r.reason, r.existsOnServer], ['not_confirmed', 'unverified', true]);
});

test('status exists, verification resend answers 409 (different content under this number) -> conflict', async () => {
  const f = fakeFetch(['hang', 'hang', 'hang', { status: 409, body: { ok: false, code: 'ORDER_ID_CONFLICT' } }], [EXISTS]);
  const r = await submitOrder(order(), opts(), deps(f));
  assert.deepEqual([r.kind, r.code, r.existsOnServer], ['conflict', 'ORDER_ID_CONFLICT', true]);
});

test('status exists but resend gets 500 / malformed -> not_confirmed (unverified)', async () => {
  for (const v of [{ status: 500, body: { ok: false, code: 'INTERNAL' } }, OK(false, 'ORD-OTHER999-XXXXXX'), 'text:ok']) {
    const r = await submitOrder(order(), opts(), deps(fakeFetch(['hang', 'hang', 'hang', v], [EXISTS])));
    assert.deepEqual([r.kind, r.reason], ['not_confirmed', 'unverified'], JSON.stringify(v));
  }
});

test('404 twice is NOT proof of failure: not_confirmed, existsOnServer false, same number', async () => {
  const f = fakeFetch(['network'], [MISSING]);
  const r = await submitOrder(order(), opts(), deps(f));
  assert.deepEqual(r, { kind: 'not_confirmed', orderId: ID, reason: 'network', existsOnServer: false, attempts: 3 });
});

test('404 then unknown -> existsOnServer null (not "missing")', async () => {
  const r = await submitOrder(order(), opts(), deps(fakeFetch(['network'], [MISSING, 'network'])));
  assert.equal(r.existsOnServer, null);
});

test('malformed 200 (other id / ok missing / replay missing / not JSON) never counts as success', async () => {
  for (const bad of [OK(false, 'ORD-OTHER123-XYZ123'), { status: 200, body: { orderId: ID, replay: false } }, { status: 200, body: { ok: true, orderId: ID } }, 'text:<html>ok</html>']) {
    const r = await submitOrder(order(), opts({ maxAttempts: 2 }), deps(fakeFetch([bad], [MISSING])));
    assert.deepEqual([r.kind, r.reason], ['not_confirmed', 'malformed'], JSON.stringify(bad));
  }
});

// ================================================================== Turnstile token consumed / timeout then 4xx
test('timeout, then 403 (single-use token consumed), status unavailable -> not_confirmed, NOT rejected', async () => {
  const f = fakeFetch(['hang', E403], ['hang']);
  const r = await submitOrder(order(), opts(), deps(f));
  assert.deepEqual([r.kind, r.lastCode, r.existsOnServer], ['not_confirmed', 'TURNSTILE_FAILED', null]);
  assert.equal(f.creates().length, 2, 'stopped retrying after the 403');
});

test('timeout, then 400, status says missing twice -> still not_confirmed (the first may be in flight)', async () => {
  const r = await submitOrder(order(), opts(), deps(fakeFetch(['hang', E400], [MISSING])));
  assert.deepEqual([r.kind, r.lastCode, r.existsOnServer], ['not_confirmed', 'INVALID_ORDER', false]);
});

test('timeout, then 403, status exists, verification with a FRESH token replays -> confirmed via verify', async () => {
  const tokens = [];
  let n = 0;
  const getTurnstileToken = async () => { const t = `tok-${++n}`; tokens.push(t); return t; };
  const f = fakeFetch(['hang', E403, OK(true)], [EXISTS]);
  const r = await submitOrder(order(), opts({ getTurnstileToken }), deps(f));
  assert.deepEqual([r.kind, r.via, r.replay], ['confirmed', 'verify', true]);
  assert.deepEqual(f.creates().map((c) => JSON.parse(c.body).turnstileToken), ['tok-1', 'tok-2', 'tok-3'], 'a fresh token for every send');
});

test('the record is NOT cleared after timeout + 403/400 (number kept for a safe retry)', async () => {
  for (const second of [E403, E400]) {
    const store = sessionAttemptStore(memStorage());
    const p = await prepareAttempt(order(), store);
    const r = await submitOrder({ ...order(), id: p.orderId }, opts(), deps(fakeFetch(['hang', second], ['hang'])));
    recordOutcome(store, p, r);
    assert.equal(store.get()?.state, 'uncertain', JSON.stringify(second));
    assert.equal(store.get()?.orderId, p.orderId);
  }
});

test('403 / 400 / 413 on a FIRST attempt (nothing could have been saved) -> rejected, record cleared', async () => {
  for (const e of [E403, E400, { status: 413, body: { ok: false, code: 'PAYLOAD_TOO_LARGE' } }]) {
    const f = fakeFetch([e]);
    const r = await submitOrder(order(), opts(), deps(f));
    assert.equal(r.kind, 'rejected');
    assert.equal(f.creates().length, 1);
    const store = sessionAttemptStore(memStorage());
    const p = await prepareAttempt(order(), store);
    recordOutcome(store, p, r);
    assert.equal(store.get(), null);
  }
});

// ================================================================== 409 / 429 / 5xx
test('409 ORDER_ID_CONFLICT / ORDER_EXISTS -> conflict, no retry, no new number', async () => {
  for (const code of ['ORDER_ID_CONFLICT', 'ORDER_EXISTS']) {
    const f = fakeFetch([{ status: 409, body: { ok: false, code } }], [EXISTS]);
    const r = await submitOrder(order(), opts(), deps(f));
    assert.deepEqual(r, { kind: 'conflict', orderId: ID, code, existsOnServer: true, attempts: 1 });
  }
});

test('429 with Retry-After -> waits (capped) then succeeds; 429 every time -> rate_limited without status checks', async () => {
  const d = deps(fakeFetch([{ status: 429, body: {}, headers: { 'Retry-After': '2' } }, OK(false)]));
  assert.equal((await submitOrder(order(), opts(), d)).kind, 'confirmed');
  assert.deepEqual(d.waits, [2000]);
  const d2 = deps(fakeFetch([{ status: 429, body: {}, headers: { 'Retry-After': '120' } }, OK(false)]));
  await submitOrder(order(), opts({ maxRetryAfterMs: 10_000 }), d2);
  assert.deepEqual(d2.waits, [10_000]);
  const f = fakeFetch([{ status: 429, body: { ok: false, code: 'RATE_LIMITED' } }]);
  const r = await submitOrder(order(), opts(), deps(f));
  assert.equal(r.kind, 'rate_limited');
  assert.equal(f.statuses().length, 0);
});

test('503 RETRY_LATER is retried with the same number and is NOT treated as "nothing saved"', async () => {
  assert.equal((await submitOrder(order(), opts(), deps(fakeFetch([{ status: 503, body: { ok: false, code: 'RETRY_LATER' } }, OK(true)])))).kind, 'confirmed');
  const r = await submitOrder(order(), opts(), deps(fakeFetch([{ status: 503, body: { ok: false, code: 'RETRY_LATER' } }], [MISSING])));
  assert.deepEqual([r.kind, r.reason, r.lastCode], ['not_confirmed', 'server', 'RETRY_LATER']);
});

// ================================================================== offline / misconfiguration / status helper
test('offline before sending -> offline, nothing sent; going offline mid-way stops retries, stays not_confirmed', async () => {
  const f = fakeFetch([OK(false)]);
  assert.deepEqual(await submitOrder(order(), opts(), deps(f, { isOnline: () => false })), { kind: 'offline', orderId: ID, attempts: 0 });
  assert.equal(f.calls.length, 0);
  let online = true;
  const g = fakeFetch([{ status: 500, body: {} }], [MISSING]);
  const orig = g.calls.push.bind(g.calls);
  g.calls.push = (...a) => { online = false; return orig(...a); };
  const r = await submitOrder(order(), opts(), deps(g, { isOnline: () => online }));
  assert.equal(r.kind, 'not_confirmed');
  assert.equal(g.creates().length, 1);
});

test('misconfigured: missing / non-http Worker URL or invalid order id -> nothing sent', async () => {
  for (const workerUrl of ['', '   ', 'ftp://x', 'not a url', 'https://u:p@x.example', 'https://x.example/?a=1']) {
    const f = fakeFetch([OK(false)]);
    assert.equal((await submitOrder(order(), opts({ workerUrl }), deps(f))).kind, 'misconfigured', workerUrl);
    assert.equal(f.calls.length, 0);
  }
  assert.equal((await submitOrder(order({ id: 'ORD-1' }), opts(), deps(fakeFetch([OK()])))).kind, 'misconfigured');
  assert.equal(normalizeWorkerUrl('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
});

test('checkOrderStatus: exists / missing / unknown', async () => {
  assert.equal(await checkOrderStatus(ID, opts(), deps(fakeFetch([], [EXISTS]))), true);
  assert.equal(await checkOrderStatus(ID, opts(), deps(fakeFetch([], [MISSING]))), false);
  assert.equal(await checkOrderStatus(ID, opts(), deps(fakeFetch([], [{ status: 500, body: {} }]))), null);
  assert.equal(await checkOrderStatus('bad', opts(), deps(fakeFetch([], [EXISTS]))), null);
});

// ================================================================== attempt store: same number, address change, settle window
test('newOrderId: Worker format for any clock value, unique', () => {
  const ids = new Set(Array.from({ length: 2000 }, () => newOrderId()));
  assert.equal(ids.size, 2000);
  for (const id of ids) assert.match(id, ORDER_ID_RE);
  for (const t of [0, 1, 1000, 46655, Date.now(), Number.MAX_SAFE_INTEGER, -5, 1.5]) assert.match(newOrderId(t), ORDER_ID_RE, String(t));
});

test('same content -> same number across retries and reloads; new number only after confirmation', async () => {
  const s = memStorage();
  const a = await prepareAttempt(order(), sessionAttemptStore(s));
  const b = await prepareAttempt(order({ createdAt: 'later', updatedAt: 'later' }), sessionAttemptStore(s));
  assert.deepEqual([b.ok, b.reused, b.orderId], [true, true, a.orderId]);
  recordOutcome(sessionAttemptStore(s), a, { kind: 'confirmed', orderId: a.orderId, replay: false, via: 'create', attempts: 1 });
  const c = await prepareAttempt(order(), sessionAttemptStore(s));
  assert.ok(c.ok && !c.reused && c.orderId !== a.orderId);
});

test('ADDRESS / NAME / NOTE / CLIQ change after an uncertain attempt -> refused (no reuse of the number with other data, no new number)', async () => {
  const edits = {
    street: { address: { ...order().address, street: 'Corrected St' } },
    name: { address: { ...order().address, fullName: 'Corrected Name' } },
    city: { address: { ...order().address, city: 'Zarqa' } },
    note: { note: 'corrected note' },
    email: { customerEmail: 'corrected@example.com' },
    cliq: { paymentMethod: 'cliq', paymentDetails: { cliqReference: 'CORRECTED' } },
  };
  for (const [name, patch] of Object.entries(edits)) {
    const store = sessionAttemptStore(memStorage());
    const a = await prepareAttempt(order(), store);
    recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 });
    const b = await prepareAttempt(order(patch), store);
    assert.deepEqual(b, { ok: false, reason: 'previous_unresolved', previousOrderId: a.orderId, openOrderIds: [a.orderId] }, name);
    assert.equal(store.get().orderId, a.orderId, `${name}: earlier number kept`);
  }
});

test('a "pending" attempt (prepared, maybe sent before a reload) also blocks a different order', async () => {
  const store = sessionAttemptStore(memStorage());
  const a = await prepareAttempt(order(), store);
  const b = await prepareAttempt(order({ note: 'changed' }), store);
  assert.deepEqual(b, { ok: false, reason: 'previous_unresolved', previousOrderId: a.orderId, openOrderIds: [a.orderId] });
});

test('session storage holds only {orderId, key, state, updatedAt, lastSentAt, trackingKey, who} — no personal data', async () => {
  const s = memStorage();
  const store = sessionAttemptStore(s);
  const a = await prepareAttempt(order({ paymentMethod: 'cliq', paymentDetails: { cliqReference: 'CLIQ-REF-777' } }), store);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 2 });
  const raw = s.getItem(ATTEMPT_STORAGE_KEY);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['key', 'lastSentAt', 'orderId', 'state', 'trackingKey', 'updatedAt', 'who']);
  assert.match(JSON.parse(raw).who, /^(guest|[A-Za-z0-9_-]{1,128})$/, 'owner identity only: guest or the Firebase uid');
  assert.match(JSON.parse(raw).trackingKey, /^[0-9A-HJKMNP-TV-Z]{24}$/, 'the tracking key is random, not derived from personal data');
  for (const pii of ['+962791234567', '791234567', 'Test Buyer', 'Rainbow', 'ring twice', 'buyer@example.com', 'CLIQ-REF-777', 'amman', 'Notebook']) {
    assert.equal(raw.includes(pii), false, pii);
  }
  s.setItem(ATTEMPT_STORAGE_KEY, '{"orderId":"x","key":"y","state":"pending"}');
  assert.equal(store.get(), null);
  assert.equal(sessionAttemptStore(null).get(), null);
});

test('recordOutcome: not_confirmed/conflict -> uncertain with lastSentAt; offline/rate_limited keep the number', async () => {
  const store = sessionAttemptStore(memStorage());
  const a = await prepareAttempt(order(), store, () => 1000);
  recordOutcome(store, a, { kind: 'offline', orderId: a.orderId, attempts: 0 }, () => 2000);
  assert.deepEqual([store.get().state, store.get().lastSentAt], ['pending', null]);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'network', existsOnServer: null, attempts: 3 }, () => 5000);
  assert.deepEqual([store.get().state, store.get().lastSentAt], ['uncertain', 5000]);
  recordOutcome(store, a, { kind: 'rate_limited', orderId: a.orderId, retryAfterMs: 0, attempts: 3 }, () => 6000);
  assert.equal(store.get().state, 'uncertain', 'never downgraded from uncertain');
});

test('resolvePreviousAttempt: exists -> exists_unverified (NOT confirmed, record kept)', async () => {
  const store = sessionAttemptStore(memStorage());
  const a = await prepareAttempt(order(), store);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 });
  const r = await resolvePreviousAttempt(store, opts(), deps(fakeFetch([], [EXISTS])));
  assert.deepEqual(r, { state: 'exists_unverified', orderId: a.orderId });
  assert.equal(store.get().state, 'uncertain');
});

test('resolvePreviousAttempt NEVER clears: 404 twice is reported (settled or not), the number stays until an explicit abandon', async () => {
  const store = sessionAttemptStore(memStorage());
  const a = await prepareAttempt(order(), store, () => 0);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 }, () => 10_000);
  const early = await resolvePreviousAttempt(store, opts(), deps(fakeFetch([], [MISSING])), () => 10_000 + 30_000);
  assert.deepEqual(early, { state: 'not_found', orderId: a.orderId, settled: false, retryAfterMs: SETTLE_MS - 30_000 });
  const late = await resolvePreviousAttempt(store, opts(), deps(fakeFetch([], [MISSING])), () => 10_000 + SETTLE_MS * 50);
  assert.deepEqual(late, { state: 'not_found', orderId: a.orderId, settled: true, retryAfterMs: 0 });
  assert.deepEqual([store.get().state, store.get().orderId], ['uncertain', a.orderId], 'still kept even when "settled"');
  assert.equal((await prepareAttempt(order({ note: 'new order' }), store)).ok, false, 'a different order is still refused');
  abandonPreviousAttempt(store); // explicit, user-confirmed only
  assert.equal(store.get(), null);
});

// ================================================================== TWO SEPARATE CALLS sharing one AttemptStore
const hangAll = (statusSteps = ['hang']) => fakeFetch(['hang'], statusSteps);
async function firstCallUncertain(store) {
  const p = await prepareAttempt(order(), store, () => 1_000);
  const o = { ...order(), id: p.orderId };
  const r1 = await submitPrepared(o, p, store, opts({ maxAttempts: 1, statusChecks: 1 }), deps(hangAll()), () => 2_000);
  assert.equal(r1.kind, 'not_confirmed');
  assert.deepEqual([store.get().state, store.get().lastSentAt], ['uncertain', 2_000]);
  return { p, o };
}

test('two calls (raw submitOrder + recordOutcome): call 2 gets 403 / 400 / misconfigured -> record KEPT (uncertain, same number)', async () => {
  for (const [label, run] of [
    ['403 token expired', (o) => submitOrder(o, opts(), deps(fakeFetch([E403])))],
    ['400', (o) => submitOrder(o, opts(), deps(fakeFetch([E400])))],
    ['misconfigured: Worker URL removed', (o) => submitOrder(o, opts({ workerUrl: '' }), deps(fakeFetch([OK()])))],
    ['misconfigured: Worker URL invalid', (o) => submitOrder(o, opts({ workerUrl: 'ftp://changed' }), deps(fakeFetch([OK()])))],
  ]) {
    const store = sessionAttemptStore(memStorage());
    const { p, o } = await firstCallUncertain(store);
    const r2 = await run(o); // a raw call knows nothing about call 1 -> may say rejected/misconfigured …
    assert.ok(['rejected', 'misconfigured'].includes(r2.kind), label);
    recordOutcome(store, p, r2, () => 9_000); // … but the record must survive
    assert.deepEqual([store.get()?.state, store.get()?.orderId, store.get()?.lastSentAt], ['uncertain', p.orderId, 2_000], label);
  }
});

test('two calls via submitPrepared: call 2 gets 403 (token expired), status unreachable -> not_confirmed, NOT rejected', async () => {
  const store = sessionAttemptStore(memStorage());
  const { p, o } = await firstCallUncertain(store);
  const f = fakeFetch([E403], ['hang']);
  const r2 = await submitPrepared(o, p, store, opts(), deps(f), () => 9_000);
  assert.deepEqual([r2.kind, r2.lastCode, r2.existsOnServer], ['not_confirmed', 'TURNSTILE_FAILED', null]);
  assert.equal(f.creates().length, 1, 'no blind retries after the 403');
  assert.deepEqual([store.get().state, store.get().orderId], ['uncertain', p.orderId]);
});

test('two calls via submitPrepared: call 2 gets 400, status 404 twice -> still not_confirmed (call 1 may be in flight)', async () => {
  const store = sessionAttemptStore(memStorage());
  const { p, o } = await firstCallUncertain(store);
  const r2 = await submitPrepared(o, p, store, opts(), deps(fakeFetch([E400], [MISSING])));
  assert.deepEqual([r2.kind, r2.existsOnServer], ['not_confirmed', false]);
  assert.equal(store.get().state, 'uncertain');
});

test('two calls via submitPrepared: token expired in call 2, status exists, verification with a FRESH token -> confirmed via verify', async () => {
  const store = sessionAttemptStore(memStorage());
  const { p, o } = await firstCallUncertain(store);
  const tokens = ['expired-token', 'fresh-token'];
  const f = fakeFetch([E403, OK(true, p.orderId)], [EXISTS]);
  const r2 = await submitPrepared(o, p, store, opts({ getTurnstileToken: async () => tokens.shift() }), deps(f));
  assert.deepEqual([r2.kind, r2.via, r2.replay], ['confirmed', 'verify', true]);
  assert.deepEqual(f.creates().map((c) => JSON.parse(c.body).turnstileToken), ['expired-token', 'fresh-token']);
  assert.equal(store.get().state, 'confirmed');
});

test('two calls via submitPrepared: token still expired on verification -> not_confirmed (unverified), record kept', async () => {
  const store = sessionAttemptStore(memStorage());
  const { p, o } = await firstCallUncertain(store);
  const r2 = await submitPrepared(o, p, store, opts({ getTurnstileToken: async () => 'expired-token' }), deps(fakeFetch([E403], [EXISTS])));
  assert.deepEqual([r2.kind, r2.reason, r2.lastCode, r2.existsOnServer], ['not_confirmed', 'unverified', 'TURNSTILE_FAILED', true]);
  assert.equal(store.get().state, 'uncertain');
});

test('two calls via submitPrepared: Worker setting changed between calls', async () => {
  // (a) URL removed -> misconfigured, nothing sent, record kept
  let store = sessionAttemptStore(memStorage());
  let first = await firstCallUncertain(store);
  const f = fakeFetch([OK()]);
  const ra = await submitPrepared(first.o, first.p, store, opts({ workerUrl: '' }), deps(f));
  assert.equal(ra.kind, 'misconfigured');
  assert.equal(f.calls.length, 0);
  assert.deepEqual([store.get().state, store.get().orderId], ['uncertain', first.p.orderId]);
  // (b) URL now points to the wrong service (404 NOT_FOUND for /create-order) -> not rejected
  store = sessionAttemptStore(memStorage());
  first = await firstCallUncertain(store);
  const rb = await submitPrepared(first.o, first.p, store, opts({ workerUrl: 'http://127.0.0.1:9999' }), deps(fakeFetch([{ status: 404, body: { ok: false, code: 'NOT_FOUND' } }], [{ status: 404, body: { ok: false, code: 'NOT_FOUND' } }])));
  assert.deepEqual([rb.kind, rb.lastCode, rb.existsOnServer], ['not_confirmed', 'NOT_FOUND', null]);
  assert.equal(store.get().state, 'uncertain');
});

test('two calls: call 1 only rate-limited (429, never processed) -> a 400 in call 2 may clear (nothing can exist)', async () => {
  const store = sessionAttemptStore(memStorage());
  const p = await prepareAttempt(order(), store);
  const o = { ...order(), id: p.orderId };
  const r1 = await submitPrepared(o, p, store, opts(), deps(fakeFetch([{ status: 429, body: { ok: false, code: 'RATE_LIMITED' } }])));
  assert.equal(r1.kind, 'rate_limited');
  assert.deepEqual([store.get().state, store.get().lastSentAt], ['pending', null], '429 is not a possibly-processed send');
  assert.equal(mayHaveBeenSaved(store.get(), p.orderId), false);
  const r2 = await submitPrepared(o, p, store, opts(), deps(fakeFetch([E400])));
  assert.equal(r2.kind, 'rejected');
  assert.equal(store.get(), null, 'cleared: nothing could have been saved');
});

test('two calls: call 1 offline (nothing sent) -> a 403 in call 2 may clear (nothing can exist)', async () => {
  const store = sessionAttemptStore(memStorage());
  const p = await prepareAttempt(order(), store);
  const o = { ...order(), id: p.orderId };
  const f = fakeFetch([OK()]);
  assert.equal((await submitPrepared(o, p, store, opts(), deps(f, { isOnline: () => false }))).kind, 'offline');
  assert.equal(f.calls.length, 0);
  assert.equal(mayHaveBeenSaved(store.get(), p.orderId), false);
  assert.equal((await submitPrepared(o, p, store, opts(), deps(fakeFetch([E403])))).kind, 'rejected');
  assert.equal(store.get(), null);
});

test('rate-limited call after an uncertain one keeps uncertain AND the earlier lastSentAt', async () => {
  const store = sessionAttemptStore(memStorage());
  const { p, o } = await firstCallUncertain(store);
  const r = await submitPrepared(o, p, store, opts({ maxAttempts: 1 }), deps(fakeFetch([{ status: 429, body: {} }], ['hang'])), () => 50_000);
  assert.equal(r.kind, 'not_confirmed', 'with an earlier possible save, 429-only still resolves via status');
  assert.equal(store.get().state, 'uncertain');
});

test('a confirmed record is never downgraded by a later rejected/misconfigured call', async () => {
  const store = sessionAttemptStore(memStorage());
  const p = await prepareAttempt(order(), store);
  const o = { ...order(), id: p.orderId };
  assert.equal((await submitPrepared(o, p, store, opts(), deps(fakeFetch([OK(false, p.orderId)])))).kind, 'confirmed');
  recordOutcome(store, p, { kind: 'misconfigured', orderId: p.orderId, reason: 'x', attempts: 0 });
  assert.equal(store.get().state, 'confirmed');
});

test('submitPrepared refuses an order whose id is not the prepared number', async () => {
  const store = sessionAttemptStore(memStorage());
  const p = await prepareAttempt(order(), store);
  await assert.rejects(submitPrepared({ ...order(), id: 'ORD-OTHER999-XXXXXX' }, p, store, opts(), deps(fakeFetch([OK()]))), /prepared order number/);
});

test('resolvePreviousAttempt: one 404 + one unknown -> unknown (kept); abandon only by explicit call', async () => {
  const store = sessionAttemptStore(memStorage());
  const a = await prepareAttempt(order(), store, () => 0);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 }, () => 0);
  const r = await resolvePreviousAttempt(store, opts(), deps(fakeFetch([], [MISSING, 'network'])), () => SETTLE_MS * 10);
  assert.equal(r.state, 'unknown');
  assert.ok(store.get());
  abandonPreviousAttempt(store);
  assert.equal(store.get(), null);
});

test('the module never sends anything on its own', async () => {
  const f = fakeFetch([OK()]);
  const store = sessionAttemptStore(memStorage());
  const a = await prepareAttempt(order(), store);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(f.calls.length, 0);
});

// ================================================================== 9. signed-in customers: Firebase ID token
const UID = 'aliceUid000000000000000000A1';
const E401X = { status: 401, body: { ok: false, code: 'AUTH_EXPIRED' } };
const E401I = { status: 401, body: { ok: false, code: 'AUTH_INVALID' } };
/** fakeFetch + the headers of every call */
function headerFetch(createSteps, statusSteps = []) {
  const f = fakeFetch(createSteps, statusSteps);
  const headers = [];
  const w = async (url, init = {}) => {
    if (!/\/status$/.test(url)) headers.push(init.headers || {});
    return f(url, init);
  };
  Object.assign(w, { calls: f.calls, creates: f.creates, statuses: f.statuses, headers });
  return w;
}
/** token source: returns `tokens[i]` per call (null = signed out, 'throw' = Firebase error) and records forceRefresh */
function tokenSource(tokens) {
  const asks = [];
  const fn = async (force) => {
    asks.push(force);
    const t = tokens[Math.min(asks.length - 1, tokens.length - 1)];
    if (t === 'throw') throw new Error('auth/network-request-failed');
    return t;
  };
  fn.asks = asks;
  return fn;
}

test('auth: guest order, nobody signed in -> sent WITHOUT Authorization, confirmed', async () => {
  const f = headerFetch([OK()]);
  const getAuthToken = tokenSource([null]);
  const r = await submitOrder(order(), opts({ getAuthToken }), deps(f));
  assert.equal(r.kind, 'confirmed');
  assert.equal('authorization' in f.headers[0], false);
});

test('auth: signed-in order -> "Authorization: Bearer <token>", token asked without forced refresh', async () => {
  const f = headerFetch([OK()]);
  const getAuthToken = tokenSource(['tok-1']);
  const r = await submitOrder(order({ userId: UID }), opts({ getAuthToken }), deps(f));
  assert.equal(r.kind, 'confirmed');
  assert.equal(f.headers[0].authorization, 'Bearer tok-1');
  assert.deepEqual(getAuthToken.asks, [false]);
});

test('auth: signed-in order but no token (signed out / Firebase error) -> auth_required, NOTHING sent (never as guest)', async () => {
  for (const tokens of [[null], ['throw']]) {
    const f = headerFetch([OK()]);
    const r = await submitOrder(order({ userId: UID }), opts({ getAuthToken: tokenSource(tokens) }), deps(f));
    assert.equal(r.kind, 'auth_required');
    assert.equal(r.code, 'AUTH_TOKEN_UNAVAILABLE');
    assert.equal(r.orderId, ID);
    assert.equal(f.creates().length, 0);
  }
  // no token source at all (e.g. misconfigured page) -> same
  const f = headerFetch([OK()]);
  assert.equal((await submitOrder(order({ userId: UID }), opts(), deps(f))).kind, 'auth_required');
  assert.equal(f.creates().length, 0);
});

test('auth: 401 AUTH_EXPIRED -> token refreshed (force) and the SAME payload resent at once -> confirmed', async () => {
  const f = headerFetch([E401X, OK()]);
  const d = deps(f);
  const getAuthToken = tokenSource(['old', 'new']);
  const r = await submitOrder(order({ userId: UID }), opts({ getAuthToken }), d);
  assert.equal(r.kind, 'confirmed');
  assert.deepEqual(getAuthToken.asks, [false, true]);
  assert.equal(f.headers[0].authorization, 'Bearer old');
  assert.equal(f.headers[1].authorization, 'Bearer new');
  assert.equal(f.creates()[0].body, f.creates()[1].body, 'byte-identical payload, same order number');
  assert.deepEqual(d.waits, [], 'no backoff wait before the refreshed resend');
});

test('auth: 401 again after the refresh -> auth_required (same number); attempt record KEPT; later retry confirms it', async () => {
  const store = sessionAttemptStore(memStorage());
  const o = order({ userId: UID });
  const prepared = await prepareAttempt(o, store);
  const payload = { ...o, id: prepared.orderId };
  const f1 = headerFetch([E401I, E401I]);
  const r1 = await submitPrepared(payload, prepared, store, opts({ getAuthToken: tokenSource(['a', 'b']) }), deps(f1));
  assert.equal(r1.kind, 'auth_required');
  assert.equal(r1.code, 'AUTH_INVALID');
  assert.equal(f1.creates().length, 2, 'one send + one refreshed resend, no more');
  const rec = store.get();
  assert.equal(rec.orderId, prepared.orderId, 'number kept');
  assert.equal(rec.state, 'pending');
  // the customer signs in again and presses "retry with the same number"
  const again = await prepareAttempt(o, store);
  assert.equal(again.orderId, prepared.orderId);
  const f2 = headerFetch([OK(false, prepared.orderId)]);
  const r2 = await submitPrepared(payload, again, store, opts({ getAuthToken: tokenSource(['fresh']) }), deps(f2));
  assert.equal(r2.kind, 'confirmed');
  assert.equal(r2.orderId, prepared.orderId);
  assert.equal(f1.creates()[0].body, f2.creates()[0].body, 'same frozen payload across calls');
});

test('auth: an EARLIER send may have been saved (timeout), then 401s -> resolved by status + verified resend, never "auth_required"', async () => {
  const f = headerFetch(['hang', E401X, E401X, OK(true)], [EXISTS]);
  const getAuthToken = tokenSource(['t1', 't2', 't3', 't4']);
  const r = await submitOrder(order({ userId: UID }), opts({ getAuthToken }), deps(f));
  assert.equal(r.kind, 'confirmed');
  assert.equal(r.via, 'verify');
  assert.equal(r.replay, true);
});

test('auth: an EARLIER send may have been saved, then the token disappears -> not_confirmed with the same number', async () => {
  const f = headerFetch(['hang'], [MISSING, MISSING]);
  const r = await submitOrder(order({ userId: UID }), opts({ getAuthToken: tokenSource(['t1', null]) }), deps(f));
  assert.equal(r.kind, 'not_confirmed');
  assert.equal(r.orderId, ID);
  assert.equal(r.lastCode, 'AUTH_TOKEN_UNAVAILABLE');
});

test('auth: recordOutcome(auth_required) never clears or downgrades an attempt that may have been saved', async () => {
  const store = sessionAttemptStore(memStorage());
  const key = await attemptKey(order({ userId: UID }));
  store.set({ orderId: ID, key, state: 'uncertain', updatedAt: 1, lastSentAt: 5 });
  recordOutcome(store, { orderId: ID, key }, { kind: 'auth_required', orderId: ID, code: 'AUTH_EXPIRED', attempts: 2 }, () => 9);
  const rec = store.get();
  assert.equal(rec.state, 'uncertain');
  assert.equal(rec.lastSentAt, 5);
  assert.equal(mayHaveBeenSaved(rec, ID), true);
});

test('auth: 403 USERID_MISMATCH (other account signed in) -> rejected, nothing assumed saved', async () => {
  const f = headerFetch([{ status: 403, body: { ok: false, code: 'USERID_MISMATCH' } }]);
  const r = await submitOrder(order({ userId: UID }), opts({ getAuthToken: tokenSource(['other-account']) }), deps(f));
  assert.equal(r.kind, 'rejected');
  assert.equal(r.code, 'USERID_MISMATCH');
});

test('auth: the ID token is never part of the payload, the content key or the identity hash', async () => {
  const f = headerFetch([OK()]);
  await submitOrder(order({ userId: UID }), opts({ getAuthToken: tokenSource(['SECRET-TOKEN']) }), deps(f));
  assert.equal(f.creates()[0].body.includes('SECRET-TOKEN'), false);
  assert.equal(await attemptKey(order({ userId: UID })), await attemptKey(order({ userId: UID })));
});

// ================================================================== 10. tracking key (browser side)
test('tracking key: 24 Crockford chars, random, and normalisation/hash IDENTICAL to the Worker', async () => {
  const W_TRACK = await import('../../workers/order-worker/src/tracking.js');
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const k = newTrackingKey();
    assert.match(k, TRACKING_KEY_RE);
    seen.add(k);
    assert.equal(normalizeTrackingKey(formatTrackingKey(k).toLowerCase()), k);
    assert.equal(W_TRACK.normalizeTrackingKey(formatTrackingKey(k)), k);
    if (i < 20) assert.equal(await trackingKeyHash(k), await W_TRACK.hashTrackingKey(k), 'browser hash == Worker hash');
  }
  assert.equal(seen.size, 200);
  for (const bad of ['', 'abc', 'U'.repeat(24), null]) assert.equal(normalizeTrackingKey(bad), W_TRACK.normalizeTrackingKey(bad));
});

test('tracking key: generated BEFORE the first send, kept for every resend of the attempt, survives outcomes', async () => {
  const store = sessionAttemptStore(memStorage());
  const a = await prepareAttempt(order(), store);
  assert.match(a.trackingKey, TRACKING_KEY_RE);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 });
  const b = await prepareAttempt(order(), store);
  assert.deepEqual([b.orderId, b.trackingKey], [a.orderId, a.trackingKey], 'same number, same key');
  recordOutcome(store, b, { kind: 'auth_required', orderId: b.orderId, code: 'AUTH_EXPIRED', attempts: 1 });
  recordOutcome(store, b, { kind: 'rate_limited', orderId: b.orderId, retryAfterMs: 1, attempts: 1 });
  assert.equal(store.get().trackingKey, a.trackingKey);
  // a record written before tracking keys existed gets one (and keeps it)
  const s2 = memStorage();
  const old = sessionAttemptStore(s2);
  old.set({ orderId: ID, key: await attemptKey(order()), state: 'uncertain', updatedAt: 1, lastSentAt: 1 });
  const c = await prepareAttempt(order(), old);
  assert.match(c.trackingKey, TRACKING_KEY_RE);
  assert.equal((await prepareAttempt(order(), old)).trackingKey, c.trackingKey);
});

test('tracking key: only its HASH is sent, NEXT TO the order (payload, identity hash and content key unchanged)', async () => {
  const f = fakeFetch([OK()]);
  const h = await trackingKeyHash(newTrackingKey());
  await submitOrder(order(), opts({ trackingKeyHash: h }), deps(f));
  const body = JSON.parse(f.creates()[0].body);
  assert.equal(body.trackingKeyHash, h);
  assert.equal('trackingKeyHash' in body.order, false);
  assert.equal(await identityHash(body.order), await identityHash(order()));
  // a malformed value is never sent
  const g = fakeFetch([OK()]);
  await submitOrder(order(), opts({ trackingKeyHash: 'nope' }), deps(g));
  assert.equal('trackingKeyHash' in JSON.parse(g.creates()[0].body), false);
});

test('tracking key: create answer LOST -> verification resend carries the SAME hash (the browser never needs the server to return a key)', async () => {
  const f = fakeFetch(['hang', OK(true)], [EXISTS]);
  const h = await trackingKeyHash(newTrackingKey());
  const r = await submitOrder(order(), opts({ trackingKeyHash: h, maxAttempts: 1 }), deps(f));
  assert.deepEqual([r.kind, r.via], ['confirmed', 'verify']);
  assert.deepEqual(f.creates().map((c) => JSON.parse(c.body).trackingKeyHash), [h, h]);
});

test('summary request: key in a HEADER only (never in the URL), refusals mapped, nothing asked without a credential', async () => {
  const key = newTrackingKey();
  const calls = [];
  const mk = (status, body) => async (url, init) => {
    calls.push({ url, headers: init.headers });
    return { status, headers: { get: () => null }, text: async () => JSON.stringify(body) };
  };
  const ok = await fetchOrderSummary(ID, { key: formatTrackingKey(key) }, opts(), deps(mk(200, { ok: true, order: { id: ID, status: 'new', items: [] } })));
  assert.equal(ok.kind, 'ok');
  assert.equal(calls[0].url, `${W}/orders/${ID}/summary`);
  assert.equal(calls[0].url.includes(key), false, 'key never in the URL');
  assert.equal(calls[0].headers['x-tracking-key'], key);
  assert.equal((await fetchOrderSummary(ID, { key }, opts(), deps(mk(404, { ok: false, code: 'NOT_FOUND' })))).kind, 'denied');
  assert.equal((await fetchOrderSummary(ID, { key }, opts(), deps(mk(200, { ok: true, order: { id: 'ORD-OTHER111-XXXX' } })))).kind, 'unavailable');
  assert.equal((await fetchOrderSummary(ID, { key }, opts(), deps(async () => { throw new TypeError('x'); }))).kind, 'unavailable');
  const before = calls.length;
  assert.equal((await fetchOrderSummary(ID, {}, opts(), deps(mk(200, {})))).kind, 'denied');
  assert.equal((await fetchOrderSummary(ID, { key: 'not-a-key' }, opts(), deps(mk(200, {})))).kind, 'denied');
  assert.equal(calls.length, before, 'no request without a usable key or token');
  const t = await fetchOrderSummary(ID, { idToken: 'tok' }, opts(), deps(mk(200, { ok: true, order: { id: ID } })));
  assert.equal(t.kind, 'ok');
  assert.equal(calls.at(-1).headers.authorization, 'Bearer tok');
});

test('public status request (number only)', async () => {
  const mk = (status, body) => async () => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  assert.deepEqual(await fetchOrderStatus(ID, opts(), deps(mk(200, { ok: true, exists: true, status: 'shipped' }))), { exists: true, status: 'shipped' });
  assert.deepEqual(await fetchOrderStatus(ID, opts(), deps(mk(404, { ok: true, exists: false }))), { exists: false, status: '' });
  assert.equal(await fetchOrderStatus(ID, opts(), deps(mk(500, {}))), null);
  assert.equal(await fetchOrderStatus('bad', opts(), deps(mk(200, {}))), null);
});
