// tests/deploy-guard/guard.test.mjs — fast, isolated deploy-guard tests (no build, no browser, no network).
//   node tests/deploy-guard/guard.test.mjs
// globalThis.fetch is replaced by a trap: any outbound call is recorded and answered by a fake; nothing leaves
// this process. Production identifiers are never printed.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const imp = (p) => import(new URL(`file:///${join(ROOT, p).replace(/\\/g, '/')}`).href);
const { resolveDeployEnv, stripTracking, SANDBOX_ENV_PREFIX } = await imp('scripts/deploy-env.mjs');
const createOrder = (await imp('api/create-order.js')).default;
const notifyCustomer = (await imp('api/notify-customer.js')).default;

// ---------- outbound trap ----------
let outbound = [];
globalThis.fetch = async (url, init = {}) => {
  outbound.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {} });
  if (String(url).includes('api.sendgrid.com')) return new Response(null, { status: 202 });
  return new Response(JSON.stringify({ ok: true, fake: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};

// ---------- env helpers (restore after each test) ----------
const ENV_KEYS = ['VERCEL', 'VERCEL_ENV', 'STORE_BUILD_TARGET', 'WORKER_AUTH_TOKEN', 'SENDGRID_API_KEY', 'NOTIFY_ADMIN_UIDS'];
const withEnv = async (vars, fn) => {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
  try { return await fn(); } finally {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
};

// Vercel-like req/res
const mkRes = () => {
  const r = { code: 200, body: undefined, headers: {}, ended: false,
    status(c) { r.code = c; return r; }, json(b) { r.body = b; r.ended = true; return r; },
    send(b) { r.body = b; r.ended = true; return r; }, end() { r.ended = true; return r; },
    setHeader(k, v) { r.headers[k.toLowerCase()] = v; } };
  return r;
};
const call = async (handler, { method = 'POST', headers = {}, body } = {}) => {
  const res = mkRes();
  await handler({ method, headers, body: body ?? { order: { id: 'T-1', total: 1 } } }, res);
  return res;
};

const rows = [];
const t = async (id, desc, fn) => {
  outbound = [];
  try { await fn(); rows.push([id, 'PASS', desc]); }
  catch (e) { rows.push([id, 'FAIL', `${desc} :: ${e.message}`]); process.exitCode = 1; }
};

// ================= build-time decision (X02 / X09-env / X15-env) =================
await t('U01', 'resolveDeployEnv: only VERCEL_ENV="production" (or explicit off-Vercel target) is production', async () => {
  const P = 'production', S = 'sandbox';
  const cases = [
    [{ VERCEL: '1', VERCEL_ENV: 'production' }, P],
    [{ VERCEL_ENV: 'production' }, P],
    [{ VERCEL: '1', VERCEL_ENV: 'preview' }, S],
    [{ VERCEL: '1', VERCEL_ENV: 'development' }, S],
    [{ VERCEL: '1' }, S],
    [{ VERCEL: '1', VERCEL_ENV: '' }, S],
    [{ VERCEL: '1', VERCEL_ENV: 'Production' }, S],
    [{ VERCEL: '1', VERCEL_ENV: 'PRODUCTION' }, S],
    [{ VERCEL: '1', VERCEL_ENV: 'production ' }, S],
    [{ VERCEL: '1', VERCEL_ENV: ' production' }, S],
    [{ VERCEL: '1', VERCEL_ENV: 'prod' }, S],
    [{ VERCEL: '1', VERCEL_ENV: 'staging' }, S],
    [{ VERCEL: '1', VERCEL_ENV: 'preview', STORE_BUILD_TARGET: 'production' }, S],
    [{ VERCEL: '1', STORE_BUILD_TARGET: 'production' }, S],
    [{ VERCEL_ENV: 'preview', STORE_BUILD_TARGET: 'production' }, S],
    [{}, S],
    [{ STORE_BUILD_TARGET: 'production' }, P],
    [{ STORE_BUILD_TARGET: 'Production' }, S],
    [{ STORE_BUILD_TARGET: 'true' }, S],
    [{ VERCEL: 'true', VERCEL_ENV: 'preview' }, S],
  ];
  for (const [env, want] of cases) assert.equal(resolveDeployEnv(env).deployEnv, want, JSON.stringify(env));
});

await t('U01b', 'local-test: only OFF Vercel with an explicit VITE_FIREBASE_TARGET=emulator|staging; never on Vercel, never over production', async () => {
  const P = 'production', S = 'sandbox', L = 'local-test';
  const cases = [
    [{}, 'emulator', L],
    [{}, 'staging', L],
    [{}, undefined, S],
    [{}, '', S],
    [{}, 'production', S],
    [{}, 'Emulator', S],
    [{}, 'emulator ', S],
    [{}, 'demo', S],
    // on Vercel the local target is ignored: Preview / unknown => sandbox, Production => production
    [{ VERCEL: '1', VERCEL_ENV: 'preview' }, 'emulator', S],
    [{ VERCEL: '1', VERCEL_ENV: 'preview' }, 'staging', S],
    [{ VERCEL: '1' }, 'emulator', S],
    [{ VERCEL_ENV: 'development' }, 'staging', S],
    [{ VERCEL: '1', VERCEL_ENV: 'production' }, 'emulator', P],
    // an explicit off-Vercel production build stays production (build:hosting then requires the production markers)
    [{ STORE_BUILD_TARGET: 'production' }, 'emulator', P],
  ];
  for (const [env, firebaseTarget, want] of cases) {
    assert.equal(resolveDeployEnv(env, { firebaseTarget }).deployEnv, want, JSON.stringify({ env, firebaseTarget }));
  }
});

await t('U02', 'sandbox env prefix is not a prefix of any VITE_* name', async () => {
  assert.ok(!'VITE_WORKER_URL'.startsWith(SANDBOX_ENV_PREFIX) && SANDBOX_ENV_PREFIX.length > 8);
});

const TRACKER_SNIPPET = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-E4P313LDJ0"></script>
<script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', 'G-E4P313LDJ0');</script>
<script>!function(f,b,e,v){f.fbq=function(){};}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js'); fbq('init', '406363479141487'); fbq('track', 'PageView');</script>
`;
await t('U03', 'stripTracking removes GA + Meta Pixel from the real index.html and keeps the app entry', async () => {
  // the trackers are no longer in index.html at all (loaded after cookie consent, production only:
  // src/services/tracking.ts). stripTracking stays as a second line of defence, checked on the real page with the
  // old inline snippets added back.
  const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.ok(!/googletagmanager|fbq\(|connect\.facebook\.net/.test(real), 'index.html loads no tracker');
  assert.match(readFileSync(join(ROOT, 'src/services/tracking.ts'), 'utf8'), /if \(!IS_LIVE\) return;/, 'tracking.ts: production only');
  const html = real.replace('</head>', `${TRACKER_SNIPPET}</head>`);
  assert.ok(/googletagmanager|fbq\(/.test(html), 'fixture should contain the tags');
  const out = stripTracking(html);
  for (const m of ['googletagmanager.com', 'gtag(', 'fbq(', 'connect.facebook.net', 'dataLayer']) assert.ok(!out.includes(m), m);
  assert.ok(out.includes('<script type="module" src="/src/main.tsx"></script>'));
  assert.ok(out.includes('<div id="root"></div>') && out.includes('fonts.googleapis.com/css2'));
  assert.equal(stripTracking(out), out, 'idempotent');
});

// ================= /api/create-order (X08, X15, X14) =================
const SANDBOX_ENVS = [['preview', { VERCEL: '1', VERCEL_ENV: 'preview' }], ['development', { VERCEL: '1', VERCEL_ENV: 'development' }],
  ['unset', { VERCEL: '1' }], ['Production(case)', { VERCEL: '1', VERCEL_ENV: 'Production' }], ['empty', { VERCEL_ENV: '' }], ['local', {}]];

await t('X08', '/api/create-order: POST/GET/OPTIONS/PUT in every non-production env -> 403 SANDBOX_DISABLED, zero outbound, no CORS grant', async () => {
  for (const [label, env] of SANDBOX_ENVS) for (const method of ['POST', 'GET', 'OPTIONS', 'PUT']) {
    const r = await withEnv({ ...env, WORKER_AUTH_TOKEN: 'FAKE-WORKER-TOKEN' }, () => call(createOrder, { method }));
    assert.equal(r.code, 403, `${label} ${method}`);
    assert.equal(r.body.code, 'SANDBOX_DISABLED');
    assert.equal(r.headers['x-deploy-env'], 'sandbox');
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    assert.ok(!JSON.stringify(r.body).includes('FAKE-WORKER-TOKEN'));
  }
  assert.equal(outbound.length, 0);
});

await t('X15', 'spoofed request headers (x-vercel-env, host, origin) cannot open the API guard', async () => {
  const headers = { 'x-vercel-env': 'production', host: 'dairsharaf.com', origin: 'https://dairsharaf.com', 'x-forwarded-host': 'dairsharaf.com' };
  for (const h of [createOrder, notifyCustomer]) {
    const r = await withEnv({ VERCEL: '1', VERCEL_ENV: 'preview' }, () => call(h, { headers }));
    assert.equal(r.code, 403);
  }
  assert.equal(outbound.length, 0);
});

await t('X14a', 'PRODUCTION /api/create-order is retired: every method -> 410 GONE, nothing forwarded, no secret used, no CORS grant', async () => {
  for (const method of ['POST', 'GET', 'OPTIONS']) {
    const r = await withEnv({ VERCEL: '1', VERCEL_ENV: 'production', WORKER_AUTH_TOKEN: 'FAKE-WORKER-TOKEN' }, () => call(createOrder, { method, body: { order: { id: 'T-2' } } }));
    assert.equal(r.code, 410, method);
    assert.equal(r.body?.code, 'GONE');
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    assert.equal(r.headers['x-deploy-env'], undefined);
    assert.ok(!JSON.stringify(r.body).includes('FAKE-WORKER-TOKEN'));
  }
  assert.equal(outbound.length, 0);
});

// ================= /api/notify-customer (X09, X14) =================
const NOTIFY_BODY = { email: 'customer@example.com', name: 'Test', orderId: 'ORD-1', status: 'accepted' };
await t('X09', '/api/notify-customer in every non-production env, with a key and a bearer token -> 403, zero e-mail', async () => {
  for (const [label, env] of SANDBOX_ENVS) for (const method of ['POST', 'GET', 'OPTIONS']) {
    const r = await withEnv({ ...env, SENDGRID_API_KEY: 'FAKE-SG-KEY' }, () =>
      call(notifyCustomer, { method, headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.x' }, body: NOTIFY_BODY }));
    assert.equal(r.code, 403, `${label} ${method}`);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(outbound.length, 0);
});

await t('X14b', 'PRODUCTION /api/notify-customer = S1 rules through the real entry point: no admin list -> 503, no token -> 401, GET -> 405, zero e-mail', async () => {
  const a = await withEnv({ VERCEL: '1', VERCEL_ENV: 'production', SENDGRID_API_KEY: 'FAKE-SG-KEY' }, () => call(notifyCustomer, { body: NOTIFY_BODY }));
  assert.equal(a.code, 503); assert.equal(a.body.code, 'NOT_CONFIGURED');
  const b = await withEnv({ VERCEL: '1', VERCEL_ENV: 'production', SENDGRID_API_KEY: 'FAKE-SG-KEY', NOTIFY_ADMIN_UIDS: 'AdminUid0123456789' }, () => call(notifyCustomer, { body: NOTIFY_BODY }));
  assert.equal(b.code, 401); assert.equal(b.body.code, 'AUTH_REQUIRED');
  const g = await withEnv({ VERCEL: '1', VERCEL_ENV: 'production' }, () => call(notifyCustomer, { method: 'GET' }));
  assert.equal(g.code, 405);
  assert.equal(outbound.length, 0);
});

await t('X14c', 'PRODUCTION legitimate admin e-mail still works through the real entry point: verified admin token -> 200, exactly one (fake) SendGrid call', async () => {
  const { makeTestSigner } = await imp('workers/order-worker/test/token-signer.mjs');
  const { PROJECT_ID } = await imp('api/notify-customer.js');
  const auth = await imp('workers/order-worker/src/auth.js');
  auth.clearKeyCache?.();
  const signer = await makeTestSigner('kid-guard');
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === auth.GOOGLE_SECURETOKEN_JWKS_URL) return new Response(JSON.stringify({ keys: [signer.jwk] }), { status: 200, headers: { 'cache-control': 'max-age=60' } });
    return prevFetch(url, init);
  };
  try {
    const token = await signer.idToken({ projectId: PROJECT_ID, uid: 'AdminUid0123456789', ttlSec: 600 });
    const r = await withEnv({ VERCEL: '1', VERCEL_ENV: 'production', SENDGRID_API_KEY: 'FAKE-SG-KEY', NOTIFY_ADMIN_UIDS: 'AdminUid0123456789' },
      () => call(notifyCustomer, { headers: { authorization: `Bearer ${token}` }, body: NOTIFY_BODY }));
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const sg = outbound.filter((o) => new URL(o.url).hostname === 'api.sendgrid.com');
    assert.equal(sg.length, 1);
  } finally { globalThis.fetch = prevFetch; }
});

// ================= X19: direct HTTP requests to the API (as a curl / browser would) =================
await t('X19', 'direct HTTP POSTs (JSON, form, oversized, malformed) to both API routes on a sandbox server -> 403, zero outbound', async () => {
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    let body; try { body = JSON.parse(raw); } catch { body = raw; }
    const r = mkRes();
    const h = req.url.startsWith('/api/create-order') ? createOrder : req.url.startsWith('/api/notify-customer') ? notifyCustomer : null;
    if (!h) { res.writeHead(404).end(); return; }
    await h({ method: req.method, headers: req.headers, body }, r);
    res.writeHead(r.code, r.headers); res.end(r.body === undefined ? '' : JSON.stringify(r.body));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const realFetch = (await import('node:http')).request;
  const send = (path, method, body, type = 'application/json') => new Promise((ok, no) => {
    const req = realFetch(base + path, { method, headers: { 'content-type': type, origin: 'https://evil.example' } }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: d }));
    });
    req.on('error', no); if (body) req.write(body); req.end();
  });
  try {
    await withEnv({ VERCEL: '1', VERCEL_ENV: 'preview', WORKER_AUTH_TOKEN: 'FAKE', SENDGRID_API_KEY: 'FAKE' }, async () => {
      for (const p of ['/api/create-order', '/api/notify-customer', '/api/create-order?x=1', '/api/notify-customer/']) {
        for (const [body, type] of [[JSON.stringify({ order: { id: 'X' } }), 'application/json'], [JSON.stringify(NOTIFY_BODY), 'application/json'],
          ['a=1&b=2', 'application/x-www-form-urlencoded'], ['{not json', 'application/json'], ['x'.repeat(200000), 'text/plain']]) {
          const r = await send(p, 'POST', body, type);
          assert.equal(r.status, 403, `${p} ${type}`);
          assert.equal(r.headers['x-deploy-env'], 'sandbox');
          assert.equal(r.headers['access-control-allow-origin'], undefined);
        }
      }
    });
  } finally { server.close(); }
  assert.equal(outbound.length, 0);
});

for (const r of rows) console.log(r.join(' | '));
console.log(`\n${rows.filter((r) => r[1] === 'PASS').length}/${rows.length} passed`);
