// LOCAL e2e — inner part. Started by run.mjs through `firebase emulators:exec` (Firestore emulator already up).
// Starts the notify sink and the order Worker with `wrangler dev --local`, a local Turnstile mock, then runs
// the shared scenarios S01–S12 (staging/scenarios.mjs). Everything is on 127.0.0.1.

import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { measureCpu, workerdUnder } from './cpu-measure.mjs';
import { readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { Firestore, encodeFields, decodeFields } from '../../src/firestore.js';
import { PRODUCTS } from '../fixtures.mjs';
import { MARKER_PATH } from '../../staging/common.mjs';
import { runScenarios } from '../../staging/scenarios.mjs';
import { runSubmitScenarios } from './submit-scenarios.mjs';
import { runApprovalScenarios } from '../../staging/approval-scenarios.mjs';
import { makeTestSigner } from '../token-signer.mjs';
import { launchChrome, openTab } from './cdp.mjs';
import { buildUiScenarios, runUiScenarios } from './ui-scenarios.mjs';
import { resolve as resolvePath } from 'node:path';
import { WORKER_ROOT } from './plan.mjs';
import { assertLocalPlan, localOnlyFetch } from './guard.mjs';
import { PLAN, PORTS, URLS, FILES, PROJECT_ID, TURNSTILE_PASS_TOKEN } from './plan.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TMP = process.env.E2E_TMP;
const CPU_MODE = process.env.E2E_MODE === 'cpu';
const SUITE = process.env.E2E_SUITE || 'all'; // all | scenarios | submit | ui | approval | approval-live
const children = [];

function fail(msg) {
  console.error(`[inner] ${msg}`);
  process.exit(2);
}

// ---------------------------------------------------------------- guards (before anything starts)
if (!globalThis.__E2E_NET_JAIL__) fail('network jail not loaded — refusing to run');
if (!TMP) fail('E2E_TMP missing — run through test/local-e2e/run.mjs');
assertLocalPlan(PLAN, process.env);
if (process.env.FIRESTORE_EMULATOR_HOST !== `127.0.0.1:${PORTS.emulator}`) fail('emulator is not on the planned port');
globalThis.fetch = localOnlyFetch(Object.values(PORTS), globalThis.fetch);

// ---------------------------------------------------------------- local Turnstile mock + chaos proxy (S13–S22)
const mockCalls = { turnstile: 0, chaos: 0, jwks: 0, unexpected: [] };
// TEST key pair for Firebase-style ID tokens, generated in memory for this run (never a Google key). The Worker
// fetches the public half from this mock (wrangler.order.toml AUTH_JWKS_URL); FORGER signs with another key.
const AUTH_SIGNER = await makeTestSigner('local-e2e-kid');
const AUTH_FORGER = await makeTestSigner('local-e2e-kid');
const chaosHits = new Map();
async function handleChaos(mode, path, req, res, body) {
  mockCalls.chaos += 1;
  const isCreate = path === '/create-order';
  let orderId = '';
  try {
    orderId = JSON.parse(body || '{}')?.order?.id || '';
  } catch {}
  const key = `${mode}|${orderId || path}`;
  const hit = (chaosHits.get(key) || 0) + 1;
  chaosHits.set(key, hit);
  const send = (status, obj, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(obj));
  };
  const proxy = async (delayMs = 0) => {
    const r = await fetch(`${URLS.order}${path}`, { method: req.method, headers: { 'content-type': 'application/json' }, body: req.method === 'POST' ? body : undefined });
    const text = await r.text();
    if (delayMs) await sleep(delayMs);
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(text);
  };
  switch (mode) {
    case 'drop':
      return req.socket.destroy();
    case 'hang':
      return undefined; // never answers; closed with the server
    case '500':
      return send(500, { ok: false, code: 'INTERNAL' });
    case 'fail-first':
      return isCreate && hit === 1 ? send(503, { ok: false, code: 'RETRY_LATER' }) : proxy();
    case '429once':
      return isCreate && hit === 1 ? send(429, { ok: false, code: 'RATE_LIMITED' }, { 'retry-after': '1' }) : proxy();
    case 'slow':
      // first create: the Worker commits, the answer is held past the client timeout; later requests pass
      return proxy(isCreate && hit === 1 ? 2500 : 0);
    case 'slow403':
    case 'slow403drop':
      // first create commits but its answer is lost; second create = 403 (single-use Turnstile token consumed)
      if (!isCreate) return mode === 'slow403drop' ? req.socket.destroy() : proxy();
      if (hit === 1) return proxy(2500);
      if (hit === 2) return send(403, { ok: false, code: 'TURNSTILE_FAILED' });
      return proxy();
    case 'hangcreate':
      return isCreate ? undefined : proxy(); // creates never answer, status works
    case 'hangfirst':
      return isCreate && hit === 1 ? undefined : proxy();
    default:
      return send(404, { ok: false, code: 'UNKNOWN_CHAOS' });
  }
}
// /ui/* — the UI suite's Worker URL in phase B: browser-facing (CORS) proxy whose behaviour is switched per scenario
let uiMode = 'pass';
const uiHits = new Map();

