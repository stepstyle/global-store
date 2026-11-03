// Staging end-to-end tests: staging Worker + REAL Google OAuth + REAL Firestore (staging project only)
// + staging sink. Synthetic data only.
//   STAGING_SINK_READ_TOKEN=... STAGING_WORKER_AUTH_TOKEN=... \
//   node staging/run-tests.mjs --config staging/staging.config.json [--only S03,S08] [--skip-cron] [--skip-browser]
// Order of operations: guard -> marker check -> scenarios. Any guard failure stops before a single request.

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { decodeFields } from '../src/firestore.js';
import { checkoutOrder, line, makeOrderId } from '../test/fixtures.mjs';
import { parseArgs, prepareStaging, MARKER_PATH, runCli } from './common.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TURNSTILE_TEST_TOKEN = 'staging-turnstile-test-token'; // accepted by Cloudflare's always-pass TEST secret

export async function main(argv, deps = {}) {
  const args = parseArgs(argv);
  const env = deps.env ?? process.env;
  const { st, fs } = prepareStaging({ configPath: args.config, requireTokens: true, ...deps });
  const only = args.only ? new Set(args.only.split(',')) : null;
  const W = st.workerUrl;
  const S = st.sinkUrl;
  const sinkAuth = { 'x-sink-auth': env.STAGING_SINK_READ_TOKEN };

  // ---------- helpers ----------
  const get = async (path) => {
    const d = await fs.get(path);
    return d.exists ? decodeFields(d.fields) : null;
  };
  const stock = async (pid, vid) => {
    const p = await get(`products/${pid}`);
    return vid ? (p?.variants || []).find((v) => v.id === vid)?.stock : p?.stock;
  };
  const create = async (order, { token = TURNSTILE_TEST_TOKEN, headers = {} } = {}) => {
    const r = await fetch(`${W}/create-order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ order, ...(token ? { turnstileToken: token } : {}) }),
    });
    let body = null;
    try {
      body = await r.json();
    } catch {}
    return { status: r.status, body, headers: r.headers };
  };
  const sinkCalls = async () => (await (await fetch(`${S}/calls`, { headers: sinkAuth })).json()).calls || [];
  const sinkFor = async (id) => (await sinkCalls()).filter((c) => c.orderId === id);
  const waitFor = async (fn, ms = 20_000, step = 500) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) return v;
      await sleep(step);
    }
  };
  const reseed = async () => {
    const { main: seed } = await import('./seed.mjs');
    await seed(['--config', args.config, '--reset'], deps);
  };

  // ---------- preflight: worker identity + marker ----------
  const root = await (await fetch(`${W}/`)).json();
  assert.equal(root.ok, true, 'staging Worker root');
  assert.match(root.version, /^v2\./);
  const marker = await get(MARKER_PATH);
  if (!marker || marker.project !== st.projectId || marker.syntheticDataOnly !== true) {
    throw new Error(`staging marker missing in ${st.projectId}: run staging/seed.mjs first`);
  }

  const scenarios = [
    ['S01', 'real Google OAuth + Firestore commit: happy path, stock once, notified once', async () => {
      const o = checkoutOrder();
      const r = await create(o);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body, { ok: true, orderId: o.id, replay: false });
      const led = await get(`orderLedger/${o.id}`);
      assert.equal(led.mode, 'created');
      assert.equal(await stock('p-simple'), 8);
      assert.equal(await stock('p-variants', 'var_red'), 4);
      assert.equal(await stock('p-variants'), 0);
      const calls = await waitFor(async () => {
        const c = await sinkFor(o.id);
        return c.filter((x) => x.ok).length >= 2 ? c : null;
      });
      assert.ok(calls, 'telegram + email reached the sink');
      assert.equal(calls.filter((c) => c.channel === 'telegram' && c.ok).length, 1);
      assert.equal(calls.filter((c) => c.channel === 'email' && c.ok).length, 1);
    }],
    ['S02', 'replays: 5 sequential + 5 parallel -> processed once', async () => {
      const a = checkoutOrder();
      const seq = [];
      for (let i = 0; i < 5; i++) seq.push((await create(a)).body.replay);
      assert.deepEqual(seq, [false, true, true, true, true]);
      const b = checkoutOrder({ items: [line('p-hundred', 1)] });
      const par = await Promise.all(Array.from({ length: 5 }, () => create(b)));
      assert.equal(par.filter((r) => r.body?.replay === false).length, 1);
      assert.equal(await stock('p-hundred'), 99);
    }],
    ['S03', 'same id, different content -> 409, unchanged', async () => {
      const o = checkoutOrder();
      await create(o);
      const r = await create({ ...o, address: { ...o.address, phone: '+962780000000' } });
      assert.equal(r.status, 409);
      assert.equal((await get(`orders/${o.id}`)).address.phone, '+962791234567');
    }],
    ['S04', 'injected fields dropped; spoofed userId stored as guest', async () => {
      const o = checkoutOrder({ userId: 'victimUid00000000000000000009', payment: 'cliq', overrides: { status: 'delivered', isVerified: true, paymentDetails: { cliqReference: '1', isPaid: true } } });
      assert.equal((await create(o)).status, 200);
      const s = await get(`orders/${o.id}`);
      assert.equal(s.status, 'new');
      assert.equal(s.paymentDetails.isPaid, false);
      assert.equal('isVerified' in s, false);
      assert.equal(s.userId, 'guest');
      assert.equal(s.claimedUserId, 'victimUid00000000000000000009');
    }],
    ['S05', 'stock per product shape (variant only, CSV id, string stock, untracked, duplicates, shortfall)', async () => {
      const one = async (items) => {
        const o = checkoutOrder({ items });
        assert.equal((await create(o)).status, 200);
        return get(`orderLedger/${o.id}`);
      };
      await one([line('p-variants', 1, { variantId: 'var_blue' })]);
      assert.equal(await stock('p-variants', 'var_blue'), 0);
      assert.equal(await stock('p-variants'), 0);
      await one([line('CSV 001 دفتر', 2)]);
      assert.equal(await stock('CSV 001 دفتر'), 5);
      await one([line('p-string-stock', 3)]);
      assert.equal(await stock('p-string-stock'), 5);
      const u = await one([line('p-no-stock', 1)]);
      assert.ok(u.warnings.some((w) => w.code === 'STOCK_UNTRACKED'));
      const d = await one([line('p-dup-variant', 1, { variantId: 'var_dup' })]);
      assert.ok(d.warnings.some((w) => w.code === 'DUPLICATE_VARIANT_ID'));
      const before = await stock('p-empty-variants');
      const sf = await one([line('p-empty-variants', 1), line('p-last-one', 5)]);
      assert.ok(sf.warnings.some((w) => w.code === 'STOCK_NOT_DEDUCTED'));
      assert.equal(await stock('p-empty-variants'), before, 'no partial deduction');
    }],
    ['S06', 'concurrency on real Firestore: last item x1, 10 parallel on one product', async () => {
      const a = checkoutOrder({ items: [line('p-last-one', 1)] });
      const b = checkoutOrder({ items: [line('p-last-one', 1)], overrides: { address: { ...a.address, phone: '+962771111111' } } });
      const rs = await Promise.all([create(a), create(b)]);
      assert.ok(rs.every((r) => r.status === 200));
      assert.equal(await stock('p-last-one'), 0);
      const start = await stock('p-hundred');
      const os = Array.from({ length: 10 }, () => checkoutOrder({ items: [line('p-hundred', 1)] }));
      const r10 = await Promise.all(os.map((o) => create(o)));
      assert.ok(r10.every((r) => r.status === 200), r10.map((r) => r.status).join(','));
      assert.equal(await stock('p-hundred'), start - 10);
    }],
    ['S07', 'tampered prices flagged; sink summary shows server total', async () => {
      const o = checkoutOrder({ items: [{ ...line('p-simple', 2), price: 0.01 }, { ...line('p-variants', 1, { variantId: 'var_red' }), price: 0.01 }] });
      assert.equal((await create(o)).status, 200);
      const led = await get(`orderLedger/${o.id}`);
      assert.equal(led.priceMismatch, true);
      const tg = await waitFor(async () => (await sinkFor(o.id)).find((c) => c.channel === 'telegram' && c.ok));
      assert.ok(tg);
      assert.equal(tg.priceMismatch, true);
      assert.equal(tg.serverTotal, 8.2);
    }],
    ['S08', 'status endpoint: exact keys, no personal data; invalid ids 400', async () => {
      const o = checkoutOrder();
      await create(o);
      const r = await fetch(`${W}/orders/${o.id}/status`);
      const text = await r.text();
      assert.deepEqual(JSON.parse(text), { ok: true, exists: true, status: 'new' });
      for (const pii of ['+962791234567', 'Test Buyer', 'buyer@example.com']) assert.equal(text.includes(pii), false);
      for (const bad of ['..%2Fconfig%2Froles', 'ORD-1']) assert.equal((await fetch(`${W}/orders/${bad}/status`)).status, 400);
      assert.equal((await fetch(`${W}/orders/${makeOrderId()}/status`)).status, 404);
    }],
    ['S09', 'protected routes, Turnstile enforce, CORS', async () => {
      assert.equal((await fetch(`${W}/test`)).status, 401);
      assert.equal((await fetch(`${W}/firestore-test`, { method: 'POST' })).status, 404);
      assert.equal((await create(checkoutOrder(), { token: null })).status, 403);
      const evil = await fetch(`${W}/orders/${makeOrderId()}/status`, { headers: { origin: 'https://evil.example' } });
      assert.equal(evil.headers.get('access-control-allow-origin'), null);
      const dev = await fetch(`${W}/orders/${makeOrderId()}/status`, { headers: { origin: 'http://localhost:3000' } });
      assert.equal(dev.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    }],
    ['S10', 'rate limit binding answers 429 under a burst', async () => {
      const statuses = await Promise.all(Array.from({ length: 40 }, () => fetch(`${W}/create-order`, { method: 'POST', body: '{' }).then((r) => r.status)));
      assert.ok(statuses.includes(429), `no 429 in ${statuses.join(',')}`);
    }],
  ];

  if (!args.flags.has('skip-cron')) {
    scenarios.push(['S11', 'Telegram failure retried by the REAL cron (waits up to 3 min)', async () => {
      await fetch(`${S}/control`, { method: 'POST', headers: { ...sinkAuth, 'content-type': 'application/json' }, body: JSON.stringify({ failNext: { telegram: 1 } }) });
      const o = checkoutOrder();
      await create(o);
      const sent = await waitFor(async () => {
        const l = await get(`orderLedger/${o.id}`);
        return l?.notifications?.telegram?.state === 'sent' ? l : null;
      }, 180_000, 5_000);
      assert.ok(sent, 'telegram eventually sent by cron');
      const tgOk = (await sinkFor(o.id)).filter((c) => c.channel === 'telegram' && c.ok).length;
      assert.equal(tgOk, 1);
    }]);
  }

  if (!args.flags.has('skip-browser')) {
    scenarios.push(['S12', 'browser (Firebase JS SDK, staging web app, compat rules) + Worker in parallel x5', async () => {
      const { initializeApp, deleteApp } = await import('firebase/app');
      const { getFirestore, doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      const app = initializeApp(st.firebaseWebConfig, `staging-browser-${Date.now()}`);
      try {
        const db = getFirestore(app);
        for (let i = 0; i < 5; i++) {
          const o = checkoutOrder();
          const browser = setDoc(doc(db, 'orders', o.id), { ...o, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }).then(() => true, () => false);
          const [r] = await Promise.all([create(o), browser]);
          assert.equal(r.status, 200);
          const led = await get(`orderLedger/${o.id}`);
          assert.ok(['created', 'adopted'].includes(led.mode));
          const tg = await waitFor(async () => (await sinkFor(o.id)).filter((c) => c.channel === 'telegram' && c.ok).length === 1);
          assert.ok(tg, `#${i} exactly one telegram`);
        }
      } finally {
        await deleteApp(app);
      }
    }]);
  }

  // ---------- run ----------
  await fetch(`${S}/calls`, { method: 'DELETE', headers: sinkAuth });
  const results = [];
  for (const [id, name, fn] of scenarios) {
    if (only && !only.has(id)) continue;
    await reseed();
    const t0 = Date.now();
    try {
      await fn();
      results.push({ id, name, ok: true, ms: Date.now() - t0 });
      console.log(`✔ ${id} ${name}`);
    } catch (e) {
      results.push({ id, name, ok: false, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 500) });
      console.log(`✖ ${id} ${name}\n    ${String(e?.message || e).split('\n')[0]}`);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nstaging: ${results.length - failed}/${results.length} passed (project ${st.projectId})`);
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runCli(main);
