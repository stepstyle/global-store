// Pending-attempt recovery: localStorage records, write-ahead, migration, multi-tab lock, page-opened guard,
// recovery by tracking key. Fake storage / fetch / locks — no network.   node --test tests/unit/attemptRecovery.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localAttemptStore, sessionAttemptStore, prepareAttempt, submitPrepared, recordOutcome, resolvePendingAttempts, openAttempts, recordFor,
  attemptKey, newTrackingKey, trackingKeyHash, ATTEMPTS_V2_KEY, ATTEMPT_STORAGE_KEY, MAX_CONFIRMED_KEPT,
} from '../../src/services/orderSubmit.ts';
import { dropOpenUnsent } from '../../src/services/orderSubmit.ts';
import { takeOwnerNotices } from '../../src/services/checkoutFlow.ts';
import { retrySameOrder } from '../../src/services/checkoutFlow.ts';
import { placeOrder, createSubmitLock, pendingPayloadStore, restorablePayload, recoverPendingAttempts, withCheckoutLock, withIdbLock, CheckoutLockUnavailable, messageFor, trackingKeys } from '../../src/services/checkoutFlow.ts';
import { hashTrackingKey, normalizeTrackingKey } from '../../workers/order-worker/src/tracking.js';

const W = 'http://127.0.0.1:8787';
const kv = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const draft = (over = {}) => ({
  userId: 'guest', status: 'new',
  items: [{ productId: 'p-simple', name: 'Notebook', price: 2.5, quantity: 2, selectedVariant: null }],
  subtotal: 5, discountAmount: 0, shippingCost: 3, total: 8, paymentMethod: 'cliq', shippingMethodId: 'standard', shippingMethod: 'Standard',
  customerEmail: 'secret.buyer@example.com', note: 'leave at door 0799000111',
  paymentDetails: { cliqReference: 'CLIQ-SECRET-77', isPaid: false },
  address: { fullName: 'Secret Buyer', city: 'Amman', street: 'Hidden Street 5', phone: '+962791234567' },
  addressMeta: { country: 'Jordan', countryCode: 'JO', citySlug: 'amman', ammanAreaId: 'a1', phoneDial: '+962', phoneLocal: '0791234567' },
  ...over,
});
const PII = ['Secret Buyer', '791234567', 'Hidden Street', 'secret.buyer', 'CLIQ-SECRET', '0799000111', 'Amman'];
const opts = { workerUrl: W, timeoutMs: 40, maxAttempts: 1, backoffMs: [1], statusChecks: 1, statusDelayMs: 1 };
const res = (status, body) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(body) });

// ------------------------------------------------------------------ persistence, no personal data
test('records survive "closing the browser" (new store objects, empty sessionStorage) and hold NO personal data', async () => {
  const local = kv();
  const a = await prepareAttempt(draft(), localAttemptStore(local, kv()));
  recordOutcome(localAttemptStore(local, kv()), a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 });
  const reopened = localAttemptStore(local, kv()); // new tab, new session
  const r = recordFor(reopened, a.orderId);
  assert.deepEqual([r.state, r.trackingKey, r.key], ['uncertain', a.trackingKey, a.key]);
  const raw = local.getItem(ATTEMPTS_V2_KEY);
  for (const p of PII) assert.equal(raw.includes(p), false, `localStorage holds ${p}`);
  const keys = Object.keys(JSON.parse(raw).attempts[0]).sort();
  assert.deepEqual(keys, ['key', 'lastSentAt', 'orderId', 'state', 'trackingKey', 'updatedAt', 'who']);
  assert.equal(JSON.parse(raw).attempts[0].who, 'guest', 'owner identity only: guest or the Firebase uid');
});

// ------------------------------------------------------------------ write-ahead
test('write-ahead: lastSentAt is stored BEFORE the network call (a tab closed mid-request still knows it may be saved)', async () => {
  const local = kv();
  const store = localAttemptStore(local, kv());
  const d = draft();
  const p = await prepareAttempt(d, store);
  let seenAtSend = 'not called';
  const fetch = async (url, init) => {
    seenAtSend = recordFor(localAttemptStore(local, kv()), p.orderId).lastSentAt; // read by "another tab" at send time
    return res(200, { ok: true, orderId: JSON.parse(init.body).order.id, replay: false });
  };
  await submitPrepared({ ...d, id: p.orderId }, p, store, opts, { fetch, sleep: async () => {} });
  assert.equal(typeof seenAtSend, 'number', 'lastSentAt must already be set when the request leaves');
});

test('write-ahead is undone when the call was NOT processed (offline / no token / 429 / 400), so nothing is blocked for nothing', async () => {
  for (const [name, setup] of [
    ['offline', { deps: { isOnline: () => false } }],
    ['no token', { draft: { userId: 'aliceUid000000000000000000A1' }, opts: { getAuthToken: async () => null } }],
    ['429', { fetch: async () => res(429, { ok: false, code: 'RATE_LIMITED' }) }],
  ]) {
    const store = localAttemptStore(kv(), kv());
    const d = draft(setup.draft || {});
    const p = await prepareAttempt(d, store);
    await submitPrepared({ ...d, id: p.orderId }, p, store, { ...opts, ...(setup.opts || {}) }, { fetch: setup.fetch || (async () => res(500, {})), sleep: async () => {}, ...(setup.deps || {}) });
    const r = recordFor(store, p.orderId);
    assert.equal(r.lastSentAt, null, `${name}: lastSentAt restored`);
    assert.equal(r.state, 'pending', name);
  }
  // 400 with nothing sent before: the record is removed (nothing could be saved)
  const store = localAttemptStore(kv(), kv());
  const p = await prepareAttempt(draft(), store);
  await submitPrepared({ ...draft(), id: p.orderId }, p, store, opts, { fetch: async () => res(400, { ok: false, code: 'INVALID_ORDER' }), sleep: async () => {} });
  assert.equal(recordFor(store, p.orderId), null);
});