// ---- signed-in customers in the browser (TEST ONLY) ----
// The app signs in for real against the Auth EMULATOR, and the Firebase SDK sends its ID token. The Auth emulator
// cannot sign tokens (alg "none"), and the Worker correctly refuses unsigned tokens. So this proxy — and only this
// test proxy — re-signs the emulator's token with the run's TEST RSA key, copying uid and times; the Worker then does
// its full, unchanged RS256 verification against the local JWKS. Nothing leaves 127.0.0.1; tokens are never logged.
//   uiAuthMode: 'resign' (default) | 'expireFirst' (first create of an order is forwarded already expired) | 'forge'
let uiAuthMode = 'resign';
const uiAuthLog = []; // { path, orderId, sub, forwarded: 'valid'|'expired'|'forged'|'untranslated', rawId }
const rawIds = new Map(); // emulator token -> short id (to tell tokens apart without storing them)
async function translateEmulatorToken(raw, { orderId, path }) {
  let header;
  let claims;
  try {
    const [h, p] = raw.split('.');
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return { token: raw, kind: 'untranslated' };
  }
  if (!rawIds.has(raw)) rawIds.set(raw, `t${rawIds.size + 1}`);
  const rawId = rawIds.get(raw);
  // only Auth-EMULATOR tokens of THIS demo project are translated; anything else is forwarded as-is (and refused)
  if (header.alg !== 'none' || claims.aud !== PROJECT_ID || claims.iss !== `https://securetoken.google.com/${PROJECT_ID}` || typeof claims.sub !== 'string') {
    uiAuthLog.push({ path, orderId, sub: null, forwarded: 'untranslated', rawId });
    return { token: raw, kind: 'untranslated' };
  }
  const isFirstCreate = path === '/create-order' && !uiAuthLog.some((l) => l.orderId === orderId && l.path === path);
  const now = Math.floor(Date.now() / 1000);
  const kind = uiAuthMode === 'forge' ? 'forged' : uiAuthMode === 'expireFirst' && isFirstCreate ? 'expired' : 'valid';
  const times = kind === 'expired'
    ? { iat: now - 7200, auth_time: now - 7200, exp: now - 3600 }
    : { iat: claims.iat, auth_time: claims.auth_time ?? claims.iat, exp: claims.exp };
  const signerFor = kind === 'forged' ? AUTH_FORGER : AUTH_SIGNER;
  uiAuthLog.push({ path, orderId, sub: claims.sub, forwarded: kind, rawId });
  return {
    kind,
    token: await signerFor.sign({ iss: claims.iss, aud: claims.aud, sub: claims.sub, user_id: claims.sub, email: claims.email, email_verified: claims.email_verified, ...times }),
  };
}

