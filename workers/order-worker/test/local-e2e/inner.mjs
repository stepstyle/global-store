// LOCAL e2e — inner part. Started by run.mjs through `firebase emulators:exec` (Firestore emulator already up).
// Starts the notify sink and the order Worker with `wrangler dev --local`, a local Turnstile mock, then runs
// the shared scenarios S01–S12 (staging/scenarios.mjs). Everything is on 127.0.0.1.

import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { Firestore, encodeFields, decodeFields } from '../../src/firestore.js';
import { PRODUCTS } from '../fixtures.mjs';
import { MARKER_PATH } from '../../staging/common.mjs';
import { runScenarios } from '../../staging/scenarios.mjs';
import { assertLocalPlan, localOnlyFetch } from './guard.mjs';
import { PLAN, PORTS, URLS, FILES, PROJECT_ID, TURNSTILE_PASS_TOKEN } from './plan.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TMP = process.env.E2E_TMP;
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

// ---------------------------------------------------------------- local Turnstile mock
const mockCalls = { turnstile: 0, unexpected: [] };
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/turnstile/siteverify') {
      mockCalls.turnstile += 1;
      const ok = new URLSearchParams(body).get('response') === TURNSTILE_PASS_TOKEN;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ success: ok }));
    }
    mockCalls.unexpected.push(`${req.method} ${req.url}`);
    res.writeHead(404);
    res.end();
  });
});

// ---------------------------------------------------------------- wrangler dev (local only)
const token = () => randomBytes(24).toString('hex');
const T = { tg: token(), sg: token(), read: token(), worker: token() };

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

async function loadCompatRules() {
  const content = readFileSync(FILES.compatRules, 'utf8');
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

// ---------------------------------------------------------------- run
let results = [];
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
  }, ['--test-scheduled']);
  await waitReady('sink', URLS.sink);
  await waitReady('order', URLS.order);
  const cfgCheck = await (await fetch(`${URLS.order}/`)).json();
  if (!cfgCheck.ok) throw new Error(`order Worker refused its config: ${JSON.stringify(cfgCheck)}`);
  console.log(`[inner] emulator, sink, order Worker and Turnstile mock up on 127.0.0.1 (${Object.values(PORTS).join(', ')})`);

  results = await runScenarios({
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
    only: process.env.E2E_ONLY ? new Set(process.env.E2E_ONLY.split(',')) : null,
  });
} catch (e) {
  fatal = String(e?.message || e);
  console.error(`[inner] FATAL: ${fatal}`);
} finally {
  stopChildren();
  await new Promise((r) => mock.close(() => r()));
}

writeFileSync(process.env.E2E_RESULT_FILE, JSON.stringify({ results, fatal, mock: mockCalls }, null, 2));
process.exit(fatal || results.length === 0 || results.some((r) => !r.ok) || mockCalls.unexpected.length ? 1 : 0);