// ------------------------------------------------------------------ corruption, caps, migration
test('corrupt storage: whole value unreadable -> empty; one bad entry -> the others survive', () => {
  const local = kv();
  local.setItem(ATTEMPTS_V2_KEY, '{broken');
  assert.deepEqual(localAttemptStore(local, kv()).all(), []);
  const good = { orderId: 'ORD-AAAA1111-BBBB', key: 'a'.repeat(64), state: 'uncertain', updatedAt: 1, lastSentAt: 1 };
  local.setItem(ATTEMPTS_V2_KEY, JSON.stringify({ v: 2, attempts: [good, { orderId: 'bad' }, null, 7, { ...good, orderId: 'ORD-CCCC2222-DDDD', key: 'nothex' }] }));
  assert.deepEqual(localAttemptStore(local, kv()).all().map((r) => r.orderId), ['ORD-AAAA1111-BBBB']);
});

test('unresolved records are NEVER dropped (no age limit, no size cap); only old confirmed ones are pruned', () => {
  const local = kv();
  const store = localAttemptStore(local, kv());
  const rec = (i, state, t) => ({ orderId: `ORD-${String(1000 + i).padStart(8, 'A')}-BBBB`, key: String(i % 10).repeat(64), state, updatedAt: t, lastSentAt: t });
  for (let i = 0; i < 12; i++) store.set(rec(i, 'uncertain', i)); // even "ancient" ones (updatedAt ~ 1970)
  for (let i = 20; i < 32; i++) store.set(rec(i, 'confirmed', i));
  const all = store.all();
  assert.equal(all.filter((r) => r.state === 'uncertain').length, 12);
  assert.equal(all.filter((r) => r.state === 'confirmed').length, MAX_CONFIRMED_KEPT);
});

test('migration: the old sessionStorage record moves in with its number and tracking key; a different v2 record is kept too', async () => {
  const local = kv();
  const session = kv();
  // an existing v2 record (another tab) and this tab's old v1 record with different content
  const v2 = localAttemptStore(local, kv());
  const a = await prepareAttempt(draft(), v2);
  recordOutcome(v2, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 });
  const v1 = sessionAttemptStore(session);
  const b = await prepareAttempt(draft({ note: 'other order' }), v1);
  recordOutcome(v1, b, { kind: 'not_confirmed', orderId: b.orderId, reason: 'network', existsOnServer: null, attempts: 1 });
  const merged = localAttemptStore(local, session);
  const ids = merged.all().map((r) => r.orderId).sort();
  assert.deepEqual(ids, [a.orderId, b.orderId].sort(), 'both kept');
  assert.equal(recordFor(merged, b.orderId).trackingKey, b.trackingKey, 'tracking key kept');
  assert.equal(session.getItem(ATTEMPT_STORAGE_KEY), null, 'v1 record removed only after the move');
  // both block a third, different order; each one's own content reuses its own number
  const c = await prepareAttempt(draft({ note: 'third' }), merged);
  assert.equal(c.ok, false);
  assert.deepEqual(c.openOrderIds.sort(), ids);
  assert.equal((await prepareAttempt(draft({ note: 'other order' }), merged)).orderId, b.orderId);
  assert.equal((await prepareAttempt(draft(), merged)).orderId, a.orderId);
});

test('migration never loses the old record: if localStorage cannot be written, the v1 record stays in sessionStorage', async () => {
  const session = kv();
  const v1 = sessionAttemptStore(session);
  const b = await prepareAttempt(draft(), v1);
  const brokenLocal = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
  localAttemptStore(brokenLocal, session).all();
  assert.equal(JSON.parse(session.getItem(ATTEMPT_STORAGE_KEY)).orderId, b.orderId);
});

// ------------------------------------------------------------------ the page-opened guard (no time window)
test('same content confirmed AFTER this page opened -> no second order; a page opened later may order it again', async () => {
  const local = kv();
  const store = localAttemptStore(local, kv());
  const openedAt = Date.now();
  const a = await prepareAttempt(draft(), store);
  recordOutcome(store, a, { kind: 'confirmed', orderId: a.orderId, replay: false, via: 'create', attempts: 1 });
  assert.deepEqual(await prepareAttempt(draft(), store, Date.now, openedAt), { ok: false, reason: 'confirmed_while_open', previousOrderId: a.orderId });
  // a deliberate repeat purchase from a page opened after that confirmation: allowed, new number
  const later = await prepareAttempt(draft(), store, Date.now, Date.now() + 1);
  assert.ok(later.ok && later.orderId !== a.orderId);
  // different content is never affected
  const other = await prepareAttempt(draft({ note: 'x' }), localAttemptStore(kv(), kv()), Date.now, openedAt);
  assert.equal(other.ok, true);
});

// ------------------------------------------------------------------ recovery after reopening
test('recovery: 404 keeps the attempt unresolved (never removed); a LATE save is then recovered with the tracking key', async () => {
  const local = kv();
  const store = localAttemptStore(local, kv());
  const a = await prepareAttempt(draft(), store);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: false, attempts: 1 });
  let saved = false;
  const fetch = async (url, init) => {
    if (/\/summary$/.test(url)) {
      const ok = saved && normalizeTrackingKey(init.headers['x-tracking-key']) === a.trackingKey;
      return ok ? res(200, { ok: true, order: { id: a.orderId, status: 'new', items: [] } }) : res(404, { ok: false, code: 'NOT_FOUND' });
    }
    return saved ? res(200, { ok: true, exists: true, status: 'new' }) : res(404, { ok: true, exists: false });
  };
  const first = await resolvePendingAttempts(localAttemptStore(local, kv()), opts, { fetch });
  assert.deepEqual(first, [{ orderId: a.orderId, state: 'not_found_yet' }]);
  assert.equal(recordFor(localAttemptStore(local, kv()), a.orderId).state, 'uncertain', '404 is not proof: kept');
  assert.equal((await prepareAttempt(draft({ note: 'new order' }), localAttemptStore(local, kv()))).ok, false, 'still blocks a new number');
  saved = true; // the in-flight create finally committed
  const keys = trackingKeys(kv());
  const second = await recoverPendingAttempts(localAttemptStore(local, kv()), opts, { fetch }, keys, { add() {} });
  assert.deepEqual(second.map((r) => r.state), ['recovered']);
  assert.equal(recordFor(localAttemptStore(local, kv()), a.orderId).state, 'confirmed');
  assert.equal(keys.get(a.orderId), a.trackingKey);
});

