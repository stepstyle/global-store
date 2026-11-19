// LOCAL LOAD TEST — the real Worker code (src/index.js, in-process) + Firestore EMULATOR (demo- project) + local
// mock Telegram/SendGrid/JWKS. Never touches production: emulator host must be loopback (helpers.mjs refuses otherwise).
//   firebase emulators:exec --only firestore --project demo-dairsharaf-orders "node test/load/load-orders.mjs"
// Production-like settings: STOCK_POLICY=on_delivery, PRICE_CHECK_MODE=enforce (Turnstile: log, no real widget here).
// What it shows: latency / errors under concurrent orders, no oversell, no duplicate orders, delivery deducts once.
// What it does NOT show: Cloudflare/Firestore production capacity (see docs/LOAD-TEST.md for the difference).
import worker from '../../src/index.js';
import { startMockServices, makeEnv, clearDb, putDoc, getDecoded, adminDb, PROJECT_ID } from '../helpers.mjs';
import { checkoutOrder, makeOrderId } from '../fixtures.mjs';
import { makeTestSigner } from '../token-signer.mjs';
import { decodeFields } from '../../src/firestore.js';

const OWNER = 'ownerUid00000000000000000000O1';
const PRODUCTS = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`load-p${i}`, { name: `منتج ${i}`, price: 2, stock: 1000, category: 'Stationery' }]));
PRODUCTS['load-hot'] = { name: 'منتج مطلوب', price: 3, stock: 30, category: 'Stationery' };
PRODUCTS['load-hot2'] = { name: 'منتج مطلوب 2', price: 3, stock: 30, category: 'Stationery' };
for (let i = 0; i < 10; i++) PRODUCTS[`load-q${i}`] = { name: `منتج ق${i}`, price: 2, stock: 1000, category: 'Stationery' };

const mock = await startMockServices();
const signer = await makeTestSigner('kid-load');
mock.state.jwks = { keys: [signer.jwk] };
const env = makeEnv(mock.url, { STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', PRICE_CHECK_MODE: 'enforce' });
const ownerToken = await signer.idToken({ projectId: PROJECT_ID, uid: OWNER });
const origLog = console.log;
console.log = () => {}; // the Worker's per-request JSON logs
const say = (...a) => origLog(...a);

let ipN = 0;
/** one HTTP call into the Worker; latency = until the RESPONSE (background notification work is awaited after) */
async function call(path, { method = 'POST', body, headers = {} } = {}) {
  const pending = [];
  const ip = `10.${(++ipN >> 16) & 255}.${(ipN >> 8) & 255}.${ipN & 255}`;
  const t0 = performance.now();
  const res = await worker.fetch(new Request(`http://worker.local${path}`, { method, headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil: (p) => pending.push(p) });
  const ms = performance.now() - t0;
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json, ms, done: Promise.allSettled(pending) };
}
const item = (pid, qty) => ({ productId: pid, name: PRODUCTS[pid].name, price: PRODUCTS[pid].price, quantity: qty, image: '', selectedVariant: null });
const newOrder = (pid, qty) => checkoutOrder({ id: makeOrderId(), items: [item(pid, qty)] });
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]) : 0; };
const tally = (rs) => rs.reduce((m, r) => { const k = r.status === 200 ? (r.body?.replay ? '200-replay' : '200') : `${r.status}-${r.body?.code || ''}`; m[k] = (m[k] || 0) + 1; return m; }, {});

async function seed() {
  await clearDb();
  for (const [id, p] of Object.entries(PRODUCTS)) await putDoc(`products/${id}`, p);
  await putDoc('config/roles', { ownerUid: OWNER });
}
async function all(collectionId) {
  return (await adminDb().runQuery({ from: [{ collectionId }] })).map((d) => ({ id: d.name.split('/').pop(), ...decodeFields(d.fields) }));
}

const report = { startedAt: new Date().toISOString(), phases: [] };
await seed();
const accepted = new Map(); // orderId -> { pid, qty }

