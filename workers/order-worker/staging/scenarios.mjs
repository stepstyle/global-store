// End-to-end scenarios S01–S12, shared by:
//   - staging/run-tests.mjs           (cloud staging: real Firestore + deployed staging Workers)
//   - test/local-e2e/inner.mjs        (local: Firestore emulator + `wrangler dev` workers, 127.0.0.1 only)
// The scenarios only talk to ctx.W (order Worker), ctx.S (notify sink) and Firestore through ctx.get().
//
// ctx = {
//   W, S, sinkAuth, turnstileToken, projectId,
//   get(path) -> decoded doc | null,  reseed() -> Promise,
//   browserApp() -> Promise<{ db, done() }>,   // Firebase JS SDK app for S12
//   triggerCron?() -> Promise,                  // local: hit /__scheduled; cloud: undefined (real cron)
//   cronWaitMs, cronStepMs, notifyWaitMs,
//   createBudget: { limit, windowMs },          // stay below the Worker's create rate limit (per client IP)
//   skipCron, skipBrowser, only: Set|null, label
// }

import assert from 'node:assert/strict';
import { checkoutOrder, line, makeOrderId } from '../test/fixtures.mjs';
import { MARKER_PATH } from './common.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sliding-window budget for POST /create-order. The Worker limits creates per client IP
 * (staging: 20 / 60 s). All scenarios come from ONE IP, so without pacing the later ones would
 * receive 429 for reasons unrelated to what they test.
 */
export function makeCreateBudget({ limit = 18, windowMs = 61_000 } = {}) {
  const stamps = [];
  const prune = (now) => {
    while (stamps.length && now - stamps[0] >= windowMs) stamps.shift();
  };
  return {
    limit,
    async take(n = 1) {
      if (n > limit) throw new Error(`burst of ${n} exceeds create budget ${limit}`);
      for (;;) {
        const now = Date.now();
        prune(now);
        if (stamps.length + n <= limit) {
          for (let i = 0; i < n; i++) stamps.push(now);
          return;
        }
        await sleep(stamps[0] + windowMs - now + 50);
      }
    },
    /** record requests sent outside the budget (S10's deliberate burst) so later scenarios wait it out */
    note(n) {
      const now = Date.now();
      for (let i = 0; i < n; i++) stamps.push(now);
    },
    used: () => stamps.length,
  };
}