test('recovery: an existing order NOT provable by this device stays unresolved; Worker down -> unknown; nothing removed', async () => {
  const store = localAttemptStore(kv(), kv());
  const a = await prepareAttempt(draft(), store);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 });
  const exists = await resolvePendingAttempts(store, opts, { fetch: async (u) => (/summary$/.test(u) ? res(404, { ok: false }) : res(200, { ok: true, exists: true, status: 'new' })) });
  assert.deepEqual(exists.map((r) => r.state), ['exists_unverified']);
  const down = await resolvePendingAttempts(store, opts, { fetch: async () => { throw new TypeError('down'); } });
  assert.deepEqual(down.map((r) => r.state), ['unknown']);
  assert.equal(openAttempts(store).length, 1);
});

// ------------------------------------------------------------------ original payload
test('payload restore: only this tab\'s payload for the open attempt AND only if its content hash matches', async () => {
  const store = localAttemptStore(kv(), kv());
  const session = kv();
  const payloads = pendingPayloadStore(session);
  const d = draft();
  const a = await prepareAttempt(d, store);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 });
  assert.equal(await restorablePayload(store, payloads), null, 'nothing kept -> nothing to resend');
  payloads.set({ ...d, id: a.orderId });
  assert.equal((await restorablePayload(store, payloads)).id, a.orderId);
  payloads.set({ ...d, note: 'tampered', id: a.orderId }); // same number, other content
  assert.equal(await restorablePayload(store, payloads), null, 'mismatching content is never resent');
  session.setItem('anta_checkout_pending_payload', '{broken');
  assert.equal(await restorablePayload(store, payloads), null);
});

// ------------------------------------------------------------------ two tabs
function mutexLocks() {
  let chain = Promise.resolve();
  return { request: (name, cb) => { const run = chain.then(cb); chain = run.catch(() => {}); return run; } };
}

