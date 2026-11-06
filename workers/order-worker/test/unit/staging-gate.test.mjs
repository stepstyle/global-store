// STAGING access gate (x-staging-access) — LOCAL ONLY, no network: the real Worker (src/index.js) built for the
// 'staging' target, with globalThis.fetch replaced by an in-memory stand-in for Google OAuth, Firestore (commit
// preconditions enforced like the real service), Turnstile and the sink. Every outbound call is recorded, so a test
// can prove that a refused request reached NOTHING (no Firestore read/write, no Turnstile, no rate limiter, no sink).
//   node --test test/unit/staging-gate.test.mjs
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import worker from '../../src/index.js';
import { loadConfig } from '../../src/config.js';
import { encodeFields, decodeFields } from '../../src/firestore.js';
import { STAGING_ACCESS_MIN_LENGTH } from '../../src/http.js';
import { checkoutOrder, line, makeOrderId, PRODUCTS } from '../fixtures.mjs';

const SINK = 'https://anta-notify-sink-staging.acme.workers.dev';
const W = 'https://anta-order-notify-staging.acme.workers.dev';
const PROJECT = 'dairsharaf-staging';
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const NAME_ROOT = `projects/${PROJECT}/databases/(default)/documents`;
// test-only key pair, generated in memory for this run (never a real service-account key)
const { privateKey: TEST_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const SECRET = randomBytes(24).toString('base64url'); // 32 chars, random per run
assert.equal(SECRET.length, STAGING_ACCESS_MIN_LENGTH);
const WRONG_SAME_LENGTH = SECRET.slice(0, -1) + (SECRET.at(-1) === 'A' ? 'B' : 'A');

const STAGING_ENV = Object.freeze({
  ENVIRONMENT: 'staging',
  FIREBASE_PROJECT_ID: PROJECT,
  FIRESTORE_AUTH: 'service-account',
  FIREBASE_CLIENT_EMAIL: `order-worker-staging@${PROJECT}.iam.gserviceaccount.com`,
  FIREBASE_PRIVATE_KEY: TEST_KEY,
  TELEGRAM_API_BASE: `${SINK}/telegram`,
  SENDGRID_API_BASE: `${SINK}/sendgrid`,
  TELEGRAM_CHAT_ID: 'staging-sink-chat',
  TURNSTILE_MODE: 'enforce',
  TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
  ALLOWED_ORIGINS: 'http://127.0.0.1:3000',
  STOCK_MODE: 'apply',
  CREATE_WAIT_MS: '0',
  WORKER_AUTH_TOKEN: 'w'.repeat(32),
  STAGING_ACCESS_TOKEN: SECRET,
});

// ------------------------------------------------------------------ in-memory outside world
let calls; // every outbound fetch: { host, method, path }
let limiterCalls;
let logs;
let docs; // full document name -> { fields, createTime, updateTime }
let tick = 0;
const nextTime = () => new Date(Date.now()).toISOString().replace('Z', `${String(++tick).padStart(6, '0')}Z`);
const origFetch = globalThis.fetch;
const origLog = console.log;

const getPath = (fields, path) => path.split('.').reduce((f, k, i, a) => (f === undefined ? undefined : i === a.length - 1 ? f[k] : f[k]?.mapValue?.fields), fields);
function setPath(fields, path, value) {
  const keys = path.split('.');
  let f = fields;
  for (const k of keys.slice(0, -1)) {
    if (!f[k]?.mapValue) f[k] = { mapValue: { fields: {} } };
    f[k].mapValue.fields ??= {};
    f = f[k].mapValue.fields;
  }
  if (value === undefined) delete f[keys.at(-1)];
  else f[keys.at(-1)] = structuredClone(value);
}

function commit(writes) {
  for (const w of writes) {
    if (!w.update) throw new Error(`fake Firestore: unsupported write ${JSON.stringify(Object.keys(w))}`);
    const cur = docs.get(w.update.name);
    const pre = w.currentDocument;
    if (pre && 'exists' in pre && Boolean(cur) !== pre.exists) return { status: 409, data: { error: { status: pre.exists ? 'NOT_FOUND' : 'ALREADY_EXISTS' } } };
    if (pre?.updateTime && cur?.updateTime !== pre.updateTime) return { status: 400, data: { error: { status: 'FAILED_PRECONDITION' } } };
  }
  const now = nextTime();
  for (const w of writes) {
    const name = w.update.name;
    const cur = docs.get(name);
    let fields;
    if (w.updateMask) {
      fields = structuredClone(cur?.fields ?? {});
      for (const p of w.updateMask.fieldPaths) setPath(fields, p, getPath(w.update.fields, p));
    } else fields = structuredClone(w.update.fields);
    for (const t of w.updateTransforms ?? []) if (t.setToServerValue === 'REQUEST_TIME') setPath(fields, t.fieldPath, { timestampValue: new Date().toISOString() });
    docs.set(name, { fields, createTime: cur?.createTime ?? new Date().toISOString(), updateTime: now });
  }
  return { status: 200, data: { writeResults: writes.map(() => ({ updateTime: now })) } };
}

const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const docJson = (name, d) => ({ name, fields: d.fields, createTime: d.createTime, updateTime: d.updateTime });

async function fakeFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  calls.push({ host: url.hostname, method, path: url.pathname });
  if (url.hostname === 'oauth2.googleapis.com') return reply(200, { access_token: 'test-access-token', expires_in: 3600 });
  if (url.hostname === 'challenges.cloudflare.com') return reply(200, { success: true }); // Cloudflare's always-pass TEST secret
  if (url.hostname === new URL(SINK).hostname) return reply(200, { ok: true });
  if (url.hostname !== 'firestore.googleapis.com') throw new Error(`unexpected outbound request to ${url.hostname}`);
  const full = decodeURIComponent(url.href);
  const body = init.body ? JSON.parse(init.body) : null;
  if (full === `${DOCS}:batchGet`) {
    return reply(200, body.documents.map((n) => (docs.has(n) ? { found: docJson(n, docs.get(n)) } : { missing: n })));
  }
  if (full === `${DOCS}:commit`) { const r = commit(body.writes); return reply(r.status, r.data); }
  if (full === `${DOCS}:runQuery`) return reply(200, []);
  if (method === 'GET' && full.startsWith(`${DOCS}/`)) {
    const n = `${NAME_ROOT}/${full.slice(DOCS.length + 1)}`;
    return docs.has(n) ? reply(200, docJson(n, docs.get(n))) : reply(404, { error: { status: 'NOT_FOUND' } });
  }
  throw new Error(`fake Firestore: unsupported ${method} ${url.pathname}`);
}