async function handleUi(path, req, res, body) {
  const cors = { 'access-control-allow-origin': req.headers.origin || '*', vary: 'Origin', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization, x-tracking-key' };
  if (req.method === 'OPTIONS') {
    if (uiMode === 'drop') return req.socket.destroy();
    res.writeHead(204, cors);
    return res.end();
  }
  const isCreate = path === '/create-order';
  let orderId = '';
  try {
    orderId = JSON.parse(body || '{}')?.order?.id || '';
  } catch {}
  const key = `${uiMode}|${orderId || path}`;
  const hit = (uiHits.get(key) || 0) + 1;
  uiHits.set(key, hit);
  const send = (status, obj, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...cors, ...headers });
    res.end(JSON.stringify(obj));
  };
  const proxy = async (delayMs = 0) => {
    const headers = { 'content-type': 'application/json' };
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
    if (m) headers.authorization = `Bearer ${(await translateEmulatorToken(m[1], { orderId, path })).token}`;
    else if (req.headers.authorization) headers.authorization = req.headers.authorization; // malformed: pass, Worker refuses
    if (req.headers['x-tracking-key']) headers['x-tracking-key'] = String(req.headers['x-tracking-key']); // passed through, never logged
    const r = await fetch(`${URLS.order}${path}`, { method: req.method, headers, body: req.method === 'POST' ? body : undefined });
    const text = await r.text();
    if (delayMs === Infinity) return; // 'savehold': the Worker answered, the browser never gets it (closed by the run's end)
    if (delayMs) await sleep(delayMs);
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(r.status, { 'content-type': 'application/json', ...cors });
    res.end(text);
  };
  switch (uiMode) {
    case 'savehold':
      // saved by the Worker, the answer never reaches the browser (the tab is closed meanwhile)
      return isCreate ? proxy(Infinity) : proxy();
    case 'delaycreate':
      // the create reaches the Worker only after 8 s: still in flight while the tab is closed / reopened
      if (isCreate) await sleep(8_000);
      return proxy();
    case 'drop':
      return req.socket.destroy();
    case 'slow15':
      return proxy(isCreate && hit === 1 ? 15_000 : 0); // saved, but the answer arrives after the app's 12 s timeout
    case 'reject403':
      return isCreate ? send(403, { ok: false, code: 'TURNSTILE_FAILED' }) : proxy();
    case 'conflict409':
      return isCreate ? send(409, { ok: false, code: 'ORDER_ID_CONFLICT' }) : send(200, { ok: true, exists: true, status: 'new' });
    case '429once':
      return isCreate && hit === 1 ? send(429, { ok: false, code: 'RATE_LIMITED' }, { 'retry-after': '1', 'access-control-expose-headers': 'retry-after' }) : proxy();
    case '503':
      return isCreate ? send(503, { ok: false, code: 'RETRY_LATER' }) : proxy();
    case 'pass':
    default:
      return proxy();
  }
}

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const ui = req.url.match(/^\/ui(\/.*)$/);
    if (ui) {
      handleUi(ui[1], req, res, body).catch((e) => {
        if (!res.headersSent) {
          res.writeHead(502);
          res.end(String(e?.message || e));
        }
      });
      return;
    }
    const chaos = req.url.match(/^\/chaos\/([a-z0-9-]+)(\/.*)$/);
    if (chaos) {
      handleChaos(chaos[1], chaos[2], req, res, body).catch((e) => {
        if (!res.headersSent) {
          res.writeHead(502);
          res.end(String(e?.message || e));
        }
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/turnstile/siteverify') {
      mockCalls.turnstile += 1;
      const ok = new URLSearchParams(body).get('response') === TURNSTILE_PASS_TOKEN;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ success: ok }));
    }
    if (req.method === 'GET' && req.url === '/jwks') {
      mockCalls.jwks += 1;
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' });
      return res.end(JSON.stringify({ keys: [AUTH_SIGNER.jwk] }));
    }
    mockCalls.unexpected.push(`${req.method} ${req.url}`);
    res.writeHead(404);
    res.end();
  });
});

// ---------------------------------------------------------------- wrangler dev (local only)
const token = () => randomBytes(24).toString('hex');
const T = { tg: token(), sg: token(), read: token(), worker: token(), webhook: token() };
// approval suite: Telegram order approval ON, with TEST-only ids (no real Telegram user / chat; the sink stands in)
const APPROVAL = { chatId: '-1009990000001', adminIds: ['700000001', '700000002'], outsiderId: '700000999' };
// approval-live (manual, see telegram-bridge.mjs): a REAL TEST bot through the local bridge on 127.0.0.1:8790.
// Only numeric ids and a local shared secret come in; the bot token stays in the bridge process.
const LIVE = SUITE === 'approval-live' ? (() => {
  const secret = String(process.env.E2E_TG_LOCAL_SECRET || '');
  const chatId = String(process.env.E2E_TG_CHAT_ID || '');
  const adminIds = String(process.env.E2E_TG_ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const p = [];
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) p.push('E2E_TG_LOCAL_SECRET (32+ chars, same value as the bridge)');
  if (!/^-\d{5,20}$/.test(chatId)) p.push('E2E_TG_CHAT_ID (numeric TEST group id)');
  if (!adminIds.length || !adminIds.every((x) => /^[1-9]\d{0,19}$/.test(x))) p.push('E2E_TG_ADMIN_IDS (numeric Telegram user ids of the testers)');
  if (p.length) throw new Error(`approval-live needs: ${p.join('; ')}`);
  return { secret, chatId, adminIds };
})() : null;