test('two tabs, same order at the same moment, WITH Web Locks -> one order; the other tab is told it is already confirmed', async () => {
  const local = kv();
  const locks = mutexLocks();
  const creates = [];
  const fetch = async (url, init) => {
    creates.push(JSON.parse(init.body).order.id);
    await new Promise((r) => setTimeout(r, 20));
    return res(200, { ok: true, orderId: JSON.parse(init.body).order.id, replay: false });
  };
  const tab = () => ({ store: localAttemptStore(local, kv()), lock: createSubmitLock(), payloads: pendingPayloadStore(kv()), trackingKeys: trackingKeys(kv()) });
  const openedAt = Date.now() - 1000;
  const [t1, t2] = [tab(), tab()];
  const [r1, r2] = await Promise.all([
    placeOrder({ draft: draft(), ...t1, opts, deps: { fetch, sleep: async () => {} }, locks, openedAt }),
    placeOrder({ draft: draft(), ...t2, opts, deps: { fetch, sleep: async () => {} }, locks, openedAt }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), ['already_confirmed', 'confirmed']);
  assert.equal(new Set(creates).size, 1, 'one order number sent');
  assert.equal(creates.length, 1, 'one create request');
});

test('two tabs, different orders at the same moment, WITH Web Locks -> the second is held until the first is settled, then proceeds', async () => {
  const local = kv();
  const locks = mutexLocks();
  const fetch = async (url, init) => res(200, { ok: true, orderId: JSON.parse(init.body).order.id, replay: false });
  const mk = () => ({ store: localAttemptStore(local, kv()), lock: createSubmitLock(), payloads: pendingPayloadStore(kv()), trackingKeys: trackingKeys(kv()) });
  const [r1, r2] = await Promise.all([
    placeOrder({ draft: draft(), ...mk(), opts, deps: { fetch }, locks }),
    placeOrder({ draft: draft({ note: 'second order' }), ...mk(), opts, deps: { fetch }, locks }),
  ]);
  assert.deepEqual([r1.status, r2.status], ['confirmed', 'confirmed']);
  assert.notEqual(r1.orderId, r2.orderId);
});

test('no Web Locks and no IndexedDB in a BROWSER -> the order is NOT sent (fail closed), nothing prepared', async () => {
  const local = kv();
  let sent = 0;
  const fetch = async () => { sent++; return res(200, {}); };
  globalThis.window = {}; // "a browser"
  try {
    const r = await placeOrder({ draft: draft(), store: localAttemptStore(local, kv()), lock: createSubmitLock(), payloads: pendingPayloadStore(kv()), trackingKeys: trackingKeys(kv()), opts, deps: { fetch }, locks: null, idb: null });
    assert.deepEqual(r, { status: 'lock_unavailable', why: 'unsupported' });
  } finally {
    delete globalThis.window;
  }
  assert.equal(sent, 0);
  assert.deepEqual(localAttemptStore(local, kv()).all(), [], 'no attempt record created');
  const m = messageFor({ status: 'lock_unavailable', why: 'unsupported' });
  assert.match(m.bodyAr, /لم نُرسل الطلب/);
});

// A minimal IndexedDB double that SERIALIZES readwrite transactions (as the spec requires for overlapping scopes).
// Real cross-tab atomicity is proven in the browser (U25); this checks the lock logic: lease, renewal, takeover, timeout.
function fakeIdb() {
  const data = new Map();
  let chain = Promise.resolve();
  const later = (fn) => setTimeout(fn, 0);
  const db = {
    close() {},
    transaction() {
      const ops = [];
      const tx = { oncomplete: null, onerror: null, onabort: null };
      const store = {
        get(k) { const req = { result: undefined, onsuccess: null }; ops.push(() => { req.result = data.get(k); req.onsuccess && req.onsuccess(); }); return req; },
        put(v, k) { ops.push(() => data.set(k, v)); },
        delete(k) { ops.push(() => data.delete(k)); },
      };
      tx.objectStore = () => store;
      chain = chain.then(() => new Promise((done) => later(() => {
        for (let i = 0; i < ops.length; i++) ops[i](); // ops queued during callbacks run in the same transaction
        tx.oncomplete && tx.oncomplete();
        done();
      })));
      return tx;
    },
  };
  return {
    data,
    open() {
      const req = { result: db, onsuccess: null, onupgradeneeded: null, onerror: null };
      later(() => { req.onupgradeneeded && req.onupgradeneeded(); req.onsuccess && req.onsuccess(); });
      db.createObjectStore = () => {};
      return req;
    },
  };
}

test('IndexedDB lock: two "tabs" without Web Locks are serialized -> one order; the other is told it is already confirmed', async () => {
  const local = kv();
  const idb = fakeIdb();
  const creates = [];
  const fetch = async (url, init) => {
    creates.push(JSON.parse(init.body).order.id);
    await new Promise((r) => setTimeout(r, 30));
    return res(200, { ok: true, orderId: JSON.parse(init.body).order.id, replay: false });
  };
  const mk = () => ({ store: localAttemptStore(local, kv()), lock: createSubmitLock(), payloads: pendingPayloadStore(kv()), trackingKeys: trackingKeys(kv()) });
  const openedAt = Date.now() - 1000;
  const [r1, r2] = await Promise.all([
    placeOrder({ draft: draft(), ...mk(), opts, deps: { fetch }, locks: null, idb, openedAt }),
    placeOrder({ draft: draft(), ...mk(), opts, deps: { fetch }, locks: null, idb, openedAt }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), ['already_confirmed', 'confirmed']);
  assert.equal(creates.length, 1);
  assert.equal(idb.data.size, 0, 'lock released');
});

test('IndexedDB lock: a lease left by a crashed tab expires and is taken over; a LIVE lease makes the other tab wait, then give up clearly', async () => {
  const idb = fakeIdb();
  idb.data.set('submit', { owner: 'dead-tab', until: Date.now() - 1 }); // expired lease
  assert.equal(await withIdbLock(async () => 'ran', idb, { pollMs: 5 }), 'ran');
  idb.data.set('submit', { owner: 'live-tab', until: Date.now() + 60_000 }); // another tab is sending
  await assert.rejects(withIdbLock(async () => 'never', idb, { pollMs: 5, waitMs: 60 }), (e) => e instanceof CheckoutLockUnavailable && e.why === 'busy');
  assert.equal(idb.data.get('submit').owner, 'live-tab', 'the other tab keeps its lock');
});

test('IndexedDB lock: the lease is renewed while a long send runs (no second tab can enter)', async () => {
  const idb = fakeIdb();
  let t = 1_000_000;
  const now = () => t;
  const p = withIdbLock(async () => {
    const first = idb.data.get('submit').until;
    t += 2_000; // time passes inside the send (within the 3 s lease; past it = frozen tab, tested separately)
    await new Promise((r) => setTimeout(r, 1_150)); // > one renewal interval (max(1 s, lease/3))
    return [first, idb.data.get('submit').until];
  }, idb, { leaseMs: 3_000, now });
  const [first, renewed] = await p;
  assert.ok(renewed > first, 'lease extended while held');
});

test('withCheckoutLock uses navigator.locks when present, and runs directly otherwise', async () => {
  const calls = [];
  const locks = { request: async (name, cb) => { calls.push(name); return cb(); } };
  assert.equal(await withCheckoutLock(async () => 7, locks), 7);
  assert.deepEqual(calls, ['anta-checkout-submit']);
  assert.equal(await withCheckoutLock(async () => 8, null), 8);
});

test('the tracking key of the attempt is the one sent (hash) on every resend, also after reopening', async () => {
  const local = kv();
  const sent = [];
  const fetch = async (url, init) => {
    sent.push(JSON.parse(init.body).trackingKeyHash);
    throw new TypeError('network down');
  };
  const run = () => placeOrder({ draft: draft(), store: localAttemptStore(local, kv()), lock: createSubmitLock(), payloads: pendingPayloadStore(kv()), trackingKeys: trackingKeys(kv()), opts: { ...opts, statusChecks: 1 }, deps: { fetch: async (u, i) => (/status$/.test(u) ? res(404, { ok: true, exists: false }) : fetch(u, i)), sleep: async () => {} }, locks: null });
  const r1 = await run();
  const r2 = await run(); // "reopened"
  assert.equal(r1.orderId, r2.orderId);
  const key = recordFor(localAttemptStore(local, kv()), r1.orderId).trackingKey;
  assert.ok(sent.length >= 2 && sent.every((h) => h === sent[0]));
  assert.equal(sent[0], await hashTrackingKey(normalizeTrackingKey(key)));
  assert.equal(sent[0], await trackingKeyHash(key));
});

// ------------------------------------------------------------------ lastSentAt: never "unsent" if it may have reached the Worker
async function sendOnce(store, d, fetch, extraOpts = {}) {
  const p = await prepareAttempt(d, store);
  const out = await submitPrepared({ ...d, id: p.orderId }, p, store, { ...opts, ...extraOpts }, { fetch, sleep: async () => {} });
  return { p, out, rec: recordFor(store, p.orderId) };
}

test('connection lost AFTER the Worker saved it (before the answer) -> uncertain, send time KEPT, other content refused', async () => {
  const saved = [];
  const store = localAttemptStore(kv(), kv());
  const d = draft();
  const fetch = async (url, init) => {
    if (/create-order$/.test(url)) {
      saved.push(JSON.parse(init.body).order.id); // the Worker committed …
      throw new TypeError('connection reset'); // … and the answer never arrived
    }
    return res(200, { ok: true, exists: true, status: 'new' }); // status: it exists
  };
  const { out, rec } = await sendOnce(store, d, fetch);
  assert.equal(out.kind, 'not_confirmed');
  assert.equal(saved.length >= 1, true);
  assert.equal(rec.state, 'uncertain');
  assert.equal(typeof rec.lastSentAt, 'number');
  assert.equal((await prepareAttempt(draft({ note: 'other' }), store)).ok, false);
});

test('timeout (no answer in time) -> uncertain, send time KEPT', async () => {
  const store = localAttemptStore(kv(), kv());
  const fetch = (url, init) => (/create-order$/.test(url)
    ? new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))))
    : Promise.resolve(res(404, { ok: true, exists: false })));
  const { out, rec } = await sendOnce(store, draft(), fetch);
  assert.equal(out.kind, 'not_confirmed');
  assert.equal(typeof rec.lastSentAt, 'number');
  assert.equal(rec.state, 'uncertain');
});

