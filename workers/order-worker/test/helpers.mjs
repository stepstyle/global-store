// Test helpers: local mock services, worker invocation, emulator DB access, simulated browser writes.
// Everything here talks to 127.0.0.1 only.

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import worker from '../src/index.js';
import { Firestore, encodeFields, decodeFields } from '../src/firestore.js';
import { PRODUCTS } from './fixtures.mjs';

export const PROJECT_ID = 'demo-dairsharaf-orders';
const here = dirname(fileURLToPath(import.meta.url));
export const RULES = {
  prod: readFileSync(resolve(here, '../../../firebase/firestore.rules.prod-snapshot'), 'utf8'),
  compat: readFileSync(resolve(here, '../../../firebase/rules-test/firestore.rules.compat'), 'utf8'),
};

export function emulatorHost() {
  const h = process.env.FIRESTORE_EMULATOR_HOST;
  if (!h || !/^(127\.0\.0\.1|localhost):\d+$/.test(h)) {
    throw new Error('Refusing to run: FIRESTORE_EMULATOR_HOST must point to a local emulator.');
  }
  return h;
}

// ---------------------------------------------------------------------------
// Mock Telegram / SendGrid / Turnstile / OAuth on 127.0.0.1
// ---------------------------------------------------------------------------
export async function startMockServices(port = 0) {
  const state = {
    calls: [],
    unexpected: [],
    failNext: { telegram: 0, email: 0 },
    failAlways: { telegram: false, email: false },
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (status, obj) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const channelFail = (ch) => {
        if (state.failAlways[ch]) return true;
        if (state.failNext[ch] > 0) {
          state.failNext[ch] -= 1;
          return true;
        }
        return false;
      };
      if (req.method === 'POST' && /^\/telegram\/bot[^/]+\/sendMessage$/.test(req.url)) {
        const failed = channelFail('telegram');
        state.calls.push({ channel: 'telegram', ok: !failed, body: JSON.parse(body || '{}') });
        return failed ? send(500, { ok: false }) : send(200, { ok: true, result: { message_id: state.calls.length } });
      }
      if (req.method === 'POST' && req.url === '/sendgrid/v3/mail/send') {
        const failed = channelFail('email');
        state.calls.push({ channel: 'email', ok: !failed, body: JSON.parse(body || '{}') });
        return failed ? send(500, { errors: [{ message: 'mock failure' }] }) : (res.writeHead(202), res.end());
      }
      if (req.method === 'POST' && req.url === '/turnstile/siteverify') {
        const p = new URLSearchParams(body);
        state.calls.push({ channel: 'turnstile', ok: true });
        return send(200, { success: p.get('response') === 'pass-token' });
      }
      state.unexpected.push({ method: req.method, url: req.url });
      return send(404, { error: 'unexpected call to mock' });
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const { port: actual } = server.address();
  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    state,
    sent: (ch) => state.calls.filter((c) => c.channel === ch && c.ok).length,
    attempts: (ch) => state.calls.filter((c) => c.channel === ch).length,
    reset() {
      state.calls.length = 0;
      state.failNext = { telegram: 0, email: 0 };
      state.failAlways = { telegram: false, email: false };
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

// ---------------------------------------------------------------------------
// Worker env + invocation (same module the Worker runtime loads)
// ---------------------------------------------------------------------------
export function makeEnv(mockUrl, overrides = {}) {
  return {
    ENVIRONMENT: 'local',
    FIREBASE_PROJECT_ID: PROJECT_ID,
    FIRESTORE_AUTH: 'emulator',
    FIRESTORE_BASE_URL: `http://${emulatorHost()}/v1`,
    OAUTH_TOKEN_URL: `${mockUrl}/oauth/token`,
    TELEGRAM_API_BASE: `${mockUrl}/telegram`,
    SENDGRID_API_BASE: `${mockUrl}/sendgrid`,
    TURNSTILE_VERIFY_URL: `${mockUrl}/turnstile/siteverify`,
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_CHAT_ID: 'test-chat',
    SENDGRID_API_KEY: 'test-sendgrid-key',
    ADMIN_EMAIL: 'admin@example.invalid',
    EMAIL_FROM: 'orders@example.invalid',
    WORKER_AUTH_TOKEN: 'test-worker-auth-token-0001',
    TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    ALLOWED_ORIGINS: 'https://dairsharaf.com,https://www.dairsharaf.com',
    STOCK_MODE: 'apply',
    PRICE_CHECK_MODE: 'log',
    TURNSTILE_MODE: 'log',
    RECONCILE_ENABLED: 'false',
    CREATE_WAIT_MS: '0',
    RATE_LIMIT_CREATE_PER_MIN: '1000000',
    RATE_LIMIT_STATUS_PER_MIN: '1000000',
    ...overrides,
  };
}

let ipCounter = 0;
export const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

export async function callWorker(env, { method = 'GET', path = '/', body, rawBody, headers = {} } = {}) {
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const init = { method, headers: { 'cf-connecting-ip': '10.255.0.1', ...headers } };
  if (rawBody !== undefined) init.body = rawBody;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  const res = await worker.fetch(new Request(`http://worker.local${path}`, init), env, ctx);
  await Promise.all(pending);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json, text, headers: res.headers };
}

export const createOrderReq = (env, order, headers = {}) =>
  callWorker(env, { method: 'POST', path: '/create-order', body: { order }, headers });

export async function runCron(env) {
  const pending = [];
  const result = await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() }, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return result;
}

// ---------------------------------------------------------------------------
// Emulator DB (owner access, bypasses rules — this is the "server side")
// ---------------------------------------------------------------------------
export function adminDb() {
  return new Firestore({
    projectId: PROJECT_ID,
    firestoreAuth: 'emulator',
    urls: { firestore: `http://${emulatorHost()}/v1` },
  });
}

export async function clearDb() {
  const res = await fetch(`http://${emulatorHost()}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`clear failed ${res.status}`);
}

export async function seedProducts(overrides = {}) {
  const fs = adminDb();
  const all = { ...PRODUCTS, ...overrides };
  const writes = Object.entries(all).map(([id, data]) => ({ update: { name: fs.name(`products/${id}`), fields: encodeFields(data) } }));
  const r = await fs.commit(writes);
  if (!r.ok) throw new Error(`seed failed ${r.status} ${JSON.stringify(r.data)}`);
}

/** Write a raw document; serverTimeFields get REQUEST_TIME (like serverTimestamp()). */
export async function putDoc(path, data, { serverTimeFields = [] } = {}) {
  const fs = adminDb();
  const r = await fs.commit([
    {
      update: { name: fs.name(path), fields: encodeFields(data) },
      ...(serverTimeFields.length ? { updateTransforms: serverTimeFields.map((f) => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' })) } : {}),
    },
  ]);
  if (!r.ok) throw new Error(`putDoc failed ${r.status} ${JSON.stringify(r.data)}`);
}

export async function getDecoded(path) {
  const d = await adminDb().get(path);
  return d.exists ? { ...decodeFields(d.fields), __raw: d } : null;
}

export async function count(collectionId, where) {
  const q = { from: [{ collectionId }] };
  if (where) q.where = where;
  const docs = await adminDb().runQuery(q);
  return docs.length;
}

export const eq = (fieldPath, value) => ({
  fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: typeof value === 'string' ? { stringValue: value } : { booleanValue: value } },
});

export async function productStock(id) {
  const p = await getDecoded(`products/${id}`);
  return p?.stock;
}

export async function variantStock(productId, variantId) {
  const p = await getDecoded(`products/${productId}`);
  return (p?.variants || []).find((v) => v.id === variantId)?.stock;
}

// ---------------------------------------------------------------------------
// Simulated browser (current Checkout.tsx -> storage.ts db.orders.create) under real rules
// ---------------------------------------------------------------------------
export async function browserEnv(rulesName) {
  const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
  const [host, port] = emulatorHost().split(':');
  return initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: RULES[rulesName], host, port: Number(port) } });
}

/** Mirrors storage.ts create(): same object, createdAt/updatedAt = serverTimestamp(). Errors are captured, like Checkout's catch {}. */
export async function browserWrite(testEnv, order, uid = null) {
  const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
  const ctx = uid ? testEnv.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }) : testEnv.unauthenticatedContext();
  const payload = { ...order, status: 'new', seenByAdmin: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  try {
    await setDoc(doc(ctx.firestore(), 'orders', order.id), payload);
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e?.code || String(e) };
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
