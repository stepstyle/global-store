// S13–S21: the web app's submission module (src/services/orderSubmit.ts) against the REAL local order Worker v2
// + Firestore emulator. Faults are injected by the local chaos proxy in inner.mjs (127.0.0.1 only):
//   /chaos/drop/*        connection destroyed (network error)       /chaos/hang/*  never answers (timeout)
//   /chaos/500/*         always 500                                 /chaos/fail-first/*  first create 503, then proxy
//   /chaos/429once/*     first create 429 (Retry-After: 1), then proxy
//   /chaos/slow/*        first create: the Worker commits but the RESPONSE is held past the client timeout
//   /chaos/slow403/*     like slow, then the 2nd create gets 403 (single-use Turnstile token consumed)
//   /chaos/slow403drop/* like slow403 and every status request is dropped
//   /chaos/hangcreate/*  creates never answer, status works        /chaos/hangfirst/*  only the 1st create hangs

import assert from 'node:assert/strict';
import { submitOrder, submitPrepared, prepareAttempt, recordOutcome, sessionAttemptStore, trackingKeyHash, newTrackingKey, fetchOrderSummary, fetchOrderStatus } from '../../../../src/services/orderSubmit.ts';
import { checkoutOrder } from '../fixtures.mjs';

const memStore = () => {
  const m = new Map();
  return sessionAttemptStore({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) });
};