test('an earlier timeout in the SAME call, then a 400 -> NOT treated as "nothing sent" (send time kept, record kept)', async () => {
  const store = localAttemptStore(kv(), kv());
  let n = 0;
  const fetch = (url, init) => {
    if (!/create-order$/.test(url)) return Promise.resolve(res(404, { ok: true, exists: false }));
    n++;
    if (n === 1) return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
    return Promise.resolve(res(400, { ok: false, code: 'INVALID_ORDER' }));
  };
  const { out, rec } = await sendOnce(store, draft(), fetch, { maxAttempts: 2 });
  assert.equal(out.kind, 'not_confirmed');
  assert.ok(rec && typeof rec.lastSentAt === 'number');
});

test('a LATER call that is not processed (offline) never erases the send time of an EARLIER call', async () => {
  const store = localAttemptStore(kv(), kv());
  const d = draft();
  const first = await sendOnce(store, d, async (u) => (/create-order$/.test(u) ? Promise.reject(new TypeError('x')) : res(404, { ok: true, exists: false })));
  const t1 = first.rec.lastSentAt;
  const p = await prepareAttempt(d, store); // same content -> same number
  await submitPrepared({ ...d, id: p.orderId }, p, store, opts, { fetch: async () => res(200, {}), isOnline: () => false, sleep: async () => {} });
  const rec = recordFor(store, p.orderId);
  assert.equal(rec.lastSentAt, t1, 'earlier send time kept');
  assert.equal(rec.state, 'uncertain');
});

// ------------------------------------------------------------------ identity on a shared device
test('a GUEST payload never carries a token, even if someone is signed in now (no order linked to the wrong account)', async () => {
  const headers = [];
  let asked = 0;
  const fetch = async (url, init) => {
    headers.push(init.headers || {});
    return res(200, { ok: true, orderId: JSON.parse(init.body).order.id, replay: false });
  };
  const store = localAttemptStore(kv(), kv());
  const { out } = await sendOnce(store, draft({ userId: 'guest' }), fetch, { getAuthToken: async () => { asked++; return 'token-of-B'; } });
  assert.equal(out.kind, 'confirmed');
  assert.equal('authorization' in headers[0], false);
  assert.equal(asked, 0, 'no token even requested for a guest order');
});

test('signed out / another account on this device: the earlier payload is NOT restored (and is dropped from the tab)', async () => {
  const store = localAttemptStore(kv(), kv());
  const session = kv();
  const payloads = pendingPayloadStore(session);
  const A = 'aliceUid000000000000000000A1';
  const d = draft({ userId: A });
  const a = await prepareAttempt(d, store);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 });
  payloads.set({ ...d, id: a.orderId });
  assert.equal((await restorablePayload(store, payloads, A)).id, a.orderId, 'same account: restored');
  assert.equal(await restorablePayload(store, payloads, 'bobUid00000000000000000000B1'), null, 'other account: not restored');
  assert.equal(session.getItem('anta_checkout_pending_payload'), null, 'and removed from this tab');
  payloads.set({ ...d, id: a.orderId });
  assert.equal(await restorablePayload(store, payloads, 'guest'), null, 'signed out: not restored');
  // the attempt record itself is kept (it may exist): only the personal payload is dropped
  assert.equal(recordFor(store, a.orderId).state, 'uncertain');
});

test('a deliberate NEW order after the previous one completed is never blocked (page opened after the confirmation)', async () => {
  const local = kv();
  const fetch = async (url, init) => res(200, { ok: true, orderId: JSON.parse(init.body).order.id, replay: false });
  const mk = () => ({ store: localAttemptStore(local, kv()), lock: createSubmitLock(), payloads: pendingPayloadStore(kv()), trackingKeys: trackingKeys(kv()) });
  const first = await placeOrder({ draft: draft(), ...mk(), opts, deps: { fetch }, openedAt: Date.now() - 10 });
  assert.equal(first.status, 'confirmed');
  await new Promise((r) => setTimeout(r, 5));
  const again = await placeOrder({ draft: draft(), ...mk(), opts, deps: { fetch }, openedAt: Date.now() }); // a newly opened page
  assert.equal(again.status, 'confirmed');
  assert.notEqual(again.orderId, first.orderId);
});

// ------------------------------------------------------------------ IndexedDB lock fencing: a frozen tab that resumes
test('IndexedDB lock: a tab frozen PAST its lease never takes the lock back; renewal fails, stillOwned() is false, its release does NOT clear the new owner', async () => {
  const idb = fakeIdb();
  let t = 1_000_000;
  const now = () => t;
  let gate;
  const frozen = new Promise((r) => (gate = r));
  const seen = {};
  const a = withIdbLock(async (stillOwned) => {
    seen.before = await stillOwned();
    await frozen; // tab A is frozen here
    seen.after = await stillOwned();
    seen.ownerWhenADone = idb.data.get('submit')?.owner;
    return 'a-done';
  }, idb, { leaseMs: 3_000, marginMs: 500, now, pollMs: 5 });
  await new Promise((r) => setTimeout(r, 20));
  const aOwner = idb.data.get('submit').owner;
  t += 10_000; // A's lease (3 s) expired while it was frozen
  let bOwner;
  const b = withIdbLock(async () => {
    bOwner = idb.data.get('submit').owner;
    gate(); // A resumes while B holds the lock
    await new Promise((r) => setTimeout(r, 1_150)); // A would renew here (interval max(1 s, lease/3)) and A releases
    return idb.data.get('submit');
  }, idb, { leaseMs: 60_000, now, pollMs: 5 });
  const [ra, held] = await Promise.all([a, b]);
  assert.equal(ra, 'a-done');
  assert.equal(seen.before, true);
  assert.equal(seen.after, false, 'A knows it lost the lock');
  assert.notEqual(bOwner, aOwner);
  assert.equal(seen.ownerWhenADone, bOwner);
  assert.equal(held.owner, bOwner, 'A neither renewed over nor released B\'s lease');
  assert.equal(idb.data.size, 0, 'B released its own lock at the end');
});

