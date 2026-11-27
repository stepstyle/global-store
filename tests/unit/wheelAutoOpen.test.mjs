// Why a NEW visitor did not get the wheel popup, and the rules that fix it (no browser needed):
//   - "seen" survives only for the campaign it was shown for; a new campaign (same prizes or not) opens it again
//   - storage refused: never "seen for ever" (the old code answered "seen" on any storage error = never opened)
//   - the campaign check can start from index.html (early request) and is handed to the app ONCE
//   node --test tests/unit/wheelAutoOpen.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.__WHEEL_MODE__ = 'live';
const store = new Map();
const goodStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.localStorage = goodStorage;
const W = await import('../../src/services/wheel.ts');
const { wheelEarlyScript } = await import('../../scripts/wheel-early.mjs');

const slots = [{ id: 'disc-1', label: 'خصم دينار', type: 'discount' }, { id: 'none-1', label: 'حظ أوفر', type: 'none' }];
const camp = { slots, terms: '', minOrderJod: 5 };
beforeEach(() => { store.clear(); globalThis.localStorage = goodStorage; W.__resetPopupSeenMemory(); });

test('a Worker that sends the campaign id: a NEW campaign with the SAME prizes is a new fingerprint (opens once more)', () => {
  const a = W.campaignFingerprint({ ...camp, campaignId: 'wheel-2026-11', startsAt: '2026-11-21T00:00:00.000Z' });
  const b = W.campaignFingerprint({ ...camp, campaignId: 'wheel-2026-12', startsAt: '2026-12-01T00:00:00.000Z' });
  const a2 = W.campaignFingerprint({ ...camp, campaignId: 'wheel-2026-11', startsAt: '2026-11-21T00:00:00.000Z' });
  const restarted = W.campaignFingerprint({ ...camp, campaignId: 'wheel-2026-11', startsAt: '2026-11-27T00:00:00.000Z' });
  assert.equal(a, a2);
  assert.notEqual(a, b);
  assert.notEqual(a, restarted, 'the same campaign id started again (new start date) = a new campaign');
  // other prizes / terms of the same campaign: new too (unchanged rule: the visitor sees what changed, once)
  assert.notEqual(a, W.campaignFingerprint({ ...camp, terms: 'شروط جديدة', campaignId: 'wheel-2026-11', startsAt: '2026-11-21T00:00:00.000Z' }));
  // a Worker that starts sending the id gives one more popup to visitors of the current campaign (accepted, once)
  assert.notEqual(a, W.campaignFingerprint(camp));
});

test('an older Worker (no id): a campaign seen CLOSED clears the flag, so the next one opens even with the same prizes', () => {
  const fp = W.campaignFingerprint(camp);
  W.markPopupSeenFor(fp);
  assert.equal(W.popupSeenFor(fp), true);
  W.forgetPopupSeen(); // the popup's check saw campaign !== 'open'
  W.__resetPopupSeenMemory();
  assert.equal(W.popupSeenFor(fp), false);
});

test('storage refused: NOT "seen" (the old code said seen = the popup never opened); once shown, seen for this page', () => {
  const boom = () => { throw new Error('SecurityError'); };
  globalThis.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
  const fp = W.campaignFingerprint(camp);
  assert.equal(W.popupSeenFor(fp), false, 'a new visitor with blocked storage gets the popup');
  assert.doesNotThrow(() => W.markPopupSeenFor(fp));
  assert.equal(W.popupSeenFor(fp), true, 'not again on the next page of this visit');
  assert.doesNotThrow(() => W.forgetPopupSeen());
});