export function buildSubmitScenarios(ctx) {
  const { W, MOCK, get } = ctx;
  const createLog = ctx.createLog || [];
  const deps = {
    // the guarded local-only fetch; create POSTs are only recorded (never delayed) for pacing between scenarios
    fetch: (url, init) => {
      if (init?.method === 'POST' && /\/create-order$/.test(String(url))) createLog.push(Date.now());
      return globalThis.fetch(url, init);
    },
  };
  const opts = (workerUrl, over = {}) => ({
    workerUrl, turnstileToken: ctx.turnstileToken, timeoutMs: 4000, maxAttempts: 3, backoffMs: [300, 600], statusChecks: 2, statusDelayMs: 500, ...over,
  });
  const chaos = (mode) => `${MOCK}/chaos/${mode}`;
  const stock = async (pid) => (await get(`products/${pid}`))?.stock;
  const created = async (id) => ({ order: await get(`orders/${id}`), ledger: await get(`orderLedger/${id}`) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  return [
    ['S13', 'orderSubmit -> local Worker: confirmed only after a real success; stock once', async () => {
      const o = checkoutOrder();
      const r = await submitOrder(o, opts(W), deps);
      assert.deepEqual([r.kind, r.via, r.replay], ['confirmed', 'create', false], JSON.stringify(r));
      const c = await created(o.id);
      assert.ok(c.order && c.ledger, 'order + ledger in the emulator');
      assert.equal(await stock('p-simple'), 8);
    }],
    ['S14', 'double submit (two parallel calls, same order) -> one order, one stock deduction', async () => {
      const o = checkoutOrder();
      const rs = await Promise.all([submitOrder(o, opts(W), deps), submitOrder(o, opts(W), deps)]);
      assert.ok(rs.every((r) => r.kind === 'confirmed'), JSON.stringify(rs));
      assert.ok(rs.some((r) => r.replay === true || r.via === 'status'), 'the second one is a replay');
      assert.equal(await stock('p-simple'), 8, 'deducted once');
    }],
    ['S15', 'transient 503 then success -> retried with the SAME id; one order', async () => {
      const o = checkoutOrder();
      const r = await submitOrder(o, opts(chaos('fail-first')), deps);
      assert.deepEqual([r.kind, r.attempts], ['confirmed', 2], JSON.stringify(r));
      assert.equal(r.orderId, o.id);
      assert.equal(await stock('p-simple'), 8);
    }],
    ['S16', 'timeout while the Worker commits -> status exists -> VERIFIED by resend (replay), same id, stock once', async () => {
      const o = checkoutOrder();
      const r = await submitOrder(o, opts(chaos('slow'), { timeoutMs: 500, maxAttempts: 1, statusChecks: 3, statusDelayMs: 1500 }), deps);
      assert.deepEqual([r.kind, r.via, r.replay, r.orderId], ['confirmed', 'verify', true, o.id], JSON.stringify(r));
      const again = await submitOrder(o, opts(W), deps); // a later manual retry of the same order
      assert.deepEqual([again.kind, again.replay], ['confirmed', true]);
      assert.equal(await stock('p-simple'), 8, 'deducted once');
    }],
    ['S17', 'Worker unreachable (connection dropped) -> not_confirmed (no fake success), nothing created; retry later = one order', async () => {
      const o = checkoutOrder();
      const r = await submitOrder(o, opts(chaos('drop')), deps);
      assert.deepEqual([r.kind, r.reason, r.existsOnServer, r.orderId], ['not_confirmed', 'network', null, o.id], JSON.stringify(r));
      await sleep(500);
      const c = await created(o.id);
      assert.equal(c.order, null);
      assert.equal(c.ledger, null);
      assert.equal(await stock('p-simple'), 10, 'nothing deducted');
      const later = await submitOrder(o, opts(W), deps); // same number, same payload
      assert.deepEqual([later.kind, later.replay], ['confirmed', false]);
      assert.equal(await stock('p-simple'), 8);
    }],
    ['S18', '409: same order number with different content -> conflict, original untouched', async () => {
      const o = checkoutOrder();
      assert.equal((await submitOrder(o, opts(W), deps)).kind, 'confirmed');
      const tampered = { ...o, address: { ...o.address, phone: '+962780000000' } };
      const r = await submitOrder(tampered, opts(W), deps);
      assert.deepEqual([r.kind, r.code, r.existsOnServer, r.attempts], ['conflict', 'ORDER_EXISTS', true, 1], JSON.stringify(r));
      assert.equal((await get(`orders/${o.id}`)).address.phone, '+962791234567');
      assert.equal(await stock('p-simple'), 8);
    }],
    ['S19', '429 (Retry-After) -> waits, then confirmed with the same id', async () => {
      const o = checkoutOrder();
      const t0 = Date.now();
      const r = await submitOrder(o, opts(chaos('429once')), deps);
      assert.deepEqual([r.kind, r.attempts], ['confirmed', 2], JSON.stringify(r));
      assert.ok(Date.now() - t0 >= 900, 'honoured Retry-After: 1');
      assert.equal(await stock('p-simple'), 8);
    }],
    ['S20', '500 on every attempt -> not_confirmed (server), nothing created', async () => {
      const o = checkoutOrder();
      const r = await submitOrder(o, opts(chaos('500')), deps);
      assert.deepEqual([r.kind, r.reason, r.attempts], ['not_confirmed', 'server', 3], JSON.stringify(r));
      assert.equal((await created(o.id)).ledger, null);
      assert.equal(await stock('p-simple'), 10);
    }],
    ['S21', '400 invalid order -> rejected at once, nothing created, no retry', async () => {
      const o = { ...checkoutOrder(), items: [] };
      const r = await submitOrder(o, opts(W), deps);
      assert.deepEqual([r.kind, r.status, r.code, r.attempts], ['rejected', 400, 'INVALID_ORDER', 1], JSON.stringify(r));
      assert.equal((await created(o.id)).ledger, null);
    }],
    ['S22', 'Worker hangs (no answer) -> timeout -> not_confirmed, never success', async () => {
      const o = checkoutOrder();
      const r = await submitOrder(o, opts(chaos('hang'), { timeoutMs: 400, maxAttempts: 2, statusChecks: 1, statusDelayMs: 100 }), deps);
      assert.deepEqual([r.kind, r.reason, r.existsOnServer], ['not_confirmed', 'timeout', null], JSON.stringify(r));
      assert.equal((await created(o.id)).ledger, null);
    }],
    ['S23', 'ADDRESS changed after an uncertain attempt -> refused (no same number with other data, no new number); same data -> same number', async () => {
      const store = memStore();
      const draft = checkoutOrder();
      const p1 = await prepareAttempt(draft, store);
      const o = { ...draft, id: p1.orderId };
      const r1 = await submitOrder(o, opts(chaos('drop'), { statusChecks: 1, statusDelayMs: 100 }), deps);
      recordOutcome(store, p1, r1);
      assert.equal(r1.kind, 'not_confirmed');
      for (const changed of [
        { ...draft, address: { ...draft.address, street: 'Corrected Street 5' } },
        { ...draft, address: { ...draft.address, fullName: 'Corrected Name' } },
        { ...draft, note: 'corrected note' },
      ]) {
        const p2 = await prepareAttempt(changed, store);
        assert.deepEqual(p2, { ok: false, reason: 'previous_unresolved', previousOrderId: p1.orderId, openOrderIds: [p1.orderId] });
      }
      const p3 = await prepareAttempt({ ...draft, createdAt: 'rebuilt later' }, store); // same content
      assert.deepEqual([p3.ok, p3.reused, p3.orderId], [true, true, p1.orderId]);
      const r3 = await submitOrder(o, opts(W), deps);
      recordOutcome(store, p3, r3);
      assert.deepEqual([r3.kind, r3.replay], ['confirmed', false]);
      assert.equal((await get(`orders/${o.id}`)).address.street, draft.address.street, 'stored with the ORIGINAL data');
      assert.equal(await stock('p-simple'), 8);
    }],
    ['S24', 'Turnstile token consumed: timeout (saved), then 403 -> status exists -> verify with a fresh token -> confirmed, stock once', async () => {
      const o = checkoutOrder();
      let n = 0;
      const r = await submitOrder(o, opts(chaos('slow403'), { timeoutMs: 600, statusChecks: 3, statusDelayMs: 1500, getTurnstileToken: async () => { n++; return ctx.turnstileToken; } }), deps);
      assert.deepEqual([r.kind, r.via, r.replay], ['confirmed', 'verify', true], JSON.stringify(r));
      assert.equal(n, 3, 'a token was requested for every send');
      assert.equal(await stock('p-simple'), 8, 'deducted once');
    }],
    ['S25', 'Turnstile token consumed + status unreachable -> not_confirmed (NOT rejected), number kept; later retry = replay, no duplicate', async () => {
      const store = memStore();
      const draft = checkoutOrder();
      const p = await prepareAttempt(draft, store);
      const o = { ...draft, id: p.orderId };
      const r = await submitOrder(o, opts(chaos('slow403drop'), { timeoutMs: 600, statusChecks: 2, statusDelayMs: 300 }), deps);
      recordOutcome(store, p, r);
      assert.deepEqual([r.kind, r.lastCode, r.existsOnServer], ['not_confirmed', 'TURNSTILE_FAILED', null], JSON.stringify(r));
      assert.deepEqual([store.get().state, store.get().orderId], ['uncertain', p.orderId], 'number NOT cleared');
      await sleep(2500);
      const later = await submitOrder(o, opts(W), deps);
      assert.deepEqual([later.kind, later.replay], ['confirmed', true], 'it HAD been saved: a new number would have duplicated it');
      assert.equal(await stock('p-simple'), 8);
    }],
    ['S26', 'order document WITHOUT ledger (browser write): status exists is NOT success; verify -> Worker processes it', async () => {
      // (a) creates never reach the Worker: exists:true alone must stay not_confirmed
      const a = checkoutOrder();
      await ctx.seedOrderDoc(a);
      const ra = await submitOrder(a, opts(chaos('hangcreate'), { timeoutMs: 400, maxAttempts: 2, statusChecks: 1, statusDelayMs: 100 }), deps);
      assert.deepEqual([ra.kind, ra.reason, ra.existsOnServer], ['not_confirmed', 'unverified', true], JSON.stringify(ra));
      assert.equal((await get(`orderLedger/${a.id}`)), null, 'never processed by the Worker');
      assert.equal(await stock('p-simple'), 10, 'nothing deducted');
      // (b) the verification resend reaches the Worker: it adopts the document (ledger + stock) -> confirmed
      const b = checkoutOrder();
      await ctx.seedOrderDoc(b);
      const rb = await submitOrder(b, opts(chaos('hangfirst'), { timeoutMs: 400, maxAttempts: 1, statusChecks: 1, statusDelayMs: 100 }), deps);
      assert.deepEqual([rb.kind, rb.via], ['confirmed', 'verify'], JSON.stringify(rb));
      assert.equal((await get(`orderLedger/${b.id}`)).mode, 'adopted');
      assert.equal(await stock('p-simple'), 8);
    }],
    ['S27', 'THREE SEPARATE CALLS, one attempt store: saved-but-lost answer -> later call gets 403 -> number kept -> final call = replay', async () => {
      const store = memStore();
      const draft = checkoutOrder();
      const p = await prepareAttempt(draft, store);
      const o = { ...draft, id: p.orderId };
      const via = chaos('slow403drop'); // create #1 commits but its answer is held; create #2 = 403; status dropped
      const c1 = await submitPrepared(o, p, store, opts(via, { timeoutMs: 600, maxAttempts: 1, statusChecks: 1, statusDelayMs: 200 }), deps);
      assert.deepEqual([c1.kind, store.get().state], ['not_confirmed', 'uncertain'], JSON.stringify(c1));
      const c2 = await submitPrepared(o, p, store, opts(via, { maxAttempts: 1, statusChecks: 1, statusDelayMs: 200 }), deps); // separate call, 403
      assert.deepEqual([c2.kind, c2.lastCode], ['not_confirmed', 'TURNSTILE_FAILED'], `call 2 must not be "rejected": ${JSON.stringify(c2)}`);
      assert.deepEqual([store.get().state, store.get().orderId], ['uncertain', p.orderId], 'number survives call 2');
      assert.equal((await prepareAttempt({ ...draft, note: 'changed' }, store)).ok, false, 'a different order is still refused');
      await sleep(2500);
      const c3 = await submitPrepared(o, p, store, opts(W), deps);
      assert.deepEqual([c3.kind, c3.replay], ['confirmed', true], 'call 1 HAD saved it — a new number would have duplicated it');
      assert.equal(store.get().state, 'confirmed');
      assert.equal(await stock('p-simple'), 8, 'deducted once');
    }],

    // ---------------- signed-in customers: Firebase ID token verified by the REAL Worker runtime (workerd) ----------------
    ['S28', 'signed-in: valid ID token -> order linked to the verified uid, stock once', async () => {
      const uid = 'aliceUidE2E00000000000000001';
      const o = checkoutOrder({ userId: uid });
      const r = await submitOrder(o, opts(W, { getAuthToken: async () => ctx.idToken(uid) }), deps);
      assert.equal(r.kind, 'confirmed', JSON.stringify(r));
      const { order, ledger } = await created(o.id);
      assert.equal(order.userId, uid);
      assert.equal(order.userIdVerified, true);
      assert.equal(ledger.userIdSource, 'firebase-id-token');
      assert.equal(await stock('p-simple'), 8);
    }],
    ['S29', 'signed-in: EXPIRED token -> refreshed once, same number and payload -> one order for the uid', async () => {
      const uid = 'aliceUidE2E00000000000000002';
      const o = checkoutOrder({ userId: uid });
      const asks = [];
      const getAuthToken = async (force) => {
        asks.push(force);
        return force ? ctx.idToken(uid) : ctx.idToken(uid, { nowSec: Math.floor(Date.now() / 1000) - 7200 });
      };
      const r = await submitOrder(o, opts(W, { getAuthToken }), deps);
      assert.equal(r.kind, 'confirmed', JSON.stringify(r));
      assert.deepEqual(asks, [false, true]);
      assert.equal((await get(`orders/${o.id}`)).userId, uid);
      assert.equal(await stock('p-simple'), 8, 'deducted once');
    }],
    ['S30', 'signed-in: FORGED token -> auth_required, nothing written, attempt kept; valid token later -> same number', async () => {
      const uid = 'aliceUidE2E00000000000000003';
      const store = memStore();
      const draft = checkoutOrder({ userId: uid });
      delete draft.id;
      const p = await prepareAttempt(draft, store);
      const o = { ...draft, id: p.orderId };
      const r1 = await submitPrepared(o, p, store, opts(W, { getAuthToken: async () => ctx.forgedToken(uid) }), deps);
      assert.deepEqual([r1.kind, r1.code], ['auth_required', 'AUTH_INVALID'], JSON.stringify(r1));
      const none = await created(o.id);
      assert.equal(none.order, null, 'no order');
      assert.equal(none.ledger, null, 'no ledger');
      assert.equal(await stock('p-simple'), 10, 'stock untouched');
      assert.equal(store.get().orderId, p.orderId, 'attempt kept');
      const r2 = await submitPrepared(o, p, store, opts(W, { getAuthToken: async () => ctx.idToken(uid) }), deps);
      assert.deepEqual([r2.kind, r2.orderId], ['confirmed', p.orderId], JSON.stringify(r2));
      assert.equal((await get(`orders/${o.id}`)).userId, uid);
    }],
    ['S31', 'signed-in order but no token (signed out) -> auth_required, NOTHING sent; token of another project -> refused', async () => {
      const uid = 'aliceUidE2E00000000000000004';
      const o = checkoutOrder({ userId: uid });
      const r1 = await submitOrder(o, opts(W, { getAuthToken: async () => null }), deps);
      assert.deepEqual([r1.kind, r1.code], ['auth_required', 'AUTH_TOKEN_UNAVAILABLE']);
      const other = await submitOrder(o, opts(W, { getAuthToken: async () => ctx.idToken(uid, { extra: { aud: 'demo-other', iss: 'https://securetoken.google.com/demo-other' } }) }), deps);
      assert.deepEqual([other.kind, other.code], ['auth_required', 'AUTH_INVALID'], JSON.stringify(other));
      assert.equal((await created(o.id)).order, null, 'never saved, never as guest');
      assert.equal(await stock('p-simple'), 10);
    }],
    ['S32', 'guest without token still buys (unchanged); owner never changes when the same order is resent with a token', async () => {
      const o = checkoutOrder({ userId: 'guest' });
      const r1 = await submitOrder(o, opts(W, { getAuthToken: async () => null }), deps);
      assert.equal(r1.kind, 'confirmed');
      const r2 = await submitOrder(o, opts(W, { getAuthToken: async () => ctx.idToken('malloryUidE2E000000000000001') }), deps);
      assert.deepEqual([r2.kind, r2.replay], ['confirmed', true]);
      assert.equal((await get(`orders/${o.id}`)).userId, 'guest', 'owner unchanged');
      assert.equal(await stock('p-simple'), 8, 'deducted once');
    }],
    ['S33', 'replay of an OWNED order: other account / no token -> 409 ORDER_EXISTS (identical, never "confirmed"); owner -> replay; one order, stock once', async () => {
      const alice = 'aliceUidE2E00000000000000033';
      const mallory = 'malloryUidE2E000000000000033';
      const o = checkoutOrder({ userId: alice });
      const first = await submitOrder(o, opts(W, { getAuthToken: async () => ctx.idToken(alice) }), deps);
      assert.equal(first.kind, 'confirmed', JSON.stringify(first));
      assert.equal((await get(`orderLedger/${o.id}`)).ownerUid, alice);
      // same tab, other account signed in, same frozen payload (e.g. an answer was lost before the switch)
      const other = await submitOrder(o, opts(W, { getAuthToken: async () => ctx.idToken(mallory), mayHaveBeenSavedBefore: true }), deps);
      assert.deepEqual([other.kind, other.code], ['conflict', 'ORDER_EXISTS'], JSON.stringify(other));
      // raw requests: no token / other account, matching and non-matching payloads -> byte-identical answers
      const raw = async (order, token) => {
        const r = await globalThis.fetch(`${W}/create-order`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ order, turnstileToken: ctx.turnstileToken }),
        });
        return `${r.status} ${await r.text()}`;
      };
      const changed = { ...o, address: { ...o.address, phone: '+962790003333' } };
      const answers = [await raw(o), await raw(changed), await raw(o, await ctx.idToken(mallory)), await raw(changed, await ctx.idToken(mallory))];
      assert.ok(answers.every((a) => a === '409 {"ok":false,"code":"ORDER_EXISTS"}'), answers.join(' | '));
      // the owner still gets an idempotent confirmation
      const again = await submitOrder(o, opts(W, { getAuthToken: async () => ctx.idToken(alice) }), deps);
      assert.deepEqual([again.kind, again.replay], ['confirmed', true]);
      const { order, ledger } = await created(o.id);
      assert.equal(order.userId, alice, 'owner unchanged');
      assert.equal(ledger.ownerUid, alice);
      assert.equal(await stock('p-simple'), 8, 'deducted once');
    }],
    ['S34', 'tracking key: create answer LOST (saved, answer held) -> verified by resend -> the browser\'s key opens the summary; other keys and the number alone do not', async () => {
      const store = memStore();
      const draft = checkoutOrder();
      delete draft.id;
      const p = await prepareAttempt(draft, store);
      const o = { ...draft, id: p.orderId };
      const tkh = await trackingKeyHash(p.trackingKey);
      // first create commits but its answer is held past the client timeout; the verify resend replays
      const r = await submitPrepared(o, p, store, opts(chaos('slow'), { timeoutMs: 1200, trackingKeyHash: tkh }), deps);
      assert.deepEqual([r.kind, r.orderId], ['confirmed', p.orderId], JSON.stringify(r));
      assert.equal((await get(`orderLedger/${o.id}`)).trackingKeyHash, tkh, 'hash stored once, from the first (lost) answer');
      const ok = await fetchOrderSummary(o.id, { key: p.trackingKey }, opts(W), deps);
      assert.equal(ok.kind, 'ok');
      assert.equal(JSON.stringify(ok.order).includes(o.address.phone), false);
      assert.equal((await fetchOrderSummary(o.id, { key: newTrackingKey() }, opts(W), deps)).kind, 'denied');
      assert.equal((await fetchOrderSummary(o.id, {}, opts(W), deps)).kind, 'denied');
      assert.deepEqual(await fetchOrderStatus(o.id, opts(W), deps), { exists: true, status: 'new' });
      assert.equal(await stock('p-simple'), 8, 'deducted once');
    }],
  ];
}

