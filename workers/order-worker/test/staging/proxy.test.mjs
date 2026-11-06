// Local staging proxy (staging/proxy.mjs) — LOCAL ONLY. The upstream "Worker" is a fake function behind the real
// guardedFetch (so the x-staging-access injection is the production code path); the proxy listens on 127.0.0.1:0.
// No request leaves this machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { assertStagingConfig, guardedFetch, StagingGuardError, REPO_ROOT } from '../../staging/guard.mjs';
import { createProxy, listenLoopback, loadAccessToken, verifyUpstream, main as proxyMain, PROXY_ALLOWED_ORIGIN, MAX_BODY_BYTES } from '../../staging/proxy.mjs';
import { stagingWebEnv, main as webEnvMain } from '../../staging/web-env.mjs';

const FAKE_KEY = '-----BEGIN PRIVATE KEY-----\nFAKEFAKEFAKE\n-----END PRIVATE KEY-----\n';
const SECRET = randomBytes(32).toString('hex');
const ORIGIN = PROXY_ALLOWED_ORIGIN;
const ID = 'ORD-ABCD1234-XYZ789';
let dir;
let cfg;
let st;
let tokensPath;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'staging-proxy-test-'));
  const keyPath = join(dir, 'staging-key.json');
  writeFileSync(keyPath, JSON.stringify({ type: 'service_account', project_id: 'dairsharaf-staging', client_email: 'order-worker-staging@dairsharaf-staging.iam.gserviceaccount.com', private_key: FAKE_KEY }));
  cfg = {
    projectId: 'dairsharaf-staging',
    workerUrl: 'https://anta-order-notify-staging.acme.workers.dev',
    sinkUrl: 'https://anta-notify-sink-staging.acme.workers.dev',
    serviceAccountKeyPath: keyPath,
    firebaseWebConfig: { apiKey: 'staging-fake-api-key', authDomain: 'dairsharaf-staging.firebaseapp.com', projectId: 'dairsharaf-staging', appId: '1:000:web:staging' },
    cloudflareAccountId: '0123456789abcdef0123456789abcdef',
    cloudflareLoginEmail: 'staging-owner@example.com',
    firebaseAccountEmail: 'staging-owner@example.com',
  };
  st = assertStagingConfig(cfg, { env: {} });
  tokensPath = join(dir, 'tokens.json');
  writeFileSync(tokensPath, JSON.stringify({ STAGING_ACCESS_TOKEN: SECRET, WORKER_AUTH_TOKEN: 'w'.repeat(64) }));
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ------------------------------------------------------------------ fake upstream (the "Worker")
function fakeUpstream({ gate = true, echoSecret = false, fail = false } = {}) {
  const f = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const h = new Headers(init.headers);
    f.calls.push({ host: url.hostname, path: url.pathname, method: init.method || 'GET', headers: Object.fromEntries(h), body: init.body ?? null });
    if (fail) throw new Error('network down');
    const access = h.get('x-staging-access');
    if (url.pathname === '/') return Response.json({ ok: true, service: 'order-worker' });
    if (gate && access !== SECRET) return Response.json({ ok: false, code: 'STAGING_ACCESS_DENIED' }, { status: 403 });
    if (url.pathname === '/orders/ORD-1/status') return Response.json({ ok: false, code: 'INVALID_ID' }, { status: 400 });
    if (echoSecret) return Response.json({ ok: true, leaked: access });
    if (url.pathname === '/create-order') return Response.json({ ok: true, orderId: JSON.parse(init.body).order.id, replay: false }, { headers: { 'set-cookie': 'x=1', 'x-internal': 'y' } });
    return Response.json({ ok: true, exists: false }, { status: 404, headers: { 'retry-after': '3' } });
  };
  f.calls = [];
  return f;
}