function startWrangler(label, toml, port, inspectorPort, vars, extra = []) {
  const log = createWriteStream(join(TMP, `wrangler-${label}.log`));
  const args = [FILES.wrangler, 'dev', '--local', '--config', toml, '--ip', '127.0.0.1', '--port', String(port),
    '--inspector-port', String(inspectorPort), '--persist-to', join(TMP, `state-${label}`),
    '--show-interactive-dev-session=false', ...extra];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  if (args.some((a) => a === '--remote' || a === '-r')) fail('remote mode requested');
  const child = spawn(process.execPath, args, { cwd: TMP, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push({ label, child });
  return child;
}

async function waitReady(label, url, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${url}/`);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`${label} did not start on ${url} (see ${join(TMP, `wrangler-${label}.log`)})`);
}

function stopChildren() {
  for (const { child } of children) {
    if (!child.pid || child.exitCode !== null) continue;
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {}
  }
}

// ---------------------------------------------------------------- Firestore helpers (emulator, demo project)
const fs = new Firestore({ projectId: PROJECT_ID, firestoreAuth: 'emulator', urls: { firestore: URLS.firestore } });

// which local rules file the emulator enforces for the browser: compat (default) | transition | final (all test-only)
const RULES_NAME = ['transition', 'final'].includes(process.env.E2E_RULES) ? process.env.E2E_RULES : 'compat';
async function loadCompatRules() {
  const content = readFileSync(RULES_NAME === 'final' ? FILES.finalRules : RULES_NAME === 'transition' ? FILES.transitionRules : FILES.compatRules, 'utf8');
  console.log(`[inner] emulator rules: firestore.rules.${RULES_NAME} (local test file)`);
  const r = await fetch(`http://127.0.0.1:${PORTS.emulator}/emulator/v1/projects/${PROJECT_ID}:securityRules`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  });
  if (!r.ok) throw new Error(`loading compat rules into the emulator failed (${r.status})`);
}

async function reseed() {
  const del = await fetch(`http://127.0.0.1:${PORTS.emulator}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' });
  if (!del.ok) throw new Error(`emulator reset failed (${del.status})`);
  const writes = [
    { update: { name: fs.name(MARKER_PATH), fields: encodeFields({ project: PROJECT_ID, purpose: 'local-e2e', syntheticDataOnly: true }) } },
    ...Object.entries(PRODUCTS).map(([id, data]) => ({ update: { name: fs.name(`products/${id}`), fields: encodeFields({ ...data, synthetic: true }) } })),
  ];
  const r = await fs.commit(writes);
  if (!r.ok) throw new Error(`seed failed (${r.status})`);
}

// ---------------------------------------------------------------- approval-live (manual: real TEST bot via the bridge)
async function runLiveApproval() {
  const { checkoutOrder, line } = await import('../fixtures.mjs');
  const getDoc = async (path) => {
    const d = await fs.get(path);
    return d.exists ? decodeFields(d.fields) : null;
  };
  const stockOf = async (pid, vid) => {
    const p = await getDoc(`products/${pid}`);
    return vid ? (p?.variants || []).find((v) => v.id === vid)?.stock : p?.stock;
  };
  await reseed();
  const orders = [
    checkoutOrder({ items: [line('p-simple', 2)] }),
    checkoutOrder({ items: [line('p-variants', 1, { variantId: 'var_red' }), line('p-simple', 1)] }),
    checkoutOrder({ items: [line('p-last-one', 1)] }),
  ];
  for (const o of orders) {
    const r = await fetch(`${URLS.order}/create-order`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order: o, turnstileToken: TURNSTILE_PASS_TOKEN }) });
    console.log(`[live] order ${o.id}: ${r.status}`);
  }
  const waitMin = Math.min(30, Math.max(1, Number(process.env.E2E_TG_WAIT_MIN || 10)));
  console.log(`[live] 3 synthetic orders created. In the TEST group: accept / reject / cancel, press twice, etc. Watching for ${waitMin} min…`);
  const seen = new Map();
  const end = Date.now() + waitMin * 60_000;
  while (Date.now() < end) {
    for (const o of orders) {
      const l = await getDoc(`orderLedger/${o.id}`);
      const d = l?.decision || 'pending';
      if (seen.get(o.id) !== d) {
        seen.set(o.id, d);
        console.log(`[live] ${o.id} -> ${d}${l?.decidedBy?.userId ? ` (by ${l.decidedBy.userId})` : ''}`);
      }
    }
    if ([...seen.values()].filter((d) => d !== 'pending' && d !== 'accepted').length === orders.length) break;
    await sleep(2000);
  }
  // invariant: stock = initial − (what accepted, not cancelled, orders took)
  const taken = { 'p-simple': 0, 'var_red': 0, 'p-last-one': 0 };
  for (const o of orders) {
    if (seen.get(o.id) !== 'accepted') continue;
    for (const it of o.items) taken[it.selectedVariant?.id || it.productId] += it.quantity;
  }
  const checks = [
    ['p-simple', null, 10 - taken['p-simple']],
    ['p-variants', 'var_red', 5 - taken.var_red],
    ['p-last-one', null, 1 - taken['p-last-one']],
  ];
  const out = [];
  for (const [pid, vid, want] of checks) {
    const got = await stockOf(pid, vid);
    out.push({ id: `LIVE-${vid || pid}`, name: `stock of ${vid || pid} matches the decisions (${want})`, ok: got === want, ...(got === want ? {} : { error: `stock ${got}, expected ${want}` }) });
  }
  for (const o of orders) out.push({ id: `LIVE-${o.id}`, name: `final decision: ${seen.get(o.id)}`, ok: true });
  for (const r of out) console.log(`${r.ok ? '✔' : '✖'} ${r.id} ${r.name}${r.error ? ` — ${r.error}` : ''}`);
  return out;
}

// ---------------------------------------------------------------- UI suite (real web app in headless Chrome)
async function runUiSuite() {
  const repoRoot = resolvePath(WORKER_ROOT, '../..');
  const base = `http://127.0.0.1:${PORTS.vite}`;
  const only = process.env.E2E_ONLY ? new Set(process.env.E2E_ONLY.split(',')) : null;
  const killTree = (child) => {
    if (child?.pid && child.exitCode === null) {
      try {
        execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {}
    }
  };
  const startVite = async (label, workerUrl) => {
    const log = createWriteStream(join(TMP, `vite-${label}.log`));
    const env = {
      ...process.env,
      // emulator-only dev config, checked by tools/firebase-env-guard.ts before the server starts
      VITE_FIREBASE_TARGET: 'emulator',
      VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
      VITE_FIRESTORE_EMULATOR_HOST: `127.0.0.1:${PORTS.emulator}`,
      VITE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      VITE_WORKER_URL: workerUrl,
    };
    const child = spawn(process.execPath, [join(repoRoot, 'node_modules/vite/bin/vite.js'), '--port', String(PORTS.vite), '--strictPort', '--host', '127.0.0.1'], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    children.push({ label: `vite-${label}`, child });
    await waitReady(`vite-${label}`, base, 90_000);
    return child;
  };
  const waitPortFree = async () => {
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`${base}/`);
      } catch {
        return;
      }
      await sleep(200);
    }
  };

  const chrome = await launchChrome({ port: PORTS.cdp, tmpDir: TMP, track: (child) => children.push({ label: 'chrome', child }) });
  console.log(`[inner] UI suite: headless ${chrome.exe.split('\\').pop()} (resolver: loopback only), Vite on ${base}`);
  const ctx = {
    base,
    only,
    reseed,
    openTab: () => openTab(PORTS.cdp),
    setUiMode: async (m) => {
      uiMode = m;
      uiHits.clear();
    },
    get: async (path) => {
      const d = await fs.get(path);
      return d.exists ? decodeFields(d.fields) : null;
    },
    countOrdersByPhone: async (phone) =>
      (await fs.runQuery({ from: [{ collectionId: 'orders' }], where: { fieldFilter: { field: { fieldPath: 'address.phone' }, op: 'EQUAL', value: { stringValue: phone } } } })).length,
    // ---- signed-in customers (Auth EMULATOR on 127.0.0.1 only; synthetic accounts) ----
    setUiAuthMode: async (m) => {
      uiAuthMode = m;
    },
    uiAuthLog: () => uiAuthLog.map((l) => ({ ...l })),
    /** a verified email/password account in the Auth emulator + its users/{uid} profile (role customer) */
    createCustomer: async ({ email, password, name }) => {
      const AUTH = `http://127.0.0.1:${PORTS.authEmulator}`;
      const su = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
      });
      const sj = await su.json();
      if (!su.ok || !sj.localId) throw new Error(`auth emulator signUp failed (${su.status})`);
      const up = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId: sj.localId, emailVerified: true, displayName: name }),
      });
      if (!up.ok) throw new Error(`auth emulator update failed (${up.status})`);
      const r = await fs.commit([{ update: { name: fs.name(`users/${sj.localId}`), fields: encodeFields({ id: sj.localId, name, email, role: 'customer', orders: [], createdAt: new Date().toISOString() }) } }]);
      if (!r.ok) throw new Error(`users doc failed (${r.status})`);
      return sj.localId;
    },
    resetAuth: async () => {
      const r = await fetch(`http://127.0.0.1:${PORTS.authEmulator}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`auth emulator reset failed (${r.status})`);
    },
    /** the admin dashboard's status change (storage.ts updateStatus) — server side here */
    setOrderStatus: async (orderId, status) => {
      const r = await fs.commit([{ update: { name: fs.name(`orders/${orderId}`), fields: encodeFields({ status, seenByAdmin: true }) }, updateMask: { fieldPaths: ['status', 'seenByAdmin'] } }]);
      if (!r.ok) throw new Error(`status update failed (${r.status})`);
    },
    ledger: async (orderId) => {
      const d = await fs.get(`orderLedger/${orderId}`);
      return d.exists ? decodeFields(d.fields) : null;
    },
  };
  const scenarios = buildUiScenarios(ctx);
  let out = [];
  // Phase A: the app talks to the local Worker directly (real CORS preflight from http://127.0.0.1:3000)
  let vite = await startVite('direct', URLS.order);
  out = out.concat(await runUiScenarios(ctx, 'direct Worker', scenarios.A));
  killTree(vite);
  await waitPortFree();
  // Phase B: the app talks to the switchable local proxy
  vite = await startVite('proxy', `${URLS.mock}/ui`);
  out = out.concat(await runUiScenarios(ctx, 'proxy', scenarios.B));
  killTree(vite);
  return out;
}

// ---------------------------------------------------------------- run
let results = [];
let cpu = null;
let fatal = null;
try {
  await new Promise((r) => mock.listen(PORTS.mock, '127.0.0.1', r));
  await loadCompatRules();
  mkdirSync(join(TMP, 'state-sink'), { recursive: true });
  mkdirSync(join(TMP, 'state-order'), { recursive: true });
  startWrangler('sink', FILES.sinkToml, PORTS.sink, PORTS.sinkInspector, {
    SINK_TELEGRAM_TOKEN: T.tg, SINK_SENDGRID_KEY: T.sg, SINK_READ_TOKEN: T.read,
  });
  startWrangler('order', FILES.orderToml, PORTS.order, PORTS.orderInspector, {
    TELEGRAM_BOT_TOKEN: T.tg, SENDGRID_API_KEY: T.sg, WORKER_AUTH_TOKEN: T.worker,
    // UI suite: the current web app sends no Turnstile token -> Phase 1 production mode (log), for this run only
    ...(SUITE === 'ui' ? { TURNSTILE_MODE: 'log' } : {}),
    ...(SUITE === 'approval' ? {
      APPROVAL_MODE: 'telegram', TELEGRAM_CHAT_ID: APPROVAL.chatId, TELEGRAM_ADMIN_USER_IDS: APPROVAL.adminIds.join(','),
      TELEGRAM_WEBHOOK_SECRET: T.webhook, PRICE_CHECK_MODE: 'enforce',
    } : {}),
    ...(LIVE ? {
      APPROVAL_MODE: 'telegram', TELEGRAM_API_BASE: 'http://127.0.0.1:8790/telegram', TELEGRAM_BOT_TOKEN: LIVE.secret,
      TELEGRAM_CHAT_ID: LIVE.chatId, TELEGRAM_ADMIN_USER_IDS: LIVE.adminIds.join(','), TELEGRAM_WEBHOOK_SECRET: LIVE.secret,
      PRICE_CHECK_MODE: 'enforce',
    } : {}),
  }, ['--test-scheduled']);
  await waitReady('sink', URLS.sink);
  await waitReady('order', URLS.order);
  const cfgCheck = await (await fetch(`${URLS.order}/`)).json();
  if (!cfgCheck.ok) throw new Error(`order Worker refused its config: ${JSON.stringify(cfgCheck)}`);
  console.log(`[inner] emulator, sink, order Worker and Turnstile mock up on 127.0.0.1 (${Object.values(PORTS).join(', ')})`);

  if (CPU_MODE) {
    // throw-away RSA key, generated here, never written to disk, only for the local signing probe
    const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\r?\n/g, '\\n');
    startWrangler('probe', FILES.probeToml, PORTS.probe, PORTS.probeInspector, { PROBE_PRIVATE_KEY: pem });
    await waitReady('probe', URLS.probe);
    const pidOf = (label) => children.find((c) => c.label === label).child.pid;
    const orderPids = workerdUnder(pidOf('order'));
    const probePids = workerdUnder(pidOf('probe'));
    if (!orderPids.length || !probePids.length) throw new Error('workerd processes not found for CPU sampling');
    console.log(`[inner] CPU mode: sampling workerd pids order=${orderPids.join(',')} probe=${probePids.join(',')}`);
    cpu = await measureCpu({
      W: URLS.order, S: URLS.sink, sinkAuth: { 'x-sink-auth': T.read }, probeUrl: URLS.probe, orderPids, probePids,
      turnstileToken: TURNSTILE_PASS_TOKEN, reseed,
      get: async (path) => {
        const d = await fs.get(path);
        return d.exists ? decodeFields(d.fields) : null;
      },
      // TEST-signed ID tokens (keys served by the local mock's /jwks)
      idToken: (uid) => AUTH_SIGNER.idToken({ projectId: PROJECT_ID, uid }),
    });
  } else if (SUITE === 'ui') {
    results = await runUiSuite();
  } else if (SUITE === 'approval-live') {
    results = await runLiveApproval();
  } else if (SUITE === 'approval') {
    const getDoc = async (path) => {
      const d = await fs.get(path);
      return d.exists ? decodeFields(d.fields) : null;
    };
    results = await runApprovalScenarios({
      label: 'local-e2e approval', projectId: PROJECT_ID, W: URLS.order, S: URLS.sink, sinkAuth: { 'x-sink-auth': T.read },
      turnstileToken: TURNSTILE_PASS_TOKEN, get: getDoc, reseed,
      only: process.env.E2E_ONLY ? new Set(process.env.E2E_ONLY.split(',')) : null,
      webhookSecret: T.webhook, ...APPROVAL,
      createBudget: { limit: 18, windowMs: 61_000 },
      triggerCron: async () => { await fetch(`${URLS.order}/__scheduled?cron=*+*+*+*+*`); },
      cronWaitMs: 60_000,
      // test-only stock change between order and acceptance (an admin editing the product)
      setStock: async (pid, vid, value) => {
        const p = await getDoc(`products/${pid}`);
        const fields = vid ? { variants: p.variants.map((v) => (v.id === vid ? { ...v, stock: value } : v)) } : { stock: value };
        const r = await fs.commit([{ update: { name: fs.name(`products/${pid}`), fields: encodeFields(fields) }, updateMask: { fieldPaths: Object.keys(fields) } }]);
        if (!r.ok) throw new Error(`setStock failed (${r.status})`);
      },
      // an order document WITHOUT ledger: what the old Checkout / Worker v1 wrote
      seedLegacyOrder: async (o) => {
        const r = await fs.commit([{ update: { name: fs.name(`orders/${o.id}`), fields: encodeFields({ ...o, status: 'new', seenByAdmin: false }) }, currentDocument: { exists: false } }]);
        if (!r.ok) throw new Error(`seedLegacyOrder failed (${r.status})`);
      },
    });
  } else {
    const suite = SUITE; // all | scenarios (S01–S12) | submit (S13–S27)
    const only = process.env.E2E_ONLY ? new Set(process.env.E2E_ONLY.split(',')) : null;
    if (suite !== 'submit') results = await runScenarios({
    label: 'local-e2e',
    projectId: PROJECT_ID,
    W: URLS.order,
    S: URLS.sink,
    sinkAuth: { 'x-sink-auth': T.read },
    turnstileToken: TURNSTILE_PASS_TOKEN,
    get: async (path) => {
      const d = await fs.get(path);
      return d.exists ? decodeFields(d.fields) : null;
    },
    reseed,
    browserApp: async () => {
      const { initializeApp, deleteApp } = await import('firebase/app');
      const { getFirestore, connectFirestoreEmulator } = await import('firebase/firestore');
      const app = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-local-e2e-key', appId: '1:000000000000:web:locale2e' }, `local-browser-${Date.now()}`);
      const db = getFirestore(app);
      connectFirestoreEmulator(db, '127.0.0.1', PORTS.emulator);
      return { db, done: () => deleteApp(app) };
    },
    triggerCron: async () => {
      await fetch(`${URLS.order}/__scheduled?cron=*+*+*+*+*`);
    },
    cronWaitMs: 30_000,
    cronStepMs: 1_000,
    createBudget: { limit: 18, windowMs: 61_000 }, // wrangler.order.toml: CREATE_RATE_LIMITER 20 / 60 s
    skipCron: false,
    skipBrowser: false,
    only,
    // S40–S45: local simulation of the staging test users — test-signed ID tokens for this run's demo project
    // (staging uses real Firebase Auth users from staging/auth-users.mjs; nothing to delete here)
    users: {
      create: async (label) => {
        const uid = `loc${label}${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
        return { uid, email: `${uid}@example.invalid`, idToken: await AUTH_SIGNER.idToken({ projectId: PROJECT_ID, uid }) };
      },
      forged: () => AUTH_FORGER.idToken({ projectId: PROJECT_ID, uid: 'forged-uid' }),
    },
  });
    if (suite !== 'scenarios') {
      if (results.length) await sleep(62_000); // let S10's deliberate burst leave the per-IP rate-limit window
      results = results.concat(await runSubmitScenarios({
        W: URLS.order, MOCK: URLS.mock, turnstileToken: TURNSTILE_PASS_TOKEN, reseed, only,
        // signed-in customers: test-signed ID tokens for this run's demo project (and forgeries)
        idToken: (uid, o = {}) => AUTH_SIGNER.idToken({ projectId: PROJECT_ID, uid, ...o }),
        forgedToken: (uid) => AUTH_FORGER.idToken({ projectId: PROJECT_ID, uid }),
        // a browser-style order document WITHOUT a ledger entry (what the current Checkout writes directly)
        seedOrderDoc: async (o) => {
          const r = await fs.commit([{ update: { name: fs.name(`orders/${o.id}`), fields: encodeFields({ ...o, status: 'new', seenByAdmin: false }) }, currentDocument: { exists: false } }]);
          if (!r.ok) throw new Error(`seedOrderDoc failed (${r.status})`);
        },
        get: async (path) => {
          const d = await fs.get(path);
          return d.exists ? decodeFields(d.fields) : null;
        },
      }));
    }
  }
} catch (e) {
  fatal = String(e?.message || e);
  console.error(`[inner] FATAL: ${fatal}`);
} finally {
  stopChildren();
  mock.closeAllConnections?.(); // includes /chaos/hang sockets
  await new Promise((r) => mock.close(() => r()));
}

writeFileSync(process.env.E2E_RESULT_FILE, JSON.stringify({ mode: CPU_MODE ? 'cpu' : 'scenarios', results, cpu, fatal, mock: mockCalls }, null, 2));
const incomplete = CPU_MODE ? !cpu : results.length === 0 || results.some((r) => !r.ok);
process.exit(fatal || incomplete || mockCalls.unexpected.length ? 1 : 0);