export function buildScenarios(ctx) {
  const { W, S, sinkAuth, get } = ctx;
  const budget = makeCreateBudget(ctx.createBudget);
  const notifyWaitMs = ctx.notifyWaitMs ?? 20_000;

  const stock = async (pid, vid) => {
    const p = await get(`products/${pid}`);
    return vid ? (p?.variants || []).find((v) => v.id === vid)?.stock : p?.stock;
  };
  const create = async (order, { token = ctx.turnstileToken, headers = {}, budgeted = true } = {}) => {
    if (budgeted) await budget.take(1);
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
  /** n creates sent truly in parallel (budget reserved up front so pacing cannot serialise them) */
  const createParallel = async (orders) => {
    await budget.take(orders.length);
    return Promise.all(orders.map((o) => create(o, { budgeted: false })));
  };
  const sinkCalls = async () => (await (await fetch(`${S}/calls`, { headers: sinkAuth })).json()).calls || [];
  const sinkFor = async (id) => (await sinkCalls()).filter((c) => c.orderId === id);
  const waitFor = async (fn, ms = notifyWaitMs, step = 500) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) return v;
      await sleep(step);
    }
  };

  const scenarios = [
    ['S01', 'happy path: Firestore commit, stock once, notified once', async () => {
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
      for (let i = 0; i < 5; i++) seq.push((await create(a)).body?.replay);
      assert.deepEqual(seq, [false, true, true, true, true]);
      const b = checkoutOrder({ items: [line('p-hundred', 1)] });
      const par = await createParallel(Array.from({ length: 5 }, () => b));
      assert.equal(par.filter((r) => r.body?.replay === false).length, 1, par.map((r) => r.status).join(','));
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
        const r = await create(o);
        assert.equal(r.status, 200, JSON.stringify(r.body));
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
    ['S06', 'concurrency: last item x2 in parallel, 10 parallel on one product', async () => {
      const a = checkoutOrder({ items: [line('p-last-one', 1)] });
      const b = checkoutOrder({ items: [line('p-last-one', 1)], overrides: { address: { ...a.address, phone: '+962771111111' } } });
      const rs = await createParallel([a, b]);
      assert.ok(rs.every((r) => r.status === 200), rs.map((r) => r.status).join(','));
      assert.equal(await stock('p-last-one'), 0);
      const start = await stock('p-hundred');
      const os = Array.from({ length: 10 }, () => checkoutOrder({ items: [line('p-hundred', 1)] }));
      const r10 = await createParallel(os);
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
      const N = 40;
      const statuses = await Promise.all(Array.from({ length: N }, () => fetch(`${W}/create-order`, { method: 'POST', body: '{' }).then((r) => r.status)));
      budget.note(N); // later scenarios wait until this burst has left the window
      assert.ok(statuses.includes(429), `no 429 in ${statuses.join(',')}`);
    }],
  ];

  if (!ctx.skipCron) {
    scenarios.push(['S11', `Telegram failure retried by cron (${ctx.triggerCron ? 'triggered locally' : 'real cron, up to 3 min'})`, async () => {
      await fetch(`${S}/control`, { method: 'POST', headers: { ...sinkAuth, 'content-type': 'application/json' }, body: JSON.stringify({ failNext: { telegram: 1 } }) });
      const o = checkoutOrder();
      assert.equal((await create(o)).status, 200);
      const sent = await waitFor(async () => {
        if (ctx.triggerCron) await ctx.triggerCron();
        const l = await get(`orderLedger/${o.id}`);
        return l?.notifications?.telegram?.state === 'sent' ? l : null;
      }, ctx.cronWaitMs ?? 180_000, ctx.cronStepMs ?? 5_000);
      assert.ok(sent, 'telegram eventually sent by cron');
      assert.ok(Number(sent.notifications.telegram.attempts) >= 2, 'first attempt failed, cron retried');
      const tg = await sinkFor(o.id);
      assert.equal(tg.filter((c) => c.channel === 'telegram' && !c.ok).length, 1, 'one failed attempt recorded');
      assert.equal(tg.filter((c) => c.channel === 'telegram' && c.ok).length, 1, 'exactly one successful telegram');
    }]);
  }

  if (!ctx.skipBrowser) {
    scenarios.push(['S12', 'browser (Firebase JS SDK, compat rules) + Worker in parallel x5', async () => {
      const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      const { db, done } = await ctx.browserApp();
      try {
        for (let i = 0; i < 5; i++) {
          const o = checkoutOrder();
          await budget.take(1);
          const browser = setDoc(doc(db, 'orders', o.id), { ...o, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }).then(() => true, () => false);
          const [r] = await Promise.all([create(o, { budgeted: false }), browser]);
          assert.equal(r.status, 200, JSON.stringify(r.body));
          const led = await get(`orderLedger/${o.id}`);
          assert.ok(['created', 'adopted'].includes(led.mode));
          const tg = await waitFor(async () => (await sinkFor(o.id)).filter((c) => c.channel === 'telegram' && c.ok).length === 1);
          assert.ok(tg, `#${i} exactly one telegram`);
        }
      } finally {
        await done();
      }
    }]);
  }
  return scenarios;
}

/** Preflight (Worker identity + staging/e2e marker), then every scenario after a reseed. */
export async function runScenarios(ctx) {
  const root = await (await fetch(`${ctx.W}/`)).json();
  assert.equal(root.ok, true, 'order Worker root');
  assert.match(root.version, /^v2\./);
  await ctx.reseed();
  const marker = await ctx.get(MARKER_PATH);
  if (!marker || marker.project !== ctx.projectId || marker.syntheticDataOnly !== true) {
    throw new Error(`marker missing in ${ctx.projectId}: refusing to run scenarios`);
  }

  const scenarios = buildScenarios(ctx);
  await fetch(`${ctx.S}/calls`, { method: 'DELETE', headers: ctx.sinkAuth });
  const results = [];
  for (const [id, name, fn] of scenarios) {
    if (ctx.only && !ctx.only.has(id)) continue;
    await ctx.reseed();
    const t0 = Date.now();
    try {
      await fn();
      results.push({ id, name, ok: true, ms: Date.now() - t0 });
      console.log(`✔ ${id} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      results.push({ id, name, ok: false, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 800) });
      console.log(`✖ ${id} ${name}\n    ${String(e?.message || e).split('\n')[0]}`);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${ctx.label}: ${results.length - failed}/${results.length} passed (project ${ctx.projectId})`);
  return results;
}