test('IndexedDB lock: an old owner\'s release never deletes a newer owner\'s lease', async () => {
  const idb = fakeIdb();
  let t = 5_000_000;
  const now = () => t;
  await withIdbLock(async () => {
    idb.data.set('submit', { owner: 'tab-B', until: t + 60_000 }); // A's lease replaced by B (expiry + takeover)
  }, idb, { leaseMs: 3_000, now });
  assert.deepEqual(idb.data.get('submit'), { owner: 'tab-B', until: t + 60_000 }, 'A\'s release kept B\'s lease');
});

// Another tab takes over right after this tab's lease is written (this tab froze between taking the lock and
// sending, its lease expired, tab B took it).
function stolenIdb() {
  const f = fakeIdb();
  const set = f.data.set.bind(f.data);
  f.data.set = (k, v) => { set(k, v); if (v.owner !== 'tab-B') set(k, { owner: 'tab-B', until: Date.now() + 600_000 }); return f.data; };
  return f;
}

test('lock LOST before sending (frozen tab resumed) -> nothing sent, the never-sent attempt is removed, the other tab keeps its lock; later: one order, one number', async () => {
  const local = kv();
  const idb = stolenIdb();
  const creates = [];
  const fetch = async (url, init) => { if (/create-order$/.test(url)) creates.push(JSON.parse(init.body).order.id); return res(200, { ok: true, orderId: JSON.parse(init.body).order.id, replay: false }); };
  const mk = () => ({ store: localAttemptStore(local, kv()), lock: createSubmitLock(), payloads: pendingPayloadStore(kv()), trackingKeys: trackingKeys(kv()) });
  const r = await placeOrder({ draft: draft(), ...mk(), opts, deps: { fetch }, locks: null, idb, openedAt: Date.now() - 10 });
  assert.deepEqual(r, { status: 'lock_unavailable', why: 'busy' });
  assert.equal(creates.length, 0, 'no create request');
  assert.deepEqual(localAttemptStore(local, kv()).all(), [], 'never-sent attempt removed (cannot exist on the Worker)');
  assert.equal(idb.data.get('submit').owner, 'tab-B', 'the other tab keeps its lock');
  const ok = await placeOrder({ draft: draft(), ...mk(), opts, deps: { fetch }, locks: null, idb: fakeIdb(), openedAt: Date.now() - 10 });
  assert.equal(ok.status, 'confirmed');
  assert.deepEqual(creates, [ok.orderId]);
});

test('lock lost AFTER the request left (tab froze mid-send) -> the next tab reuses the SAME number (Worker dedups), never a new one', async () => {
  const local = kv();
  const server = new Map(); // orderId -> created once (Worker idempotency)
  let creates = 0;
  const fetch = async (url, init) => {
    if (/create-order$/.test(url)) {
      const id = JSON.parse(init.body).order.id;
      if (!server.has(id)) { server.set(id, 1); creates++; throw new TypeError('tab frozen: the answer never arrived'); }
      return res(200, { ok: true, orderId: id, replay: true });
    }
    return res(404, { ok: true, exists: false });
  };
  const mk = () => ({ store: localAttemptStore(local, kv()), lock: createSubmitLock(), payloads: pendingPayloadStore(kv()), trackingKeys: trackingKeys(kv()) });
  const a = await placeOrder({ draft: draft(), ...mk(), opts, deps: { fetch }, locks: null, idb: fakeIdb(), openedAt: Date.now() - 10 });
  assert.notEqual(a.status, 'confirmed');
  const b = await placeOrder({ draft: draft(), ...mk(), opts, deps: { fetch }, locks: null, idb: fakeIdb(), openedAt: Date.now() - 10 });
  assert.equal(b.status, 'confirmed');
  assert.equal(b.orderId, a.orderId, 'same number');
  assert.equal(server.size, 1);
  assert.equal(creates, 1, 'one order, one stock deduction');
});

test('dropOpenUnsent removes ONLY an open, never-sent attempt; prepareAttempt prefers a possibly-sent attempt with the same content', async () => {
  const local = kv();
  const store = localAttemptStore(local, kv());
  const a = await prepareAttempt(draft(), store);
  const raw = JSON.parse(local.getItem(ATTEMPTS_V2_KEY));
  const b = await prepareAttempt(draft({ note: 'other content, only to get a 2nd valid number' }), localAttemptStore(kv(), kv()));
  const sent = { ...raw.attempts[0], orderId: b.orderId, lastSentAt: Date.now(), state: 'uncertain' };
  raw.attempts.push(sent); // same content, possibly sent (e.g. left by an old tab)
  local.setItem(ATTEMPTS_V2_KEY, JSON.stringify(raw));
  const s2 = localAttemptStore(local, kv());
  assert.ok(recordFor(s2, sent.orderId));
  assert.equal((await prepareAttempt(draft(), s2)).orderId, sent.orderId, 'the possibly-sent number is reused');
  assert.equal(dropOpenUnsent(s2, sent.orderId), false, 'a possibly-sent attempt is never removed');
  assert.equal(dropOpenUnsent(s2, a.orderId), true);
  assert.equal(recordFor(s2, a.orderId), null);
  assert.ok(recordFor(s2, sent.orderId));
});

// ------------------------------------------------------------------ shared device: account switch / guest who signs in
const savedFetch = (a) => async (url, init) => {
  if (/\/summary$/.test(url)) {
    return normalizeTrackingKey(init.headers['x-tracking-key']) === a.trackingKey
      ? res(200, { ok: true, order: { id: a.orderId, status: 'new', items: [{ name: 'Notebook' }] } })
      : res(404, { ok: false, code: 'NOT_FOUND' });
  }
  return res(200, { ok: true, exists: true, status: 'new' });
};
const A = 'aliceUid000000000000000000A1';
const B = 'bobUid00000000000000000000B1';