async function startProxy(opts = {}) {
  const up = opts.upstream ?? fakeUpstream();
  const logs = [];
  const server = createProxy({ st, fetchImpl: guardedFetch(st, up, { stagingAccessToken: SECRET }), secret: SECRET, allowCreate: opts.allowCreate ?? false, log: (l) => logs.push(l) });
  const port = await listenLoopback(server, 0);
  return { server, port, up, logs, close: () => new Promise((r) => server.close(r)) };
}

/** raw HTTP request (lets a test set Host / Origin exactly like a browser or an attacker would) */
function call(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((ok, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, origin: ORIGIN, ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch {} ok({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on('error', fail);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const noOrigin = (h) => { const o = { ...h }; delete o.origin; return o; };

// ------------------------------------------------------------------ secret source
test('access secret: only from an absolute file OUTSIDE the repo, >= 32 chars; errors never show the value', () => {
  assert.equal(loadAccessToken(tokensPath), SECRET);
  for (const bad of ['', 'relative/tokens.json', resolve(REPO_ROOT, 'tokens.json'), join(dir, 'missing.json')]) {
    assert.throws(() => loadAccessToken(bad), StagingGuardError, bad);
  }
  const short = join(dir, 'short.json');
  writeFileSync(short, JSON.stringify({ STAGING_ACCESS_TOKEN: 'a'.repeat(31) }));
  assert.throws(() => loadAccessToken(short), (e) => e instanceof StagingGuardError && !e.message.includes('a'.repeat(31)));
});

test('startup verification: upstream must be the GATED staging Worker that accepts the secret', async () => {
  await verifyUpstream(st, guardedFetch(st, fakeUpstream(), { stagingAccessToken: SECRET }));
  await assert.rejects(verifyUpstream(st, guardedFetch(st, fakeUpstream({ gate: false }), { stagingAccessToken: SECRET })), /does not enforce the staging access gate/);
  await assert.rejects(verifyUpstream(st, guardedFetch(st, fakeUpstream(), { stagingAccessToken: 'x'.repeat(64) })), /did not accept/);
});

test('main(): fails CLOSED before listening — wrong project, no/short secret, create without confirm, ungated upstream', async () => {
  const base = { config: cfg, env: {}, realFetch: fakeUpstream(), keepOpen: false, log: () => {} };
  await assert.rejects(proxyMain(['--port', '0'], { ...base, config: { ...cfg, projectId: 'other-staging', firebaseWebConfig: { ...cfg.firebaseWebConfig, projectId: 'other-staging', authDomain: 'other-staging.firebaseapp.com' } } }), StagingGuardError);
  await assert.rejects(proxyMain(['--port', '18789'], base), /tokens file/);
  await assert.rejects(proxyMain(['--port', '18789', '--tokens', tokensPath, '--allow-create'], base), /--confirm/);
  await assert.rejects(proxyMain(['--port', '18789', '--tokens', tokensPath], { ...base, realFetch: fakeUpstream({ gate: false }) }), /gate/);
  await assert.rejects(proxyMain(['--port', '80', '--tokens', tokensPath], base), /--port/);
  // and a good start works (then closes immediately)
  assert.equal(await proxyMain(['--port', '18789', '--tokens', tokensPath], base), 0);
});

// ------------------------------------------------------------------ who may call
test('only 127.0.0.1:<port> Host and the local storefront Origin; other sites / no Origin refused, nothing forwarded', async () => {
  const p = await startProxy();
  try {
    assert.equal(p.server.address().address, '127.0.0.1');
    const path = `/orders/${ID}/status`;
    assert.equal((await call(p.port, { path, headers: { host: `localhost:${p.port}` } })).status, 421);
    assert.equal((await call(p.port, { path, headers: { host: 'evil.example' } })).status, 421, 'DNS rebinding');
    for (const origin of ['https://evil.example', 'http://localhost:3000', 'http://127.0.0.1:3001', 'null', 'https://dairsharaf.com']) {
      const r = await call(p.port, { path, headers: { origin } });
      assert.equal(r.status, 403, origin);
      assert.equal(r.headers['access-control-allow-origin'], undefined, `${origin}: no CORS grant`);
    }
    const none = await new Promise((ok) => { const q = httpRequest({ host: '127.0.0.1', port: p.port, path, headers: { host: `127.0.0.1:${p.port}` } }, (res) => { res.resume(); ok(res.statusCode); }); q.end(); });
    assert.equal(none, 403, 'no Origin header (non-browser client) refused');
    // CSRF form post from another site (text/plain, no preflight)
    assert.equal((await call(p.port, { method: 'POST', path: '/create-order', headers: { origin: 'https://evil.example', 'content-type': 'text/plain' }, body: '{}' })).status, 403);
    assert.equal(p.up.calls.length, 0, 'nothing reached the upstream');
  } finally { await p.close(); }
});

test('only create / status / summary are proxied — /test, /notify-order, root, bad ids, queries, traversal: 404', async () => {
  const p = await startProxy({ allowCreate: true });
  try {
    for (const [method, path] of [['GET', '/test'], ['POST', '/notify-order'], ['GET', '/'], ['GET', '/orders/ORD-1/status'], ['GET', `/orders/${ID}/status?x=1`], ['GET', `/orders/${ID}/../../test`], ['GET', `/orders/${ID}%2F..%2Ftest/status`], ['DELETE', `/orders/${ID}/status`], ['GET', '/create-order'], ['POST', `/orders/${ID}/status`]]) {
      assert.equal((await call(p.port, { method, path })).status, 404, `${method} ${path}`);
    }
    assert.equal(p.up.calls.length, 0);
  } finally { await p.close(); }
});

test('CORS preflight: allowed origin + known route only; x-staging-access is never an allowed browser header', async () => {
  const p = await startProxy();
  try {
    const ok = await call(p.port, { method: 'OPTIONS', path: '/create-order', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, authorization' } });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers['access-control-allow-origin'], ORIGIN);
    assert.ok(!ok.headers['access-control-allow-headers'].includes('x-staging-access'));
    assert.equal((await call(p.port, { method: 'OPTIONS', path: '/create-order', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-staging-access' } })).status, 403);
    assert.equal((await call(p.port, { method: 'OPTIONS', path: '/test', headers: { 'access-control-request-method': 'GET' } })).status, 404);
    assert.equal(p.up.calls.length, 0);
  } finally { await p.close(); }
});

// ------------------------------------------------------------------ create disabled (this phase)
test('POST /create-order is DISABLED by default: 403, nothing forwarded (no order can be created through the proxy)', async () => {
  const p = await startProxy();
  try {
    const body = JSON.stringify({ order: { id: ID }, turnstileToken: 't' });
    const r = await call(p.port, { method: 'POST', path: '/create-order', headers: { 'content-type': 'application/json' }, body });
    assert.equal(r.status, 403);
    assert.deepEqual(r.json, { ok: false, code: 'STAGING_PROXY_CREATE_DISABLED' });
    assert.equal(r.headers['access-control-allow-origin'], ORIGIN, 'the storefront can read the refusal');
    assert.equal(p.up.calls.length, 0);
  } finally { await p.close(); }
});

// ------------------------------------------------------------------ forwarding (fake upstream only)
test('read routes forwarded: secret added upstream ONLY, client headers filtered, response headers filtered', async () => {
  const p = await startProxy();
  try {
    const r = await call(p.port, { path: `/orders/${ID}/status`, headers: { authorization: 'Bearer id-token', cookie: 'session=1', 'x-worker-auth': 'w'.repeat(32), 'x-tracking-key': 'K' } });
    assert.equal(r.status, 404);
    assert.equal(r.headers['retry-after'], '3');
    assert.equal(r.headers['access-control-allow-origin'], ORIGIN);
    assert.equal(p.up.calls.length, 1);
    const sent = p.up.calls[0];
    assert.equal(sent.host, 'anta-order-notify-staging.acme.workers.dev');
    assert.equal(sent.path, `/orders/${ID}/status`);
    assert.equal(sent.headers['x-staging-access'], SECRET, 'added by guardedFetch for the order Worker');
    assert.equal(sent.headers.authorization, 'Bearer id-token');
    assert.equal(sent.headers['x-tracking-key'], 'K');
    assert.equal(sent.headers.origin, ORIGIN);
    assert.equal(sent.headers.cookie, undefined);
    assert.equal(sent.headers['x-worker-auth'], undefined, 'owner-tool token never forwarded');
    const s = await call(p.port, { path: `/orders/${ID}/summary` });
    assert.equal(s.status, 404);
    assert.equal(p.up.calls.length, 2);
  } finally { await p.close(); }
});

test('a client that sends x-staging-access itself is refused (the browser never holds the secret)', async () => {
  const p = await startProxy();
  try {
    for (const v of [SECRET, 'guess', '']) {
      assert.equal((await call(p.port, { path: `/orders/${ID}/status`, headers: { 'x-staging-access': v } })).status, 400);
    }
    assert.equal(p.up.calls.length, 0);
  } finally { await p.close(); }
});

test('create (only when explicitly enabled; FAKE upstream here): body forwarded, size limit, upstream failure -> 502, never success', async () => {
  const p = await startProxy({ allowCreate: true });
  try {
    const body = JSON.stringify({ order: { id: ID }, turnstileToken: 't' });
    const r = await call(p.port, { method: 'POST', path: '/create-order', headers: { 'content-type': 'application/json' }, body });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, orderId: ID, replay: false });
    assert.equal(r.headers['set-cookie'], undefined);
    assert.equal(r.headers['x-internal'], undefined);
    assert.equal(p.up.calls[0].body, body);
    const big = await call(p.port, { method: 'POST', path: '/create-order', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(MAX_BODY_BYTES + 1) });
    assert.equal(big.status, 413);
    assert.equal(p.up.calls.length, 1);
  } finally { await p.close(); }
  const down = await startProxy({ allowCreate: true, upstream: fakeUpstream({ fail: true }) });
  try {
    const r = await call(down.port, { method: 'POST', path: '/create-order', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 502);
    assert.equal(r.json.code, 'PROXY_UPSTREAM_UNAVAILABLE');
  } finally { await down.close(); }
});

test('the secret never reaches a response or a log line — even if the upstream echoed it', async () => {
  const p = await startProxy({ upstream: fakeUpstream({ echoSecret: true }) });
  try {
    const r = await call(p.port, { path: `/orders/${ID}/summary`, headers: { authorization: 'Bearer id-token-123' } });
    assert.equal(r.status, 502);
    assert.equal(r.json.code, 'PROXY_UPSTREAM_BLOCKED');
    const all = [r.text, JSON.stringify(r.headers), ...p.logs].join('\n');
    assert.ok(!all.includes(SECRET));
    assert.ok(!p.logs.join('\n').includes('id-token-123'), 'no authorization value in logs');
    for (const l of p.logs) assert.deepEqual(Object.keys(JSON.parse(l)).sort(), ['event', 'method', 'ms', 'route', 'status']);
  } finally { await p.close(); }
});

// ------------------------------------------------------------------ web env file for the dev server
test('web env: staging target, proxy URL, public web identifiers only — no secret, never overwrites', async () => {
  const text = stagingWebEnv(st, 8789);
  assert.match(text, /^VITE_FIREBASE_TARGET=staging$/m);
  assert.match(text, /^VITE_FIREBASE_PROJECT_ID=dairsharaf-staging$/m);
  assert.match(text, /^VITE_WORKER_URL=http:\/\/127\.0\.0\.1:8789$/m);
  const vars = text.split('\n').filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(vars.map((l) => l.split('=')[0]), ['VITE_FIREBASE_TARGET', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_WORKER_URL', 'VITE_TURNSTILE_SITE_KEY']);
  assert.ok(!/workers\.dev|TOKEN|SECRET|PRIVATE|[0-9a-f]{64}/i.test(vars.join('\n')));
  const out = join(dir, '.env.staging.local');
  assert.equal(await webEnvMain(['--proxy-port', '8789'], { config: cfg, env: {}, out }), 0);
  await assert.rejects(webEnvMain([], { config: cfg, env: {}, out }), /already exists/);
});

// ------------------------------------------------------------------ test Turnstile token (OFF by default)
import { addTestTurnstile, assertTestTurnstileAllowed, TEST_TURNSTILE_TOKEN } from '../../staging/proxy.mjs';
import { checkoutOrder, line } from '../fixtures.mjs';
const REAL_TOML = readFileSync(resolve(REPO_ROOT, 'workers/order-worker/wrangler.staging.toml'), 'utf8');

test('addTestTurnstile: adds the token only when the body has none; everything else byte-identical', () => {
  const order = checkoutOrder({ items: [line('p-simple', 1)] });
  const text = JSON.stringify({ order, trackingKeyHash: 'a'.repeat(64) });
  const r = addTestTurnstile(text);
  assert.equal(r.turnstile, 'injected');
  assert.equal(r.body.slice(0, text.length - 1), text.slice(0, -1), 'original bytes untouched');
  const parsed = JSON.parse(r.body);
  assert.equal(parsed.turnstileToken, TEST_TURNSTILE_TOKEN);
  assert.deepEqual(parsed.order, order, 'items, prices, totals, address: unchanged');
  assert.equal(parsed.order.total, order.total);
  assert.deepEqual(addTestTurnstile('{}'), { body: `{"turnstileToken":"${TEST_TURNSTILE_TOKEN}"}`, turnstile: 'injected' });
  // a token the client sent (even an empty one) is NEVER replaced
  for (const t of ['client-token', '', null]) {
    const body = JSON.stringify({ order, turnstileToken: t });
    assert.deepEqual(addTestTurnstile(body), { body, turnstile: 'client' });
  }
  for (const odd of ['{', '[]', '"x"', '', 'null']) assert.deepEqual(addTestTurnstile(odd), { body: odd, turnstile: 'unchanged' });
});

test('test Turnstile allowed ONLY for dairsharaf-staging + the staging Worker with the always-pass TEST secret in enforce mode', () => {
  assert.doesNotThrow(() => assertTestTurnstileAllowed(st, REAL_TOML), 'the current wrangler.staging.toml qualifies');
  const swap = (re, to) => REAL_TOML.replace(re, to);
  const bad = [
    swap(/TURNSTILE_SECRET = "[^"]+"/, 'TURNSTILE_SECRET = "0x4AAAAAAAREALLOOKINGSECRET"'),
    swap(/TURNSTILE_SECRET = "[^"]+"/, 'TURNSTILE_SECRET = "2x0000000000000000000000000000000AA"'),
    swap(/TURNSTILE_MODE = "[^"]+"/, 'TURNSTILE_MODE = "log"'),
    swap(/TURNSTILE_MODE = "[^"]+"/, 'TURNSTILE_MODE = "off"'),
    swap(/^name = "[^"]+"/m, 'name = "anta-order-notify"'),
    swap(/ENVIRONMENT = "[^"]+"/, 'ENVIRONMENT = "production"'),
    swap(/FIREBASE_PROJECT_ID = "[^"]+"/, 'FIREBASE_PROJECT_ID = "antastore1-82b50"'),
    swap(/^TURNSTILE_SECRET = .*$/m, '# TURNSTILE_SECRET = "1x0000000000000000000000000000000AA"'),
  ];
  for (const t of bad) assert.throws(() => assertTestTurnstileAllowed(st, t), StagingGuardError);
  assert.throws(() => assertTestTurnstileAllowed({ ...st, projectId: 'other-staging' }, REAL_TOML), /project must be/);
  assert.throws(() => assertTestTurnstileAllowed({ ...st, workerHost: 'anta-order-notify.acme.workers.dev' }, REAL_TOML), /upstream must be/);
  assert.throws(() => createProxy({ st: { ...st, projectId: 'other-staging' }, fetchImpl: async () => new Response('{}'), testTurnstile: true }), /staging project/);
});

test('main(): --test-turnstile refused BEFORE anything is contacted when the Worker config does not qualify', async () => {
  const up = fakeUpstream();
  const base = { config: cfg, env: {}, realFetch: up, keepOpen: false, log: () => {} };
  await assert.rejects(proxyMain(['--port', '18790', '--tokens', tokensPath, '--test-turnstile'], { ...base, wranglerText: REAL_TOML.replace('"enforce"', '"log"') }), /TURNSTILE_MODE=enforce/);
  assert.equal(up.calls.length, 0, 'no upstream call');
  assert.equal(await proxyMain(['--port', '18790', '--tokens', tokensPath, '--test-turnstile'], { ...base, wranglerText: REAL_TOML }), 0);
});

test('create path (FAKE upstream, create explicitly enabled only for this test): token injected server-side, order unchanged, never echoed', async () => {
  const up = fakeUpstream();
  const logs = [];
  const server = createProxy({ st, fetchImpl: guardedFetch(st, up, { stagingAccessToken: SECRET }), secret: SECRET, allowCreate: true, testTurnstile: true, log: (l) => logs.push(l) });
  const port = await listenLoopback(server, 0);
  try {
    const order = checkoutOrder({ id: ID, items: [line('p-simple', 1)] });
    const body = JSON.stringify({ order });
    const r = await call(port, { method: 'POST', path: '/create-order', headers: { 'content-type': 'application/json' }, body });
    assert.equal(r.status, 200);
    const sent = JSON.parse(up.calls[0].body);
    assert.equal(sent.turnstileToken, TEST_TURNSTILE_TOKEN);
    assert.deepEqual(sent.order, order, 'price, items, totals unchanged');
    assert.ok(!r.text.includes(TEST_TURNSTILE_TOKEN) && !JSON.stringify(r.headers).includes(TEST_TURNSTILE_TOKEN), 'nothing sent back to the browser');
    assert.equal(JSON.parse(logs.at(-1)).turnstile, 'injected');
    assert.ok(!logs.join('\n').includes(TEST_TURNSTILE_TOKEN) && !logs.join('\n').includes(SECRET));
    // the client's own token: forwarded as is
    await call(port, { method: 'POST', path: '/create-order', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order, turnstileToken: 'from-widget' }) });
    assert.equal(JSON.parse(up.calls[1].body).turnstileToken, 'from-widget');
    assert.equal(JSON.parse(logs.at(-1)).turnstile, 'client');
  } finally { await new Promise((r) => server.close(r)); }
});

test('defaults: no flag = no token added; create disabled = nothing forwarded even with the flag', async () => {
  const off = await startProxy({ allowCreate: true });
  try {
    const body = JSON.stringify({ order: { id: ID } });
    await call(off.port, { method: 'POST', path: '/create-order', headers: { 'content-type': 'application/json' }, body });
    assert.equal(off.up.calls[0].body, body, 'byte-identical, no token');
    assert.equal(JSON.parse(off.logs.at(-1)).turnstile, 'off');
  } finally { await off.close(); }
  const up = fakeUpstream();
  const server = createProxy({ st, fetchImpl: guardedFetch(st, up, { stagingAccessToken: SECRET }), secret: SECRET, allowCreate: false, testTurnstile: true, log: () => {} });
  const port = await listenLoopback(server, 0);
  try {
    const r = await call(port, { method: 'POST', path: '/create-order', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'STAGING_PROXY_CREATE_DISABLED');
    assert.equal(up.calls.length, 0);
  } finally { await new Promise((r) => server.close(r)); }
});