test('the answer of /wheel/public carries campaignId / startsAt when sent; a strange id is ignored', async () => {
  const body = (extra) => ({ ok: true, campaign: 'open', slots: [{ id: 'a', type: 'discount', label: 'x' }, { id: 'b', type: 'none', label: 'y' }], minOrderJod: 5, prizeHoldMinutes: 60, terms: '', ...extra });
  const deps = (b) => ({ fetch: async () => ({ status: 200, text: async () => JSON.stringify(b) }) });
  const ok = await W.fetchWheelPublic('https://w.example', deps(body({ campaignId: 'wheel-2026-11', startsAt: '2026-11-21T00:00:00.000Z' })));
  assert.equal(ok.value.campaignId, 'wheel-2026-11');
  assert.equal(ok.value.startsAt, '2026-11-21T00:00:00.000Z');
  const bad = await W.fetchWheelPublic('https://w.example', deps(body({ campaignId: '<script>', startsAt: 'x'.repeat(99) })));
  assert.equal(bad.value.campaignId, null);
  assert.equal(bad.value.startsAt, null);
  const old = await W.fetchWheelPublic('https://w.example', deps(body({})));
  assert.equal(old.value.campaignId, null);
});

test('the early request from index.html is used as the FIRST answer (no second request); a failed one is asked again', async () => {
  // fresh module state per case: a new import URL
  const run = async (early) => {
    const M = await import(`../../src/services/wheel.ts?case=${Math.random()}`);
    let calls = 0;
    const deps = { fetch: async () => { calls++; return { status: 200, text: async () => JSON.stringify({ ok: true, campaign: 'open', slots: [{ id: 'a', type: 'none', label: 'x' }, { id: 'b', type: 'none', label: 'y' }], minOrderJod: 5, prizeHoldMinutes: 60, terms: 'app' }) }; } };
    globalThis.window = { __wheelPublicEarly: early };
    M.prefetchWheelPublic('https://w.example', deps);
    M.prefetchWheelPublic('https://w.example', deps); // a second mount: still one request
    const r = await M.takePrefetchedWheelPublic();
    delete globalThis.window;
    return { r, calls };
  };
  const earlyOk = Promise.resolve({ status: 200, text: async () => JSON.stringify({ ok: true, campaign: 'open', slots: [{ id: 'a', type: 'none', label: 'x' }, { id: 'b', type: 'none', label: 'y' }], minOrderJod: 5, prizeHoldMinutes: 60, terms: 'early' }) });
  const a = await run(earlyOk);
  assert.equal(a.r.value.terms, 'early');
  assert.equal(a.calls, 0, 'the app did not ask again');
  const b = await run(Promise.resolve(null)); // the early request failed (network)
  assert.equal(b.r.value.terms, 'app');
  assert.equal(b.calls, 1);
  const c = await run(undefined); // no early request (an older page / a sandbox build)
  assert.equal(c.r.value.terms, 'app');
  assert.equal(c.calls, 1);
});

test('the early script: production https Worker or local-test loopback only; never sandbox; wheel off = nothing', () => {
  const live = wheelEarlyScript({ wheelMode: 'live', deployEnv: 'production', workerUrl: 'https://anta-order-v2.example.workers.dev/' });
  assert.match(live, /^<script>try\{window\.__wheelPublicEarly=fetch\("https:\/\/anta-order-v2\.example\.workers\.dev\/wheel\/public"\)/);
  assert.ok(!/headers|credentials|POST/.test(live), 'a plain GET, exactly like the app');
  assert.equal(wheelEarlyScript({ wheelMode: 'off', deployEnv: 'production', workerUrl: 'https://w.example' }), '');
  assert.equal(wheelEarlyScript({ wheelMode: 'live', deployEnv: 'sandbox', workerUrl: 'https://w.example' }), '');
  assert.equal(wheelEarlyScript({ wheelMode: 'live', deployEnv: 'production', workerUrl: 'http://w.example' }), '', 'no plain http in production');
  assert.equal(wheelEarlyScript({ wheelMode: 'live', deployEnv: 'production', workerUrl: 'https://w.example/"></script><script>alert(1)' }), '', 'nothing odd is written into the page');
  assert.equal(wheelEarlyScript({ wheelMode: 'test', deployEnv: 'local-test', workerUrl: 'https://w.example' }), '', 'local-test: a LOCAL Worker only');
  assert.match(wheelEarlyScript({ wheelMode: 'test', deployEnv: 'local-test', workerUrl: 'http://127.0.0.1:8787' }), /127\.0\.0\.1:8787\/wheel\/public/);
});