for (const [label, placedBy, nowUser] of [['account A -> account B', A, B], ['guest -> signs in', 'guest', B], ['account A -> signed out (guest)', A, 'guest']]) {
  test(`shared device (${label}): the saved attempt is NOT handed to the new identity (no key, no confirmation, new number); the device is no longer blocked; its OWNER keeps it and is told once back`, async () => {
    const local = kv();
    const store = localAttemptStore(local, kv());
    const a = await prepareAttempt(draft({ userId: placedBy }), store);
    recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 });
    assert.equal(recordFor(store, a.orderId).who, placedBy);
    const keysKv = kv();
    const keys = trackingKeys(keysKv);
    const confirmed = [];
    const out = await recoverPendingAttempts(localAttemptStore(local, kv()), opts, { fetch: savedFetch(a) }, keys, { add: (id) => confirmed.push(id) }, nowUser);
    assert.deepEqual(out, [{ orderId: a.orderId, state: 'exists_unverified' }], 'existence only, no details');
    assert.equal(keys.get(a.orderId, nowUser), null, 'the identity using the device now never gets the key');
    assert.equal(keys.get(a.orderId, placedBy), a.trackingKey, 'kept on the device, bound to its owner only');
    assert.deepEqual(confirmed, [], 'not marked confirmed for the identity using the device now');
    assert.deepEqual(takeOwnerNotices(localAttemptStore(local, kv()), nowUser, keys, { add() {} }), [], 'no notice for the other identity');
    const rec = recordFor(localAttemptStore(local, kv()), a.orderId);
    assert.equal(rec.state, 'confirmed', 'no longer blocks this device');
    assert.equal(rec.ownerNotice, true);
    // the new identity's own order: a NEW number (no ownership transfer of the earlier one)
    const mine = await prepareAttempt(draft({ userId: nowUser, note: 'B order' }), localAttemptStore(local, kv()));
    assert.equal(mine.ok, true);
    assert.notEqual(mine.orderId, a.orderId);
    // the owner is back on this device: told ONCE (number + their key), then never again
    const back = [];
    const notices = takeOwnerNotices(localAttemptStore(local, kv()), placedBy, keys, { add: (id) => back.push(id) });
    assert.deepEqual(notices, [{ orderId: a.orderId, state: 'recovered', trackingKey: a.trackingKey }]);
    assert.deepEqual(back, [a.orderId], 'confirmed on this device for its owner');
    assert.deepEqual(takeOwnerNotices(localAttemptStore(local, kv()), placedBy, keys, { add() {} }), [], 'shown once');
  });
}

test('shared device: the SAME identity still recovers its own attempt (key kept for it, confirmed)', async () => {
  const local = kv();
  const store = localAttemptStore(local, kv());
  const a = await prepareAttempt(draft({ userId: A }), store);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 });
  const keys = trackingKeys(kv());
  const out = await recoverPendingAttempts(localAttemptStore(local, kv()), opts, { fetch: savedFetch(a) }, keys, { add() {} }, A);
  assert.deepEqual(out.map((r) => r.state), ['recovered']);
  assert.equal(keys.get(a.orderId, A), a.trackingKey);
  assert.equal(keys.get(a.orderId, B), null, 'another account on this device never gets it');
  assert.equal(keys.get(a.orderId, 'guest'), null, 'nor a signed-out visitor');
});

test('an UNRESOLVED attempt of another identity (not on the server yet) keeps blocking a new number, and its payload is not restored', async () => {
  const local = kv();
  const store = localAttemptStore(local, kv());
  const session = kv();
  const payloads = pendingPayloadStore(session);
  const d = draft({ userId: A });
  const a = await prepareAttempt(d, store);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 });
  payloads.set({ ...d, id: a.orderId });
  assert.equal(await restorablePayload(store, payloads, B), null);
  const out = await recoverPendingAttempts(store, opts, { fetch: async (u) => (/summary$/.test(u) ? res(404, { ok: false }) : res(404, { ok: true, exists: false })) }, trackingKeys(kv()), { add() {} }, B);
  assert.deepEqual(out, [{ orderId: a.orderId, state: 'not_found_yet' }]);
  const p = await prepareAttempt(draft({ userId: B }), store);
  assert.equal(p.ok, false, 'B cannot get a new number while A\'s attempt may still be in flight (no duplicate)');
  assert.equal(p.previousOrderId, a.orderId);
});

test('device tracking keys: bound to the identity that stored them; old entries without an identity count as guest', () => {
  const s = kv();
  const keys = trackingKeys(s);
  const k = newTrackingKey();
  keys.add('ORD-AAAA1111-BBBB2222', k, A);
  assert.equal(keys.get('ORD-AAAA1111-BBBB2222', A), k);
  assert.equal(keys.get('ORD-AAAA1111-BBBB2222', B), null);
  assert.equal(keys.get('ORD-AAAA1111-BBBB2222'), null, 'default = guest');
  s.setItem('anta_tracking_keys', JSON.stringify([{ o: 'ORD-CCCC3333-DDDD4444', k }]));
  assert.equal(keys.get('ORD-CCCC3333-DDDD4444'), k);
  assert.equal(keys.get('ORD-CCCC3333-DDDD4444', A), null);
});

test('the owner identity survives every write of the real send path (write-ahead, outcome, resend)', async () => {
  const store = localAttemptStore(kv(), kv());
  const d = draft({ userId: A });
  const failing = async (u) => (/create-order$/.test(u) ? Promise.reject(new TypeError('x')) : res(404, { ok: true, exists: false }));
  const tok = { getAuthToken: async () => 'test-token' }; // a signed-in order is only sent with a token
  const first = await sendOnce(store, d, failing, tok);
  assert.equal(first.rec.who, A, 'after write-ahead + not_confirmed');
  const again = await sendOnce(store, d, async (u, init) => res(200, { ok: true, orderId: JSON.parse(init.body).order.id, replay: false }), tok);
  assert.equal(again.p.orderId, first.p.orderId);
  assert.equal(again.rec.state, 'confirmed');
  assert.equal(again.rec.who, A, 'after confirmation');
});

