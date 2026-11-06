// LOCAL staging proxy: the local storefront (Vite dev server, http://127.0.0.1:3000, VITE_FIREBASE_TARGET=staging)
// -> http://127.0.0.1:<port> (this process) -> anta-order-notify-staging, adding x-staging-access.
//
//   STAGING_TOKENS_FILE=<abs path outside the repo> \
//   node staging/proxy.mjs --config staging/staging.config.json [--port 8789]
//   (POST /create-order is answered 403 STAGING_PROXY_CREATE_DISABLED unless started with
//    --allow-create --confirm anta-order-notify-staging — a separate, explicit decision)
//   [--test-turnstile]  OFF by default: adds Cloudflare's dummy TEST token to create-order bodies that carry none,
//    only if wrangler.staging.toml uses the always-pass TEST secret with TURNSTILE_MODE=enforce (staging only)
//
// Security
// - Refuses to start unless: the staging guard passes (project dairsharaf-staging only, staging Worker + sink URLs,
//   staging service account), the access secret comes from a file OUTSIDE the repository (>= 32 chars), and the live
//   Worker proves it is the gated staging build (no header -> 403 STAGING_ACCESS_DENIED; secret -> gate passed).
// - Listens on 127.0.0.1 only. Every request must carry Host 127.0.0.1:<port> (DNS rebinding) and Origin == the
//   local storefront (other sites, and requests without Origin, are refused). CORS is answered for that origin only.
// - Forwards ONLY: POST /create-order, GET /orders/<id>/status, GET /orders/<id>/summary — never /test,
//   /notify-order or anything else; no query strings. Request headers forwarded: content-type, authorization
//   (Firebase ID token), x-tracking-key. A client that sends x-staging-access itself is refused.
// - The secret is added by staging/guard.mjs guardedFetch (order Worker host only) and never appears in a response,
//   a log line or an error. Logs: method, route, status, duration — no headers, bodies or ids.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, isAbsolute, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertStagingConfig, guardedFetch, loadStagingConfigFile, StagingGuardError, REPO_ROOT, STAGING_PROJECT_ID, STAGING_WORKER_NAME } from './guard.mjs';
import { STAGING_ACCESS_MIN_LENGTH } from '../src/http.js';
import { TURNSTILE_TEST_SECRETS } from '../src/config.js';
import { parseArgs, runCli } from './common.mjs';

export const PROXY_ALLOWED_ORIGIN = 'http://127.0.0.1:3000'; // vite.config.ts: 127.0.0.1:3000, strictPort
export const DEFAULT_PROXY_PORT = 8789;
export const MAX_BODY_BYTES = 32 * 1024; // = the Worker's MAX_BODY_BYTES
export const UPSTREAM_TIMEOUT_MS = 20_000;
const ID = '(ORD-[A-Z0-9]{4,16}-[A-Z0-9]{4,16})'; // = Worker validate.js ORDER_ID_RE
export const ROUTES = Object.freeze([
  { name: 'create', method: 'POST', re: /^\/create-order$/ },
  { name: 'status', method: 'GET', re: new RegExp(`^/orders/${ID}/status$`) },
  { name: 'summary', method: 'GET', re: new RegExp(`^/orders/${ID}/summary$`) },
]);
const REQ_HEADERS = ['content-type', 'authorization', 'x-tracking-key'];
const RES_HEADERS = ['content-type', 'retry-after'];

// ---- test Turnstile token (staging only, OFF by default) -----------------------------------------------------
// The storefront does not run the Turnstile widget yet, but the staging Worker enforces Turnstile
// (TURNSTILE_MODE=enforce) with Cloudflare's always-pass TEST secret. With --test-turnstile the proxy adds
// Cloudflare's documented dummy token to POST /create-order bodies that carry NO turnstileToken — nothing else.
// Not a secret: the dummy token is public and is only ever accepted by the public test secret.
export const TEST_TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
/** Cloudflare's always-pass test secret (the other test secrets always fail / report a spent token) */
export const ALWAYS_PASS_TEST_SECRET = '1x0000000000000000000000000000000AA';

/**
 * The staging Worker config must prove the token can only ever be checked by the always-pass TEST secret, in
 * enforce mode, on the staging Worker. Text based (the deploy guard reads the same file).
 */
