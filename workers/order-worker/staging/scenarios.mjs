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
//   skipCron, skipBrowser, only: Set|null, label,
//   users?: { create(label) -> { uid, email, idToken }, forged() -> string }   // S40–S45 (signed-in customers):
//            staging: real Firebase Auth test users (staging/auth-users.mjs); local: test-signed tokens
// }

import assert from 'node:assert/strict';
import { checkoutOrder, line, makeOrderId } from '../test/fixtures.mjs';
import { MARKER_PATH } from './common.mjs';
import { hashTrackingKey } from '../src/tracking.js';
import { randomBytes } from 'node:crypto';

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

/**
 * Polls fn until it returns a truthy value or `ms` elapse. Hard deadline: a check that never answers cannot extend
 * the wait. Each attempt gets an AbortSignal (fn(signal)) that is ABORTED at the deadline — reads that pass it to
 * fetch are cancelled. Promise.race alone cancels nothing: a read that ignores the signal (e.g. the Firestore client
 * in src/firestore.js, which takes no signal) keeps running until its own end — on staging every request is bounded
 * by guardedFetch's per-request timeout (staging/guard.mjs). The deadline timer is always cleared (no timer keeps
 * the process alive after the result).
 */
export function makeWaitFor(defaultMs) {
  return async (fn, ms = defaultMs, step = 500) => {
    const end = Date.now() + ms;
    for (;;) {
      const left = Math.max(0, end - Date.now());
      const ac = new AbortController();
      let timer;
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => {
          ac.abort(new Error('waitFor: deadline reached'));
          resolve(undefined);
        }, left + step);
      });
      const attempt = Promise.resolve().then(() => fn(ac.signal));
      attempt.catch(() => {}); // a read cancelled AFTER the deadline must not become an unhandled rejection
      let v;
      try {
        v = await Promise.race([attempt, deadline]);
      } finally {
        clearTimeout(timer);
      }
      if (v) return v;
      if (Date.now() > end) return v;
      await sleep(step);
    }
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
  const create = async (order, { token = ctx.turnstileToken, headers = {}, budgeted = true, extra = {} } = {}) => {
    if (budgeted) await budget.take(1);
    const r = await fetch(`${W}/create-order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ order, ...(token ? { turnstileToken: token } : {}), ...extra }),
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
  /**
   * What a real client (src/services/orderSubmit.ts) does with 503 RETRY_LATER: resend the SAME order (same number,
   * same payload) after a short backoff. A 503 is NOT assumed to mean "nothing saved": the resend is idempotent
   * (ledger -> replay), so the final stock count is what proves exactly-once.
   */
  const settle503 = async (o, first) => {
    let r = first;
    let retries = 0;
    while (r.status === 503 && retries < 5) {
      retries++;
      await sleep(200 * retries);
      r = await create(o);
    }
    return { ...r, retries503: retries };
  };
  // `signal` (optional): cancels the read when a waitFor deadline is reached
  const sinkCalls = async (signal) => (await (await fetch(`${S}/calls`, { headers: sinkAuth, signal })).json()).calls || [];
  const sinkFor = async (id, signal) => (await sinkCalls(signal)).filter((c) => c.orderId === id);
  const waitFor = makeWaitFor(notifyWaitMs);

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
      const calls = await waitFor(async (signal) => {
        const c = await sinkFor(o.id, signal);
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
    ['S06', 'concurrency: last item x2 in parallel, 10 parallel on one product (503 -> client resend, same number)', async () => {
      const a = checkoutOrder({ items: [line('p-last-one', 1)] });
      const b = checkoutOrder({ items: [line('p-last-one', 1)], overrides: { address: { ...a.address, phone: '+962771111111' } } });
      const pair = [a, b];
      const rs = await Promise.all((await createParallel(pair)).map((r, i) => settle503(pair[i], r)));
      assert.ok(rs.every((r) => r.status === 200), rs.map((r) => r.status).join(','));
      assert.equal(await stock('p-last-one'), 0);
      const start = await stock('p-hundred');
      const os = Array.from({ length: 10 }, () => checkoutOrder({ items: [line('p-hundred', 1)] }));
      const first = await createParallel(os);
      const r10 = await Promise.all(first.map((r, i) => settle503(os[i], r)));
      const resent = r10.reduce((n, r) => n + r.retries503, 0);
      if (resent) console.log(`    S06: ${resent} resend(s) after 503 (first statuses ${first.map((r) => r.status).join(',')})`);
      assert.ok(r10.every((r) => r.status === 200), r10.map((r) => r.status).join(','));
      for (const o of os) assert.ok(await get(`orderLedger/${o.id}`), `ledger for ${o.id}`);
      assert.equal(await stock('p-hundred'), start - 10, 'exactly once per order, even with resends');
    }],
    ['S07', 'tampered prices flagged; sink summary shows server total', async () => {
      const o = checkoutOrder({ items: [{ ...line('p-simple', 2), price: 0.01 }, { ...line('p-variants', 1, { variantId: 'var_red' }), price: 0.01 }] });
      assert.equal((await create(o)).status, 200);
      const led = await get(`orderLedger/${o.id}`);
      assert.equal(led.priceMismatch, true);
      const tg = await waitFor(async (signal) => (await sinkFor(o.id, signal)).find((c) => c.channel === 'telegram' && c.ok));
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
      // the local dev origin the Worker under test allows (staging: exactly http://127.0.0.1:3000)
      const devOrigin = ctx.devOrigin ?? 'http://127.0.0.1:3000';
      const dev = await fetch(`${W}/orders/${makeOrderId()}/status`, { headers: { origin: devOrigin } });
      assert.equal(dev.headers.get('access-control-allow-origin'), devOrigin);
    }],
    ['S10', 'rate limit binding answers 429 under a burst', async () => {
      const N = 40;
      const statuses = await Promise.all(Array.from({ length: N }, () => fetch(`${W}/create-order`, { method: 'POST', body: '{' }).then((r) => r.status)));
      budget.note(N); // later scenarios wait until this burst has left the window
      assert.ok(statuses.includes(429), `no 429 in ${statuses.join(',')}`);
    }],
  ];

  // ---------------- signed-in customers (S40–S45): real ID tokens on staging, test-signed locally ----------------
  if (ctx.users) {
    const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const newKey = () => Array.from(randomBytes(24), (b) => B32[b % 32]).join('');
    const bearer = (tok) => ({ authorization: `Bearer ${tok}` });
    const ledgerOf = (id) => get(`orderLedger/${id}`);
    const orderDoc = (id) => get(`orders/${id}`);
    const summary = (id, headers = {}) => fetch(`${W}/orders/${encodeURIComponent(id)}/summary`, { headers }).then(async (r) => ({ status: r.status, text: await r.text() }));
    const status = (id) => fetch(`${W}/orders/${encodeURIComponent(id)}/status`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
    // personal data of the fixture order (fixtures.mjs) that must never appear in a summary
    const PII = (o) => [o.address?.fullName, o.address?.phone, o.address?.street, o.customerEmail].filter(Boolean).map(String);

    scenarios.push(
      ['S40', 'signed-in order is linked to the VERIFIED account (ID token), stock once', async () => {
        const a = await ctx.users.create('a');
        const o = checkoutOrder({ userId: a.uid });
        const r = await create(o, { headers: bearer(a.idToken) });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const led = await ledgerOf(o.id);
        assert.equal(led.ownerUid, a.uid, 'owner = verified uid');
        assert.equal(led.userIdSource, 'firebase-id-token');
        assert.equal((await orderDoc(o.id)).userId, a.uid);
        assert.equal(await stock('p-simple'), 8, 'stock once');
      }],
      ['S41', 'replay of an OWNED order: owner -> replay; another account / no token -> 409 ORDER_EXISTS; owner never changes; stock once', async () => {
        const a = await ctx.users.create('a');
        const b = await ctx.users.create('b');
        const o = checkoutOrder({ userId: a.uid });
        assert.equal((await create(o, { headers: bearer(a.idToken) })).status, 200);
        const again = await create(o, { headers: bearer(a.idToken) });
        assert.equal(again.status, 200);
        assert.equal(again.body?.replay, true, 'owner replay');
        const other = await create(o, { headers: bearer(b.idToken) });
        assert.equal(other.status, 409);
        assert.equal(other.body?.code, 'ORDER_EXISTS');
        const anon = await create(o);
        assert.equal(anon.status, 409);
        assert.equal(anon.body?.code, 'ORDER_EXISTS', 'same answer without a token (no oracle)');
        assert.equal((await ledgerOf(o.id)).ownerUid, a.uid, 'owner unchanged');
        assert.equal(await stock('p-simple'), 8, 'stock once');
      }],
      ['S42', 'token of account B with an order claiming account A -> 403 USERID_MISMATCH, nothing written', async () => {
        const a = await ctx.users.create('a');
        const b = await ctx.users.create('b');
        const o = checkoutOrder({ userId: a.uid });
        const r = await create(o, { headers: bearer(b.idToken) });
        assert.equal(r.status, 403);
        assert.equal(r.body?.code, 'USERID_MISMATCH');
        assert.equal(await ledgerOf(o.id), null);
        assert.equal(await orderDoc(o.id), null);
        assert.equal(await stock('p-simple'), 10, 'stock untouched');
      }],
      ['S43', 'forged / garbage token -> 401 (nothing written); a guest without a token still buys', async () => {
        const o = checkoutOrder();
        for (const tok of [await ctx.users.forged(), 'not-a-token']) {
          const r = await create(o, { headers: bearer(tok) });
          assert.equal(r.status, 401, `token refused (${r.body?.code})`);
          assert.match(String(r.body?.code), /^AUTH_(INVALID|EXPIRED)$/);
        }
        assert.equal(await ledgerOf(o.id), null);
        assert.equal(await stock('p-simple'), 10);
        const g = await create(checkoutOrder());
        assert.equal(g.status, 200, 'guest unchanged');
      }],
      ['S44', 'tracking: status only without proof; details with the tracking key or the OWNER token; wrong key / other account -> same 404; no personal data', async () => {
        const a = await ctx.users.create('a');
        const b = await ctx.users.create('b');
        const key = newKey();
        const o = checkoutOrder({ userId: a.uid });
        assert.equal((await create(o, { headers: bearer(a.idToken), extra: { trackingKeyHash: await hashTrackingKey(key) } })).status, 200);
        const st = await status(o.id);
        assert.equal(st.status, 200);
        assert.deepEqual(Object.keys(st.body || {}).sort(), ['exists', 'ok', 'status']);
        const refusals = [
          await summary(o.id),
          await summary(o.id, { 'x-tracking-key': newKey() }),
          await summary(o.id, bearer(b.idToken)),
          await summary(o.id, bearer(await ctx.users.forged())),
        ];
        const ref = refusals.map((x) => x.status);
        assert.deepEqual(ref, [404, 404, 404, 404], 'every refusal looks the same');
        assert.equal(new Set(refusals.map((x) => x.text)).size, 1, 'identical refusal bodies');
        for (const ok of [await summary(o.id, { 'x-tracking-key': key }), await summary(o.id, bearer(a.idToken))]) {
          assert.equal(ok.status, 200);
          for (const p of PII(o)) assert.equal(ok.text.includes(p), false, 'summary without personal data');
        }
        assert.equal((await ledgerOf(o.id)).trackingKeyHash, await hashTrackingKey(key), 'only the hash is stored');
      }],
      ['S45', 'recovery after a lost answer: the SAME order resent with the same key -> replay, one order, one deduction; the key still opens it', async () => {
        const a = await ctx.users.create('a');
        const key = newKey();
        const h = await hashTrackingKey(key);
        const o = checkoutOrder({ userId: a.uid });
        assert.equal((await create(o, { headers: bearer(a.idToken), extra: { trackingKeyHash: h } })).status, 200); // answer "lost"
        const again = await create(o, { headers: bearer(a.idToken), extra: { trackingKeyHash: h } });
        assert.equal(again.status, 200);
        assert.equal(again.body?.replay, true);
        assert.equal(await stock('p-simple'), 8, 'one deduction');
        assert.equal((await summary(o.id, { 'x-tracking-key': key })).status, 200);
        assert.equal((await ledgerOf(o.id)).trackingKeyHash, h, 'written once, unchanged');
      }],
    );
  }

  if (!ctx.skipCron) {
    scenarios.push(['S11', `Telegram failure retried by cron (${ctx.triggerCron ? 'triggered locally' : `real cron, up to ${Math.round((ctx.cronWaitMs ?? 180_000) / 60_000)} min`})`, async () => {
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
    scenarios.push(['S46', `cron: failed notifications are handled ONE order per run, OLDEST first; e-mail never resent; queue left only when done (${ctx.triggerCron ? 'triggered locally' : 'real cron'})`, async () => {
      await fetch(`${S}/control`, { method: 'POST', headers: { ...sinkAuth, 'content-type': 'application/json' }, body: JSON.stringify({ failNext: { telegram: 2 } }) });
      const older = checkoutOrder();
      assert.equal((await create(older)).status, 200);
      await sleep(1_500); // a clearly older due time
      const newer = checkoutOrder();
      assert.equal((await create(newer)).status, 200);
      const tg = (l) => l?.notifications?.telegram;
      for (const o of [older, newer]) {
        // the first sends run after the answer (waitUntil): wait until both channels have settled
        const l = await waitFor(async () => {
          const x = await get(`orderLedger/${o.id}`);
          return ['failed', 'sent'].includes(tg(x)?.state) && ['failed', 'sent'].includes(x?.notifications?.email?.state) ? x : null;
        });
        assert.ok(l, 'first notifications settled');
        assert.equal(tg(l)?.state, 'failed', 'first telegram failed');
        assert.equal(l?.notifications?.email?.state, 'sent', 'e-mail sent at once');
        assert.equal(l?.notifyPending, true);
        assert.ok(l?.notifyNextAt, 'queued with a due time');
      }
      const sentNow = async () => {
        const [lo, ln] = await Promise.all([get(`orderLedger/${older.id}`), get(`orderLedger/${newer.id}`)]);
        return { lo, ln, o: tg(lo)?.state === 'sent', n: tg(ln)?.state === 'sent' };
      };
      if (ctx.triggerCron) {
        // local: each trigger is ONE cron run
        await ctx.triggerCron();
        const one = await waitFor(async () => { const s = await sentNow(); return s.o || s.n ? s : null; }, ctx.cronWaitMs ?? 30_000, 250);
        assert.ok(one, 'the first run handled an order');
        assert.deepEqual([one.o, one.n], [true, false], 'run 1: ONLY the oldest');
        await ctx.triggerCron();
        const two = await waitFor(async () => { const s = await sentNow(); return s.n ? s : null; }, ctx.cronWaitMs ?? 30_000, 250);
        assert.ok(two, 'run 2: the newer one');
      } else {
        // real cron (every 5 min, one order per run): both end up sent, the older first, in DIFFERENT runs
        const both = await waitFor(async () => { const s = await sentNow(); return s.o && s.n ? s : null; }, ctx.cronWaitMs ?? 720_000, ctx.cronStepMs ?? 15_000);
        assert.ok(both, 'both sent by cron within the wait limit');
        const tOld = new Date(tg(both.lo).sentAt).getTime();
        const tNew = new Date(tg(both.ln).sentAt).getTime();
        assert.ok(tOld < tNew, 'oldest first');
        assert.ok(tNew - tOld >= 60_000, `not in the same run (${Math.round((tNew - tOld) / 1000)} s apart)`);
      }
      for (const o of [older, newer]) {
        const l = await get(`orderLedger/${o.id}`);
        assert.equal(tg(l)?.state, 'sent');
        assert.equal(Number(tg(l)?.attempts), 2, 'one failure + one retry');
        assert.equal(l?.notifyPending, false, 'left the queue when done');
        assert.equal(l?.notifyNextAt === undefined || l?.notifyNextAt === null, true, 'no due time left');
        const calls = await sinkFor(o.id);
        assert.equal(calls.filter((c) => c.channel === 'telegram' && c.ok).length, 1, 'one telegram delivered');
        assert.equal(calls.filter((c) => c.channel === 'email' && c.ok).length, 1, 'e-mail delivered once, never resent');
      }
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
          const tg = await waitFor(async (signal) => (await sinkFor(o.id, signal)).filter((c) => c.channel === 'telegram' && c.ok).length === 1);
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
