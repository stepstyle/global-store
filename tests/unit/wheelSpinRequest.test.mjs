// Prize wheel — what the browser SENDS for a spin and how every answer is explained (a LIVE build: the constant the
// Vite build folds in is set here before the module loads). Fake fetch only: nothing leaves this process.
// Production failure of 2026-11-22: the signed-in spin went without a Turnstile token -> 403 TURNSTILE_FAILED, shown as
// "could not connect". Now the token travels with the spin and each failure has its own reason and message.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.__WHEEL_MODE__ = 'live';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const W = await import('../../src/services/wheel.ts');
const URL_ = 'https://worker.example.invalid';

const fakeFetch = (status, body, sent = []) => ({
  fetch: async (url, init) => { sent.push({ url, init }); return { status, text: async () => JSON.stringify(body) }; },
});
const throwing = { fetch: async () => { throw new TypeError('Failed to fetch'); } };
const spin = { spinId: 'opening-1_aliceUid000000000000000000A1_1', n: 1, prizeId: 'none-1', label: 'حظ أوفر', status: 'none', type: 'none' };

test('LIVE build: the wheel is on and the test badge is off', () => {
  assert.equal(W.WHEEL_ENABLED, true);
  assert.equal(W.WHEEL_TEST_BUILD, false);
});

test('the signed-in spin carries the Turnstile token in its body (and only that); without a token the body stays {}', async () => {
  const sent = [];
  const ok = await W.spinWheel('id-token', URL_, fakeFetch(200, { ok: true, result: spin, repeated: false, chancesLeft: 0 }, sent), 'tt-123');
  assert.equal(ok.kind, 'ok');
  assert.equal(sent[0].url, `${URL_}/wheel/spin`);
  assert.equal(sent[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(sent[0].init.body), { turnstileToken: 'tt-123' });
  assert.equal(sent[0].init.headers.authorization, 'Bearer id-token');
  await W.spinWheel('id-token', URL_, fakeFetch(200, { ok: true, result: spin }, sent));
  assert.equal(sent[1].init.body, '{}');
  // other calls never carry it
  await W.fetchWheelPublic(URL_, fakeFetch(200, { ok: true, campaign: 'open', slots: [] }, sent));
  assert.equal(sent[2].init.body, undefined);
});

test('signed-in spin: each answer gets its own reason (security / rate limit / server / closed / network / other)', async () => {
  const cases = [
    [403, { ok: false, code: 'TURNSTILE_FAILED' }, 'security'],
    [429, { ok: false, code: 'RATE_LIMITED' }, 'rate_limited'],
    [503, { ok: false, code: 'UNAVAILABLE' }, 'server'],
    [500, null, 'server'],
    [409, { ok: false, code: 'WHEEL_NO_CHANCE' }, 'refused'],
  ];
  for (const [status, body, reason] of cases) {
    const r = await W.spinWheel('t', URL_, fakeFetch(status, body), 'tt');
    assert.equal(r.kind, 'unavailable', `${status}`);
    assert.equal(r.reason, reason, `${status} ${body?.code}`);
    if (body?.code) assert.equal(r.code, body.code);
  }
  assert.deepEqual(await W.spinWheel('t', URL_, fakeFetch(409, { ok: false, code: 'CAMPAIGN_CLOSED' }), 'tt'), { kind: 'closed', code: 'CAMPAIGN_CLOSED' });
  assert.equal((await W.spinWheel('t', URL_, fakeFetch(401, { ok: false, code: 'AUTH_REQUIRED' }), 'tt')).kind, 'sign_in_required');
  assert.equal((await W.spinWheel('t', URL_, fakeFetch(403, { ok: false, code: 'WHEEL_ACCOUNT_NOT_VERIFIED' }), 'tt')).kind, 'not_verified');
  const net = await W.spinWheel('t', URL_, throwing, 'tt');
  assert.deepEqual(net, { kind: 'unavailable', reason: 'network' });
});

test('guest spin: no token, no sign-in; 409 CAMPAIGN_CLOSED = closed, 429 WHEEL_GUEST_LIMIT = limit, 429 RATE_LIMITED, 503, 409 BUSY, network each distinct', async () => {
  const sent = [];
  const res = await W.spinAsGuest(URL_, fakeFetch(200, { ok: true, repeated: false, result: { prizeId: 'none-1', label: 'حظ أوفر', status: 'none', type: 'none' } }, sent));
  assert.equal(res.kind, 'ok');
  assert.equal(sent[0].url, `${URL_}/wheel/guest/spin`);
  const body = JSON.parse(sent[0].init.body);
  assert.deepEqual(Object.keys(body), ['ticket'], 'only the ticket (no Turnstile on the guest spin)');
  assert.equal(sent[0].init.headers.authorization, undefined);
  assert.deepEqual(await W.spinAsGuest(URL_, fakeFetch(409, { ok: false, code: 'CAMPAIGN_CLOSED' })), { kind: 'closed', code: 'CAMPAIGN_CLOSED' });
  assert.equal((await W.spinAsGuest(URL_, fakeFetch(429, { ok: false, code: 'WHEEL_GUEST_LIMIT' }))).kind, 'limit');
  assert.equal((await W.spinAsGuest(URL_, fakeFetch(429, { ok: false, code: 'RATE_LIMITED' }))).reason, 'rate_limited');
  assert.equal((await W.spinAsGuest(URL_, fakeFetch(503, { ok: false, code: 'UNAVAILABLE' }))).reason, 'server');
  assert.equal((await W.spinAsGuest(URL_, fakeFetch(409, { ok: false, code: 'BUSY' }))).reason, 'server');
  assert.equal((await W.spinAsGuest(URL_, throwing)).reason, 'network');
});

test('messages: one clear text per reason (Arabic + English), each says the spin was NOT used; "other" shows its code', () => {
  const reasons = ['network', 'rate_limited', 'server', 'security', 'refused'];
  const ar = reasons.map((reason) => W.failureText({ kind: 'unavailable', reason, code: 'X_CODE' }, true));
  const en = reasons.map((reason) => W.failureText({ kind: 'unavailable', reason, code: 'X_CODE' }, false));
  assert.equal(new Set(ar).size, reasons.length);
  assert.equal(new Set(en).size, reasons.length);
  for (const t of ar) assert.ok(t.includes('لم تُستخدم لفّتك'), t);
  assert.ok(ar[0].includes('اتصالك بالإنترنت'));
  assert.ok(ar[1].includes('انتظر دقيقة'));
  assert.ok(ar[2].includes('مشغولة مؤقتًا'));
  assert.ok(ar[3].includes('التحقق الأمني'));
  assert.ok(ar[4].includes('X_CODE'));
  assert.ok(!ar.slice(1).some((t) => t.includes('تعذّر الاتصال')), 'only a real network failure says "could not connect"');
});