// ---------------- 1. ramp: N orders sent at the same instant, spread over 10 products
for (const n of [10, 25, 50, 100, 200]) {
  const orders = Array.from({ length: n }, (_, i) => { const pid = `load-p${i % 10}`; const qty = 1 + (i % 2); return { o: newOrder(pid, qty), pid, qty }; });
  const t0 = performance.now();
  const rs = await Promise.all(orders.map(({ o }) => call('/create-order', { body: { order: o } })));
  const wall = performance.now() - t0;
  await Promise.all(rs.map((r) => r.done));
  rs.forEach((r, i) => { if (r.status === 200) accepted.set(orders[i].o.id, orders[i]); });
  const ms = rs.map((r) => r.ms);
  report.phases.push({ phase: `ramp ${n} concurrent`, n, results: tally(rs), p50: pct(ms, 50), p95: pct(ms, 95), p99: pct(ms, 99), max: pct(ms, 100), wallMs: Math.round(wall), ordersPerSec: Math.round((n / wall) * 1000 * 10) / 10 });
  say(JSON.stringify(report.phases.at(-1)));
}

// ---------------- 2. hot product: 150 buyers at once for 30 pieces
{
  const orders = Array.from({ length: 150 }, () => ({ o: newOrder('load-hot', 1), pid: 'load-hot', qty: 1 }));
  const rs = await Promise.all(orders.map(({ o }) => call('/create-order', { body: { order: o } })));
  await Promise.all(rs.map((r) => r.done));
  rs.forEach((r, i) => { if (r.status === 200) accepted.set(orders[i].o.id, orders[i]); });
  const ms = rs.map((r) => r.ms);
  const hotRes = await getDecoded('stockReservations/load-hot');
  report.phases.push({ phase: 'hot product: 150 concurrent buyers, stock 30', n: 150, results: tally(rs), reservedAfter: hotRes?.product || 0, p50: pct(ms, 50), p95: pct(ms, 95), max: pct(ms, 100) });
  say(JSON.stringify(report.phases.at(-1)));
}

// ---------------- 2b. what the CUSTOMER sees: the web app's own retry policy (src/services/orderSubmit.ts DEFAULTS:
// 3 attempts, waits 1 s then 3 s, the SAME order number -> a replay is never a second order)
async function asCustomer(o) {
  const waits = [1_000, 3_000];
  let last;
  const t0 = performance.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await call('/create-order', { body: { order: o } });
    await last.done;
    if (last.status !== 503) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, waits[attempt]));
  }
  return { ...last, totalMs: performance.now() - t0 };
}
for (const [label, mk] of [
  ['customer view: 200 customers at once, 10 products, app retries', (i) => ({ pid: `load-q${i % 10}`, qty: 1 })],
  ['customer view: 150 buyers at once for 30 pieces, app retries', () => ({ pid: 'load-hot2', qty: 1 })],
]) {
  const n = label.includes('200') ? 200 : 150;
  const orders = Array.from({ length: n }, (_, i) => { const { pid, qty } = mk(i); return { o: newOrder(pid, qty), pid, qty }; });
  const rs = await Promise.all(orders.map(({ o }) => asCustomer(o)));
  rs.forEach((r, i) => { if (r.status === 200) accepted.set(orders[i].o.id, orders[i]); });
  const tm = rs.map((r) => r.totalMs);
  report.phases.push({ phase: label, n, finalResults: tally(rs), p50TotalMs: pct(tm, 50), p95TotalMs: pct(tm, 95), maxTotalMs: pct(tm, 100) });
  say(JSON.stringify(report.phases.at(-1)));
}

// ---------------- 3. duplicates: 50 orders, each sent 4 times at once (double click, retry, two tabs)
{
  const orders = Array.from({ length: 50 }, (_, i) => ({ o: newOrder(`load-p${i % 10}`, 1), pid: `load-p${i % 10}`, qty: 1 }));
  const rs = await Promise.all(orders.flatMap(({ o }) => Array.from({ length: 4 }, () => call('/create-order', { body: { order: o } }))));
  await Promise.all(rs.map((r) => r.done));
  for (let i = 0; i < orders.length; i++) if (rs.slice(i * 4, i * 4 + 4).some((r) => r.status === 200)) accepted.set(orders[i].o.id, orders[i]);
  const stored = (await all('orders')).filter((d) => orders.some((x) => x.o.id === d.id)).length;
  report.phases.push({ phase: 'duplicates: 50 orders x 4 identical sends at once', n: 200, results: tally(rs), ordersStored: stored, expected: 50 });
  say(JSON.stringify(report.phases.at(-1)));
}