const firestoreCalls = () => calls.filter((c) => c.host === 'firestore.googleapis.com' || c.host === 'oauth2.googleapis.com');
const putProduct = (id, data) => docs.set(`${NAME_ROOT}/products/${id}`, { fields: encodeFields(data), createTime: new Date().toISOString(), updateTime: nextTime() });
const stockOf = (id) => decodeFields(docs.get(`${NAME_ROOT}/products/${id}`).fields).stock;

beforeEach(() => {
  calls = [];
  limiterCalls = 0;
  logs = [];
  docs = new Map();
  globalThis.__DEPLOY_TARGET__ = 'staging';
  globalThis.fetch = fakeFetch;
  console.log = (...a) => logs.push(a.join(' '));
});
afterEach(() => {
  delete globalThis.__DEPLOY_TARGET__;
  globalThis.fetch = origFetch;
  console.log = origLog;
});

const limiter = { limit: async () => { limiterCalls++; return { success: true }; } };
const envWith = (over = {}) => ({ ...STAGING_ENV, CREATE_RATE_LIMITER: limiter, STATUS_RATE_LIMITER: limiter, ...over });

/** One request through the real Worker; background work (notifications) is awaited too. */
async function call(env, { method = 'GET', path = '/', body, headers = {} } = {}) {
  const pending = [];
  const req = new Request(`${W}${path}`, {
    method,
    headers: { 'cf-connecting-ip': '203.0.113.7', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, { waitUntil: (p) => pending.push(p) });
  const text = await res.text();
  await Promise.all(pending);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

const ORDER_ID = makeOrderId();
const orderBody = (o = checkoutOrder({ id: ORDER_ID, items: [line('p-simple', 2)] })) => ({ order: o, turnstileToken: 'staging-turnstile-test-token' });
// every gated route, each with a request that WOULD do real work (create / read / send) once past the gate
const GATED = [
  { method: 'POST', path: '/create-order', body: orderBody() },
  { method: 'GET', path: `/orders/${ORDER_ID}/status` },
  { method: 'GET', path: `/orders/${ORDER_ID}/summary`, headers: { 'x-tracking-key': 'ABCD-EFGH-JKLM-NPQR' } },
  { method: 'GET', path: '/test', headers: { 'x-worker-auth': 'w'.repeat(32) } },
  { method: 'POST', path: '/notify-order', body: { orderId: ORDER_ID }, headers: { 'x-worker-auth': 'w'.repeat(32) } },
  { method: 'GET', path: '/anything-else' },
];

const assertNothingReached = (tag) => {
  assert.deepEqual(calls, [], `${tag}: no outbound request at all (Firestore, OAuth, Turnstile, sink)`);
  assert.equal(limiterCalls, 0, `${tag}: refused before the rate limiter`);
  assert.equal(docs.size, 0, `${tag}: nothing written`);
};

// ------------------------------------------------------------------ refusals
test('no x-staging-access header -> 403 on every gated route, nothing reached', async () => {
  putProduct('p-simple', PRODUCTS['p-simple']);
  const before = docs.size;
  for (const r of GATED) {
    calls = [];
    const res = await call(envWith(), r);
    assert.equal(res.status, 403, r.path);
    assert.deepEqual(res.json, { ok: false, code: 'STAGING_ACCESS_DENIED' }, r.path);
    assert.deepEqual(calls, [], `${r.path}: no outbound request`);
  }
  assert.equal(limiterCalls, 0);
  assert.equal(docs.size, before);
  assert.equal(stockOf('p-simple'), 10, 'stock untouched');
});

test('wrong secret (same length, shorter, longer, empty, other case) -> 403, nothing reached', async () => {
  for (const bad of [WRONG_SAME_LENGTH, SECRET.slice(0, -1), `${SECRET}x`, '', ' ', SECRET.toLowerCase() === SECRET ? SECRET.toUpperCase() : SECRET.toLowerCase(), 'w'.repeat(32)]) {
    for (const r of GATED) {
      const res = await call(envWith(), { ...r, headers: { ...r.headers, 'x-staging-access': bad } });
      assert.equal(res.status, 403, `${r.path} with a wrong secret`);
    }
  }
  assertNothingReached('wrong secret');
});

test('Worker WITHOUT a usable secret fails CLOSED: missing / too short secret -> 403 even with a matching header', async () => {
  const short = SECRET.slice(0, STAGING_ACCESS_MIN_LENGTH - 1);
  const cases = [
    [envWith({ STAGING_ACCESS_TOKEN: undefined }), SECRET],
    [envWith({ STAGING_ACCESS_TOKEN: '' }), ''],
    [envWith({ STAGING_ACCESS_TOKEN: '   ' }), '   '],
    [envWith({ STAGING_ACCESS_TOKEN: short }), short],
  ];
  for (const [env, header] of cases) {
    assert.equal(loadConfig(env).ok, true, 'the rest of the Worker config stays valid');
    for (const r of GATED) {
      const res = await call(env, { ...r, headers: { ...r.headers, 'x-staging-access': header } });
      assert.equal(res.status, 403, `${r.path}: no usable secret configured`);
    }
  }
  assertNothingReached('no secret configured');
  assert.ok(logs.some((l) => l.includes('"staging_gate.denied"') && l.includes('"not_configured"')));
});

test('health check "/" and CORS preflight stay open; the browser can NOT send x-staging-access (not in allow-headers)', async () => {
  const root = await call(envWith(), { path: '/' });
  assert.equal(root.status, 200);
  assert.equal(root.json.service, 'order-worker');
  const pre = await call(envWith(), { method: 'OPTIONS', path: '/create-order', headers: { origin: 'http://127.0.0.1:3000', 'access-control-request-headers': 'x-staging-access' } });
  assert.equal(pre.status, 204);
  const allowed = (pre.headers.get('access-control-allow-headers') || '').toLowerCase();
  assert.ok(allowed.length > 0);
  assert.ok(!allowed.includes('x-staging-access'), 'a browser preflight for x-staging-access is never allowed');
  assertNothingReached('root / OPTIONS');
});

// ------------------------------------------------------------------ correct secret: only the gate is passed
const ok = { 'x-staging-access': SECRET };

test('correct secret passes ONLY the gate: Turnstile, Firebase Auth and x-worker-auth still decide', async () => {
  putProduct('p-simple', PRODUCTS['p-simple']);
  // Turnstile still required (no token -> refused before Firestore)
  const noTs = await call(envWith(), { method: 'POST', path: '/create-order', body: { order: orderBody().order }, headers: ok });
  assert.equal(noTs.status, 403);
  assert.equal(noTs.json.code, 'TURNSTILE_FAILED');
  // an invalid Firebase ID token is still a 401, never a silent guest
  const badAuth = await call(envWith(), { method: 'POST', path: '/create-order', body: orderBody(), headers: { ...ok, authorization: 'Bearer not.a.jwt' } });
  assert.equal(badAuth.status, 401);
  // invalid JSON / invalid order are still refused
  assert.equal((await call(envWith(), { method: 'POST', path: '/create-order', body: '{', headers: ok })).json.code, 'INVALID_JSON');
  const invalid = await call(envWith(), { method: 'POST', path: '/create-order', body: { order: { id: 'nope' }, turnstileToken: 't' }, headers: ok });
  assert.equal(invalid.json.code, 'INVALID_ORDER');
  assert.equal(firestoreCalls().length, 0, 'none of the refusals above touched Firestore');
  assert.equal(stockOf('p-simple'), 10);
  // owner tools: the gate secret is NOT x-worker-auth
  assert.equal((await call(envWith(), { path: '/test', headers: ok })).status, 401);
  assert.equal((await call(envWith(), { method: 'POST', path: '/notify-order', body: { orderId: ORDER_ID }, headers: ok })).status, 401);
  assert.equal((await call(envWith(), { path: '/test', headers: { ...ok, 'x-worker-auth': SECRET } })).status, 401, 'the gate secret is never accepted as x-worker-auth');
  // summary: tracking key / owner still required (same 404 as any refusal)
  assert.equal((await call(envWith(), { path: `/orders/${ORDER_ID}/summary`, headers: ok })).status, 404);
  assert.ok(limiterCalls > 0, 'the rate limiter runs again once past the gate');
});

test('correct secret: an order is created once, stock deducted once; replay / changed payload never deduct again', async () => {
  putProduct('p-simple', PRODUCTS['p-simple']);
  const o = checkoutOrder({ id: makeOrderId(), items: [line('p-simple', 2)] });
  const first = await call(envWith(), { method: 'POST', path: '/create-order', body: orderBody(o), headers: ok });
  assert.equal(first.status, 200, first.text);
  assert.deepEqual(first.json, { ok: true, orderId: o.id, replay: false });
  assert.equal(stockOf('p-simple'), 8);
  const again = await call(envWith(), { method: 'POST', path: '/create-order', body: orderBody(o), headers: ok });
  assert.deepEqual(again.json, { ok: true, orderId: o.id, replay: true });
  const changed = await call(envWith(), { method: 'POST', path: '/create-order', body: orderBody({ ...o, items: [line('p-simple', 5)] }), headers: ok });
  assert.equal(changed.status, 409);
  assert.equal(stockOf('p-simple'), 8, 'deducted exactly once');
  // status works through the gate (and is still personal-data free)
  const st = await call(envWith(), { path: `/orders/${o.id}/status`, headers: ok });
  assert.deepEqual(st.json, { ok: true, exists: true, status: 'new' });
});

test('correct secret: concurrent orders on the last item -> exactly one deduction, never negative', async () => {
  putProduct('p-last-one', PRODUCTS['p-last-one']);
  const orders = Array.from({ length: 4 }, () => checkoutOrder({ id: makeOrderId(), items: [line('p-last-one', 1)] }));
  const rs = await Promise.all(orders.map((o) => call(envWith(), { method: 'POST', path: '/create-order', body: orderBody(o), headers: ok })));
  for (const r of rs) assert.equal(r.status, 200, r.text);
  assert.equal(stockOf('p-last-one'), 0);
  const ledgers = [...docs.entries()].filter(([n]) => n.includes('/orderLedger/')).map(([, d]) => decodeFields(d.fields));
  assert.equal(ledgers.length, 4);
  const applied = ledgers.flatMap((l) => l.stockDeductions || []).filter((d) => d.applied);
  assert.equal(applied.length, 1, 'one order got the last item; the others are recorded as a shortfall');
});

// ------------------------------------------------------------------ secret never leaks
test('the secret (and any wrong value tried) never appears in a response or a log line', async () => {
  putProduct('p-simple', PRODUCTS['p-simple']);
  const seen = [];
  for (const h of [SECRET, WRONG_SAME_LENGTH, undefined]) {
    for (const r of GATED) {
      const res = await call(envWith(), { ...r, headers: { ...r.headers, ...(h === undefined ? {} : { 'x-staging-access': h }) } });
      seen.push(res.text, JSON.stringify([...res.headers]));
    }
  }
  const all = [...seen, ...logs].join('\n');
  assert.ok(!all.includes(SECRET), 'the secret is never echoed');
  assert.ok(!all.includes(WRONG_SAME_LENGTH), 'a wrong attempt is never echoed');
  assert.ok(logs.some((l) => l.includes('"staging_gate.denied"') && l.includes('"mismatch"')));
  assert.ok(logs.some((l) => l.includes('"staging_gate.denied"') && l.includes('"missing"')));
});

// ------------------------------------------------------------------ production / local unaffected
const PRODUCTION = {
  ENVIRONMENT: 'production',
  FIREBASE_PROJECT_ID: 'antastore1-82b50',
  FIRESTORE_AUTH: 'service-account',
  FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk-abcde@antastore1-82b50.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKEFAKEFAKE\n-----END PRIVATE KEY-----\n',
  TURNSTILE_SECRET: '0x4AAAAAAAREALLOOKINGSECRET',
  PRICE_CHECK_MODE: 'enforce', // production launch requirement (config.js)
  TURNSTILE_MODE: 'enforce',
};

test('production: no gate (same behaviour as before), and a production Worker carrying STAGING_ACCESS_TOKEN is refused', async () => {
  globalThis.__DEPLOY_TARGET__ = 'production';
  const c = loadConfig(PRODUCTION);
  assert.equal(c.ok, true, c.errors.join('; '));
  assert.equal(c.stagingAccessToken, '');
  // a request without the header is handled as before (here: invalid id -> 400, before any Firestore call)
  const r = await call({ ...PRODUCTION, STATUS_RATE_LIMITER: limiter }, { path: '/orders/bad/status' });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'INVALID_ID');
  assert.equal(calls.length, 0);
  const withVar = loadConfig({ ...PRODUCTION, STAGING_ACCESS_TOKEN: SECRET });
  assert.equal(withVar.ok, false);
  assert.ok(withVar.errors.some((e) => e.includes('STAGING_ACCESS_TOKEN')));
  assert.ok(!withVar.errors.join(' ').includes(SECRET), 'the value is never part of an error');
  const refused = await call({ ...PRODUCTION, STAGING_ACCESS_TOKEN: SECRET, STATUS_RATE_LIMITER: limiter }, { path: '/orders/bad/status', headers: ok });
  assert.equal(refused.json.code, 'CONFIG_ERROR');
  assert.ok(!logs.join('\n').includes(SECRET));
});

test('local build: no gate (local e2e / integration behaviour unchanged), secret value ignored', () => {
  globalThis.__DEPLOY_TARGET__ = 'local';
  const c = loadConfig({ ENVIRONMENT: 'local', FIREBASE_PROJECT_ID: 'demo-x', FIRESTORE_AUTH: 'emulator', STAGING_ACCESS_TOKEN: SECRET });
  assert.equal(c.isStaging, false);
  assert.equal(c.stagingAccessToken, '');
});
