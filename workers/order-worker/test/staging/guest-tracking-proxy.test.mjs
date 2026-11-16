// Guest OrderSuccess / OrderTracking under firestore.rules.final — LOCAL ONLY.
// final closes Firestore order reads for guests, so these pages must work WITHOUT Firestore: the storefront's real
// client functions (src/services/orderSubmit.ts fetchOrderStatus / fetchOrderSummary, as used by the pages)
// -> the real staging proxy (127.0.0.1:0, create disabled) -> a FAKE Worker behind the real guardedFetch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { assertStagingConfig, guardedFetch, REPO_ROOT } from '../../staging/guard.mjs';
import { createProxy, listenLoopback, PROXY_ALLOWED_ORIGIN } from '../../staging/proxy.mjs';
import { fetchOrderStatus, fetchOrderSummary } from '../../../../src/services/orderSubmit.ts';

const SECRET = randomBytes(32).toString('hex');
const ORDER = 'ORD-GUEST001-BBBB';
const KEY = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01'; // tracking key shown to the guest on OrderSuccess (format only)
let dir, st, server, base, upstreamCalls;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'guest-tracking-'));
  const keyPath = join(dir, 'k.json');
  writeFileSync(keyPath, JSON.stringify({ type: 'service_account', project_id: 'dairsharaf-staging', client_email: 'w@dairsharaf-staging.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n' }));
  st = assertStagingConfig({
    projectId: 'dairsharaf-staging', workerUrl: 'https://anta-order-notify-staging.acme.workers.dev', sinkUrl: 'https://anta-notify-sink-staging.acme.workers.dev',
    serviceAccountKeyPath: keyPath, firebaseWebConfig: { apiKey: 'k', authDomain: 'dairsharaf-staging.firebaseapp.com', projectId: 'dairsharaf-staging', appId: '1:0:web:0' },
    cloudflareAccountId: '0123456789abcdef0123456789abcdef', cloudflareLoginEmail: 'o@example.com', firebaseAccountEmail: 'o@example.com',
  }, { env: {} });
  upstreamCalls = [];
  // fake Worker: gate, status by number, summary only with the right tracking key (the real Worker hashes it)
  const fakeWorker = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const h = new Headers(init.headers);
    upstreamCalls.push({ path: url.pathname, access: h.get('x-staging-access') === SECRET, key: h.get('x-tracking-key') });
    if (h.get('x-staging-access') !== SECRET) return Response.json({ ok: false, code: 'STAGING_ACCESS_DENIED' }, { status: 403 });
    const m = url.pathname.match(/^\/orders\/([^/]+)\/(status|summary)$/);
    if (!m) return Response.json({ ok: false }, { status: 404 });
    if (m[2] === 'status') return m[1] === ORDER ? Response.json({ ok: true, exists: true, status: 'processing' }) : Response.json({ ok: true, exists: false }, { status: 404 });
    if (m[1] === ORDER && h.get('x-tracking-key') === KEY.replace(/-/g, '')) return Response.json({ ok: true, order: { id: ORDER, status: 'processing', total: 3.5, items: [{ name: 'دفتر', quantity: 1 }] } });
    return Response.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 });
  };
  server = createProxy({ st, fetchImpl: guardedFetch(st, fakeWorker, { stagingAccessToken: SECRET }), secret: SECRET, log: () => {} });
  base = `http://127.0.0.1:${await listenLoopback(server, 0)}`;
});
after(async () => { await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); });

// the page's fetch, as a browser at http://127.0.0.1:3000 sends it (Origin added by the browser)
const deps = { fetch: (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers || {}), origin: PROXY_ALLOWED_ORIGIN } }) };
const opts = () => ({ workerUrl: base, timeoutMs: 5_000 });

test('OrderTracking / OrderSuccess (guest): status by order number through the proxy — no Firestore involved', async () => {
  assert.deepEqual(await fetchOrderStatus(ORDER, opts(), deps), { exists: true, status: 'processing' });
  assert.deepEqual(await fetchOrderStatus('ORD-NOPE0001-ZZZZ', opts(), deps), { exists: false, status: '' });
  assert.ok(upstreamCalls.every((c) => c.access), 'every forwarded call carried the staging secret (added by the proxy)');
});

test('OrderTracking (guest): details only with the tracking key; wrong / no key = denied', async () => {
  const ok = await fetchOrderSummary(ORDER, { key: KEY }, opts(), deps);
  assert.equal(ok.kind, 'ok');
  assert.equal(ok.order.id, ORDER);
  assert.deepEqual(await fetchOrderSummary(ORDER, { key: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ' }, opts(), deps), { kind: 'denied' });
  const before = upstreamCalls.length;
  assert.deepEqual(await fetchOrderSummary(ORDER, {}, opts(), deps), { kind: 'denied' });
  assert.equal(upstreamCalls.length, before, 'no key: nothing is even sent');
});

test('the same calls from another site are refused by the proxy (page sees "unavailable", never data)', async () => {
  const evil = { fetch: (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers || {}), origin: 'https://evil.example' } }) };
  assert.equal(await fetchOrderStatus(ORDER, opts(), evil), null);
  assert.deepEqual(await fetchOrderSummary(ORDER, { key: KEY }, opts(), evil), { kind: 'unavailable' });
});

test('static: OrderSuccess.tsx / OrderTracking.tsx read orders ONLY through the Worker (no Firestore order reads)', () => {
  for (const f of ['src/pages/OrderSuccess.tsx', 'src/pages/OrderTracking.tsx']) {
    const src = readFileSync(resolve(REPO_ROOT, f), 'utf8');
    assert.doesNotMatch(src, /\b(getDoc|getDocs|onSnapshot|collection)\s*\(|from ['"]firebase\/firestore['"]|db\.orders\./, `${f} must not read orders from Firestore`);
    assert.match(src, /VITE_WORKER_URL/, `${f} uses the Worker URL (= the local proxy in staging)`);
  }
});