export function assertTestTurnstileAllowed(st, wranglerText) {
  const code = String(wranglerText || '').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  const v = (k) => (code.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]*)"`, 'm')) || [])[1];
  const p = [];
  if (st.projectId !== STAGING_PROJECT_ID) p.push(`--test-turnstile: project must be ${STAGING_PROJECT_ID}`);
  if (!st.workerHost?.startsWith(`${STAGING_WORKER_NAME}.`)) p.push(`--test-turnstile: upstream must be ${STAGING_WORKER_NAME}`);
  if (v('name') !== STAGING_WORKER_NAME) p.push(`--test-turnstile: wrangler.staging.toml name is not ${STAGING_WORKER_NAME}`);
  if (v('ENVIRONMENT') !== 'staging') p.push('--test-turnstile: ENVIRONMENT is not staging');
  if (v('FIREBASE_PROJECT_ID') !== STAGING_PROJECT_ID) p.push(`--test-turnstile: FIREBASE_PROJECT_ID is not ${STAGING_PROJECT_ID}`);
  if (v('TURNSTILE_MODE') !== 'enforce') p.push('--test-turnstile: the staging Worker must keep TURNSTILE_MODE=enforce');
  if (v('TURNSTILE_SECRET') !== ALWAYS_PASS_TEST_SECRET || !TURNSTILE_TEST_SECRETS.includes(v('TURNSTILE_SECRET'))) {
    p.push("--test-turnstile: the staging Worker's TURNSTILE_SECRET is not Cloudflare's always-pass TEST secret — refusing");
  }
  if (p.length) throw new StagingGuardError(p);
}

/**
 * Adds the test token to a create-order body that has none. Returns { body, turnstile } where turnstile is
 * 'injected' | 'client' (the client sent its own: forwarded untouched) | 'unchanged' (not a JSON object: the Worker
 * answers INVALID_JSON itself). The rest of the body stays BYTE-identical (text insertion, no re-serialisation).
 */
export function addTestTurnstile(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { body: text, turnstile: 'unchanged' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { body: text, turnstile: 'unchanged' };
  if (Object.prototype.hasOwnProperty.call(parsed, 'turnstileToken')) return { body: text, turnstile: 'client' };
  const end = text.lastIndexOf('}');
  const inner = text.slice(0, end).trimEnd();
  const sep = inner.endsWith('{') ? '' : ',';
  return { body: `${inner}${sep}"turnstileToken":${JSON.stringify(TEST_TURNSTILE_TOKEN)}${text.slice(end)}`, turnstile: 'injected' };
}

const isInside = (child, parent) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** Reads STAGING_ACCESS_TOKEN from a JSON file outside the repository. Errors never contain the value. */
export function loadAccessToken(path, { repoRoot = REPO_ROOT } = {}) {
  const p = String(path || '');
  if (!p || !isAbsolute(p)) throw new StagingGuardError(['tokens file: an absolute path is required (STAGING_TOKENS_FILE or --tokens)']);
  if (isInside(resolve(p), repoRoot)) throw new StagingGuardError(['tokens file must live OUTSIDE the repository']);
  let token;
  try {
    token = JSON.parse(readFileSync(p, 'utf8')).STAGING_ACCESS_TOKEN;
  } catch {
    throw new StagingGuardError(['tokens file unreadable or not JSON']);
  }
  if (typeof token !== 'string' || token.length < STAGING_ACCESS_MIN_LENGTH) throw new StagingGuardError([`tokens file: STAGING_ACCESS_TOKEN missing or shorter than ${STAGING_ACCESS_MIN_LENGTH}`]);
  return token;
}

/**
 * Live, read-only proof that the upstream is the gated STAGING order Worker:
 *  GET /                         -> 200 service order-worker
 *  GET /orders/ORD-1/status, no header      -> 403 STAGING_ACCESS_DENIED   (gate present and active)
 *  GET /orders/ORD-1/status, with the secret -> 400 INVALID_ID              (secret accepted; refused BEFORE Firestore)
 */
export async function verifyUpstream(st, fetchImpl) {
  const p = [];
  const j = async (r) => { try { return await r.json(); } catch { return null; } };
  const root = await fetchImpl(`${st.workerUrl}/`);
  const rb = await j(root);
  if (root.status !== 200 || rb?.service !== 'order-worker') p.push(`upstream ${st.workerHost} is not a healthy order Worker (${root.status})`);
  const no = await fetchImpl(`${st.workerUrl}/orders/ORD-1/status`, { headers: { 'x-staging-access': '' } });
  if (no.status !== 403 || (await j(no))?.code !== 'STAGING_ACCESS_DENIED') p.push('upstream does not enforce the staging access gate — refusing');
  const yes = await fetchImpl(`${st.workerUrl}/orders/ORD-1/status`);
  if (yes.status !== 400 || (await j(yes))?.code !== 'INVALID_ID') p.push(`upstream did not accept the staging access secret (${yes.status})`);
  if (p.length) throw new StagingGuardError(p);
}

const send = (res, status, body, extra = {}) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  res.end(text);
};