test('owner notices survive other identities\' later orders (kept apart from the 5 confirmed records), bounded', async () => {
  const local = kv();
  const store = localAttemptStore(local, kv());
  const a = await prepareAttempt(draft({ userId: A }), store);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 });
  await recoverPendingAttempts(localAttemptStore(local, kv()), opts, { fetch: savedFetch(a) }, trackingKeys(kv()), { add() {} }, B);
  for (let i = 0; i < MAX_CONFIRMED_KEPT + 3; i++) {
    const p = await prepareAttempt(draft({ userId: B, note: `B order ${i}` }), localAttemptStore(local, kv()));
    recordOutcome(localAttemptStore(local, kv()), p, { kind: 'confirmed', orderId: p.orderId, replay: false });
  }
  assert.equal(recordFor(localAttemptStore(local, kv()), a.orderId)?.ownerNotice, true, "A's notice is still there");
  assert.equal(takeOwnerNotices(localAttemptStore(local, kv()), A, trackingKeys(kv()), { add() {} }).length, 1);
});

test('a record of UNKNOWN owner (written before identities were recorded) recovered by someone: its key is dropped (nobody can be told safely)', async () => {
  const local = kv();
  const store = localAttemptStore(local, kv());
  const a = await prepareAttempt(draft(), store);
  recordOutcome(store, a, { kind: 'not_confirmed', orderId: a.orderId, reason: 'timeout', existsOnServer: null, attempts: 1 });
  const raw = JSON.parse(local.getItem(ATTEMPTS_V2_KEY));
  delete raw.attempts[0].who;
  local.setItem(ATTEMPTS_V2_KEY, JSON.stringify(raw));
  const keysKv = kv();
  const out = await recoverPendingAttempts(localAttemptStore(local, kv()), opts, { fetch: savedFetch(a) }, trackingKeys(keysKv), { add() {} }, B);
  assert.deepEqual(out, [{ orderId: a.orderId, state: 'exists_unverified' }]);
  assert.equal(keysKv.getItem('anta_tracking_keys'), null);
  assert.equal('trackingKey' in recordFor(localAttemptStore(local, kv()), a.orderId), false);
});

// ------------------------------------------------------------------ identity decided at the moment of sending
const okFetch = (seen) => async (url, init) => {
  seen.push({ url, auth: (init.headers || {}).authorization || null, userId: JSON.parse(init.body).order.userId });
  return res(200, { ok: true, orderId: JSON.parse(init.body).order.id, replay: false });
};
const mkFlow = (local = kv()) => ({ store: localAttemptStore(local, kv()), lock: createSubmitLock(), payloads: pendingPayloadStore(kv()), trackingKeys: trackingKeys(kv()) });

test('identity UNKNOWN at the moment of sending (session restore slow/failed): nothing sent, no attempt created, no number', async () => {
  const local = kv();
  const seen = [];
  const r = await placeOrder({ draft: draft(), ...mkFlow(local), opts, deps: { fetch: okFetch(seen) }, identity: async () => null });
  assert.deepEqual(r, { status: 'identity_unknown' });
  assert.equal(seen.length, 0);
  assert.deepEqual(localAttemptStore(local, kv()).all(), [], 'no attempt record');
  assert.match(messageFor(r).bodyAr, /لم نُرسل الطلب/);
  assert.deepEqual(messageFor(r).actions, ['check_identity']);
});

test('a signed-in customer whose session was restored AFTER the form was built: sent under the account (with its token), never as a guest', async () => {
  const seen = [];
  const r = await placeOrder({
    draft: draft({ userId: 'guest' }), // built while the session was still being restored
    ...mkFlow(), opts: { ...opts, getAuthToken: async () => 'token-of-A' }, deps: { fetch: okFetch(seen) },
    identity: async () => A,
  });
  assert.equal(r.status, 'confirmed');
  assert.equal(r.payload.userId, A);
  assert.equal(seen[0].userId, A);
  assert.equal(seen[0].auth, 'Bearer token-of-A');
});

test('a CONFIRMED guest (no session after the check) orders normally, no token', async () => {
  const seen = [];
  let asked = 0;
  const r = await placeOrder({ draft: draft({ userId: A }), ...mkFlow(), opts: { ...opts, getAuthToken: async () => { asked++; return 'x'; } }, deps: { fetch: okFetch(seen) }, identity: async () => 'guest' });
  assert.equal(r.status, 'confirmed');
  assert.equal(seen[0].userId, 'guest', 'a stale uid in the form is not used either');
  assert.equal(seen[0].auth, null);
  assert.equal(asked, 0);
});

test('account switched since the page opened: nothing sent (account_changed); confirming again under the current account works', async () => {
  const local = kv();
  const seen = [];
  const flow = mkFlow(local);
  const tokenOpts = { ...opts, getAuthToken: async () => 'token-of-B' };
  const r = await placeOrder({ draft: draft(), ...flow, opts: tokenOpts, deps: { fetch: okFetch(seen) }, identity: async () => B, expectedIdentity: A });
  assert.deepEqual(r, { status: 'account_changed', orderId: '', current: B });
  assert.equal(seen.length, 0);
  assert.deepEqual(localAttemptStore(local, kv()).all(), []);
  const again = await placeOrder({ draft: draft(), ...mkFlow(local), opts: tokenOpts, deps: { fetch: okFetch(seen) }, identity: async () => B, expectedIdentity: B });
  assert.equal(again.status, 'confirmed');
  assert.equal(seen[0].userId, B);
});

test("a pending payload of account A is never resent under account B (retry with the same number refused, nothing sent)", async () => {
  const local = kv();
  const seen = [];
  const a = await prepareAttempt(draft({ userId: A }), localAttemptStore(local, kv()));
  const lastPayload = { ...draft({ userId: A }), id: a.orderId };
  const r = await retrySameOrder({ ...mkFlow(local), opts: { ...opts, getAuthToken: async () => 'token-of-B' }, deps: { fetch: okFetch(seen) }, lastPayload, identity: async () => B });
  assert.deepEqual(r, { status: 'account_changed', orderId: a.orderId, current: B });
  assert.equal(seen.length, 0);
  assert.equal(recordFor(localAttemptStore(local, kv()), a.orderId).lastSentAt, null, "A's attempt untouched");
});