// The local Worker limits creates to 20 / 60 s per client IP (as on staging). Each scenario sends at most ~5,
// so before a scenario we wait until the last 61 s hold at most 13 creates.
const WINDOW_MS = 61_000;
const MAX_IN_WINDOW_BEFORE_SCENARIO = 13;
async function paceCreates(log) {
  for (;;) {
    const now = Date.now();
    while (log.length && now - log[0] >= WINDOW_MS) log.shift();
    if (log.length <= MAX_IN_WINDOW_BEFORE_SCENARIO) return;
    await new Promise((r) => setTimeout(r, log[0] + WINDOW_MS - now + 50));
  }
}

export async function runSubmitScenarios(ctx) {
  const results = [];
  const createLog = [];
  for (const [id, name, fn] of buildSubmitScenarios({ ...ctx, createLog })) {
    if (ctx.only && !ctx.only.has(id)) continue;
    await paceCreates(createLog);
    await ctx.reseed();
    const t0 = Date.now();
    try {
      await fn();
      results.push({ id, name, ok: true, ms: Date.now() - t0 });
      console.log(`✔ ${id} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      results.push({ id, name, ok: false, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 800) });
      console.log(`✖ ${id} ${name}\n    ${String(e?.message || e).split('\n')[0]}`);
    }
  }
  return results;
}