// ---------------- 4. delivery: 100 accepted orders delivered, each status call sent twice at once
{
  const ids = [...accepted.keys()].slice(0, 100);
  const before = Object.fromEntries(await Promise.all(Object.keys(PRODUCTS).map(async (id) => [id, (await getDecoded(`products/${id}`)).stock])));
  const rs = await Promise.all(ids.flatMap((id) => [0, 1].map(() => call(`/admin/orders/${encodeURIComponent(id)}/status`, { body: { status: 'delivered' }, headers: { authorization: `Bearer ${ownerToken}`, origin: 'https://dairsharaf.com' } }))));
  await Promise.all(rs.map((r) => r.done));
  const want = {};
  for (const id of ids) { const { pid, qty } = accepted.get(id); want[pid] = (want[pid] || 0) + qty; }
  let deductedRight = true;
  for (const id of Object.keys(PRODUCTS)) {
    const now = (await getDecoded(`products/${id}`)).stock;
    if (before[id] - now !== (want[id] || 0)) deductedRight = false;
  }
  const ms = rs.map((r) => r.ms);
  const results = rs.reduce((m, r) => { const k = r.status === 200 ? `200-${r.body?.result}` : `${r.status}-${r.body?.code || ''}`; m[k] = (m[k] || 0) + 1; return m; }, {});
  report.phases.push({ phase: 'delivery: 100 orders x 2 simultaneous "delivered" clicks', n: 200, results, stockDeductedExactlyOnce: deductedRight, p50: pct(ms, 50), p95: pct(ms, 95), max: pct(ms, 100) });
  say(JSON.stringify(report.phases.at(-1)));
}

// ---------------- 5. invariants over everything
{
  const ledgers = await all('orderLedger');
  const orders = await all('orders');
  const res = await all('stockReservations');
  const want = {};
  for (const L of ledgers) if (L.inventory === 'reserved') for (const r of L.reservations || []) want[r.productId] = (want[r.productId] || 0) + r.qty;
  const mismatch = res.filter((r) => (r.product || 0) !== (want[r.id] || 0)).length + Object.keys(want).filter((pid) => !res.some((r) => r.id === pid)).length;
  const oversold = Object.keys(PRODUCTS).filter((id) => {
    const reserved = res.find((r) => r.id === id)?.product || 0;
    return reserved > PRODUCTS[id].stock;
  });
  const telegram = mock.state.calls.filter((c) => c.channel === 'telegram');
  const perOrder = {};
  for (const c of telegram) perOrder[c.orderId] = (perOrder[c.orderId] || 0) + 1;
  report.invariants = {
    ordersAccepted: accepted.size, ordersStored: orders.length, ledgers: ledgers.length,
    reservationsMatchLedgers: mismatch === 0, oversoldProducts: oversold.length,
    telegramMessages: telegram.length, ordersWithMoreThanOneTelegram: Object.values(perOrder).filter((n) => n > 1).length,
  };
  say(JSON.stringify({ invariants: report.invariants }));
}
report.finishedAt = new Date().toISOString();
say(`REPORT ${JSON.stringify(report)}`);
await mock.close();
const ok = report.invariants.reservationsMatchLedgers && report.invariants.oversoldProducts === 0 && report.invariants.ordersStored === report.invariants.ordersAccepted
  && report.phases.find((p) => p.phase.startsWith('duplicates')).ordersStored === 50 && report.phases.find((p) => p.phase.startsWith('delivery')).stockDeductedExactlyOnce
  && report.invariants.ordersWithMoreThanOneTelegram === 0;
say(ok ? 'LOAD RESULT: PASS (integrity)' : 'LOAD RESULT: FAIL (integrity)');
process.exit(ok ? 0 : 1);