function readBody(req, limit) {
  return new Promise((ok) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) { done = true; ok({ error: 413 }); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; ok({ body: Buffer.concat(chunks).toString('utf8') }); } });
    req.on('error', () => { if (!done) { done = true; ok({ error: 400 }); } });
  });
}

/**
 * Builds the proxy server (not listening). `fetchImpl` must be the guarded fetch that adds x-staging-access for the
 * order Worker only (guardedFetch(st, realFetch, { stagingAccessToken })). `secret` is only used to make sure it is
 * never echoed back.
 */
export function createProxy({ st, fetchImpl, secret, allowCreate = false, testTurnstile = false, allowedOrigin = PROXY_ALLOWED_ORIGIN, log = (l) => console.log(l) }) {
  if (!st?.workerUrl || typeof fetchImpl !== 'function') throw new StagingGuardError(['proxy: staging config and guarded fetch required']);
  // the test token is only possible for the staging project + the staging order Worker (the CLI also checks the
  // Worker's Turnstile config: assertTestTurnstileAllowed)
  if (testTurnstile && (st.projectId !== STAGING_PROJECT_ID || !st.workerHost?.startsWith(`${STAGING_WORKER_NAME}.`))) {
    throw new StagingGuardError(['test Turnstile token: staging project + staging order Worker only']);
  }
  const cors = { 'access-control-allow-origin': allowedOrigin, vary: 'Origin' };
  let port = null;
  const server = createServer(async (req, res) => {
    const t0 = Date.now();
    let route = '-';
    let turnstile; // create-order only: 'injected' | 'client' | 'unchanged' | 'off' (never the token itself)
    const line = (status) => JSON.stringify({ event: 'staging_proxy', method: req.method, route, status, ms: Date.now() - t0, ...(turnstile ? { turnstile } : {}) });
    const done = (status, body, extra) => {
      send(res, status, body, extra);
      log(line(status));
    };
    try {
      // DNS rebinding: only our own loopback host:port
      if (req.headers.host !== `127.0.0.1:${port}`) return done(421, { ok: false, code: 'PROXY_BAD_HOST' });
      // other sites (and requests without Origin) are refused: only the local storefront may call
      if (req.headers.origin !== allowedOrigin) return done(403, { ok: false, code: 'PROXY_ORIGIN_NOT_ALLOWED' });
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.search || url.hash || req.url.includes('..') || req.url.includes('%2')) return done(404, { ok: false, code: 'NOT_FOUND' }, cors);
      const isPreflight = req.method === 'OPTIONS';
      const wantMethod = isPreflight ? String(req.headers['access-control-request-method'] || '').toUpperCase() : req.method;
      const r = ROUTES.find((x) => x.method === wantMethod && x.re.test(url.pathname));
      if (!r) return done(404, { ok: false, code: 'NOT_FOUND' }, cors);
      route = r.name;

      if (isPreflight) {
        const asked = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
        if (asked.some((h) => !REQ_HEADERS.includes(h))) return done(403, { ok: false, code: 'PROXY_HEADER_NOT_ALLOWED' });
        res.writeHead(204, { ...cors, 'access-control-allow-methods': r.method, 'access-control-allow-headers': REQ_HEADERS.join(', '), 'access-control-max-age': '600' });
        res.end();
        log(JSON.stringify({ event: 'staging_proxy', method: 'OPTIONS', route, status: 204, ms: Date.now() - t0 }));
        return;
      }
      // the browser never holds the staging secret: a client that sends the header is refused outright
      if (req.headers['x-staging-access'] !== undefined) return done(400, { ok: false, code: 'PROXY_STAGING_HEADER_NOT_ALLOWED' }, cors);
      if (r.name === 'create' && !allowCreate) return done(403, { ok: false, code: 'STAGING_PROXY_CREATE_DISABLED' }, cors);

      const headers = {};
      for (const h of REQ_HEADERS) if (typeof req.headers[h] === 'string') headers[h] = req.headers[h];
      headers.origin = allowedOrigin;
      let body;
      if (req.method === 'POST') {
        const b = await readBody(req, MAX_BODY_BYTES);
        if (b.error) return done(b.error, { ok: false, code: b.error === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_BODY' }, cors);
        body = b.body;
        if (r.name === 'create') {
          if (testTurnstile) ({ body, turnstile } = addTestTurnstile(body));
          else turnstile = 'off';
        }
      }
      let up;
      try {
        up = await fetchImpl(`${st.workerUrl}${url.pathname}`, { method: req.method, headers, body, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      } catch {
        // never "success": the storefront treats 502 as "not confirmed" and checks the status with the same number
        return done(502, { ok: false, code: 'PROXY_UPSTREAM_UNAVAILABLE' }, cors);
      }
      const text = await up.text();
      if (secret && text.includes(secret)) return done(502, { ok: false, code: 'PROXY_UPSTREAM_BLOCKED' }, cors);
      const out = { ...cors, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
      for (const h of RES_HEADERS) { const v = up.headers.get(h); if (v) out[h] = v; }
      res.writeHead(up.status, out);
      res.end(text);
      log(line(up.status));
    } catch {
      if (!res.headersSent) done(500, { ok: false, code: 'PROXY_ERROR' }, cors);
      else res.destroy();
    }
  });
  server.on('listening', () => { port = server.address().port; });
  return server;
}

/** Listens on 127.0.0.1 only; resolves with the bound port. */
export function listenLoopback(server, port) {
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen({ host: '127.0.0.1', port }, () => ok(server.address().port));
  });
}

export async function main(argv, deps = {}) {
  const a = parseArgs(argv);
  const env = deps.env ?? process.env;
  const st = assertStagingConfig(deps.config ?? loadStagingConfigFile(a.config), { env });
  if (st.projectId !== STAGING_PROJECT_ID) throw new StagingGuardError([`proxy serves ${STAGING_PROJECT_ID} only`]);
  if (!st.workerHost.startsWith(`${STAGING_WORKER_NAME}.`)) throw new StagingGuardError(['upstream is not the staging order Worker']);
  const allowCreate = a.flags.has('allow-create');
  if (allowCreate && a.confirm !== STAGING_WORKER_NAME) throw new StagingGuardError([`--allow-create needs --confirm ${STAGING_WORKER_NAME}`]);
  const port = a.port === undefined ? DEFAULT_PROXY_PORT : Number(a.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new StagingGuardError(['--port must be 1024..65535']);
  // test Turnstile token: separate, explicit opt-in; refused unless the staging Worker config uses the always-pass
  // TEST secret in enforce mode (checked BEFORE the secret is loaded or anything is contacted)
  const testTurnstile = a.flags.has('test-turnstile');
  if (testTurnstile) assertTestTurnstileAllowed(st, deps.wranglerText ?? readFileSync(resolve(REPO_ROOT, 'workers/order-worker/wrangler.staging.toml'), 'utf8'));
  const secret = loadAccessToken(a.tokens ?? env.STAGING_TOKENS_FILE);
  const fetchImpl = guardedFetch(st, deps.realFetch ?? globalThis.fetch, { stagingAccessToken: secret });
  await verifyUpstream(st, fetchImpl);
  const server = createProxy({ st, fetchImpl, secret, allowCreate, testTurnstile, log: deps.log });
  const bound = await listenLoopback(server, port);
  console.log(`staging proxy: http://127.0.0.1:${bound} -> ${STAGING_WORKER_NAME} (project ${st.projectId}); origin ${PROXY_ALLOWED_ORIGIN} only; create-order ${allowCreate ? 'ENABLED' : 'DISABLED'}; test Turnstile token ${testTurnstile ? 'ON (only when the body has none)' : 'OFF'}`);
  return deps.keepOpen === false ? (server.close(), 0) : new Promise(() => {});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli(main);
