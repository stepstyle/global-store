// PRICE_CHECK_MODE=enforce — LOCAL ONLY, no network. The real Worker (src/index.js, 'local' build target) with
// globalThis.fetch replaced by an in-memory Firestore (commit preconditions enforced like the emulator) and fake
// Telegram / SendGrid that count every send. Synthetic fixture products only.
//   node --test test/unit/price-enforce.test.mjs
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../src/index.js';
import { loadConfig } from '../../src/config.js';
import { encodeFields, decodeFields } from '../../src/firestore.js';
import { enforcePriceProblems, computeServerPricing } from '../../src/pricing.js';
import { checkoutOrder, line, makeOrderId, PRODUCTS, variantSnapshot } from '../fixtures.mjs';

const PROJECT = 'demo-price-enforce';
const FS = 'http://127.0.0.1:8999/v1';
const NOTIFY = 'http://127.0.0.1:8998';
const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const DOCS = `${FS}/${ROOT}`;

const baseEnv = (mode) => ({
  ENVIRONMENT: 'local', FIREBASE_PROJECT_ID: PROJECT, FIRESTORE_AUTH: 'emulator', FIRESTORE_BASE_URL: FS,
  OAUTH_TOKEN_URL: `${NOTIFY}/oauth/token`, TELEGRAM_API_BASE: `${NOTIFY}/telegram`, SENDGRID_API_BASE: `${NOTIFY}/sendgrid`,
  TURNSTILE_VERIFY_URL: `${NOTIFY}/turnstile`, TURNSTILE_MODE: 'off',
  TELEGRAM_BOT_TOKEN: 'test-bot-token', TELEGRAM_CHAT_ID: 'test-chat', SENDGRID_API_KEY: 'test-sendgrid-key',
  ADMIN_EMAIL: 'admin@example.invalid', EMAIL_FROM: 'orders@example.invalid',
  STOCK_MODE: 'apply', RECONCILE_ENABLED: 'false', CREATE_WAIT_MS: '0',
  RATE_LIMIT_CREATE_PER_MIN: '1000000', RATE_LIMIT_STATUS_PER_MIN: '1000000',
  ...(mode === undefined ? {} : { PRICE_CHECK_MODE: mode }),
});

// ------------------------------------------------------------------ in-memory world
let docs, commits, sends, tick = 0;
const origFetch = globalThis.fetch;
const origLog = console.log;
const nextTime = () => new Date().toISOString().replace('Z', `${String(++tick).padStart(6, '0')}Z`);
const getPath = (f, p) => p.split('.').reduce((x, k, i, a) => (x === undefined ? undefined : i === a.length - 1 ? x[k] : x[k]?.mapValue?.fields), f);
function setPath(fields, path, value) {
  const keys = path.split('.');
  let f = fields;
  for (const k of keys.slice(0, -1)) { if (!f[k]?.mapValue) f[k] = { mapValue: { fields: {} } }; f[k].mapValue.fields ??= {}; f = f[k].mapValue.fields; }
  if (value === undefined) delete f[keys.at(-1)]; else f[keys.at(-1)] = structuredClone(value);
}
function commit(writes) {
  commits.push(writes.map((w) => w.update.name.slice(ROOT.length + 1)));
  for (const w of writes) {
    const cur = docs.get(w.update.name);
    const pre = w.currentDocument;
    if (pre && 'exists' in pre && Boolean(cur) !== pre.exists) return [409, { error: { status: 'ALREADY_EXISTS' } }];
    if (pre?.updateTime && cur?.updateTime !== pre.updateTime) return [400, { error: { status: 'FAILED_PRECONDITION' } }];
  }
  const now = nextTime();
  for (const w of writes) {
    const cur = docs.get(w.update.name);
    let fields = w.updateMask ? structuredClone(cur?.fields ?? {}) : structuredClone(w.update.fields);
    if (w.updateMask) for (const p of w.updateMask.fieldPaths) setPath(fields, p, getPath(w.update.fields, p));
    for (const t of w.updateTransforms ?? []) setPath(fields, t.fieldPath, { timestampValue: new Date().toISOString() });
    docs.set(w.update.name, { fields, createTime: cur?.createTime ?? new Date().toISOString(), updateTime: now });
  }
  return [200, { writeResults: writes.map(() => ({ updateTime: now })) }];
}
const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const docJson = (name, d) => ({ name, fields: d.fields, createTime: d.createTime, updateTime: d.updateTime });
async function fakeFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  if (url.origin === NOTIFY) {
    sends.push(url.pathname.startsWith('/telegram') ? 'telegram' : url.pathname.startsWith('/sendgrid') ? 'email' : url.pathname);
    return url.pathname.startsWith('/sendgrid') ? new Response(null, { status: 202 }) : reply(200, { ok: true, result: { message_id: 1 } });
  }
  if (!url.href.startsWith(FS)) throw new Error(`unexpected request ${url.origin}`);
  const full = decodeURIComponent(url.href);
  const body = init.body ? JSON.parse(init.body) : null;
  if (full === `${DOCS}:batchGet`) return reply(200, body.documents.map((n) => (docs.has(n) ? { found: docJson(n, docs.get(n)) } : { missing: n })));
  if (full === `${DOCS}:commit`) { const [s, d] = commit(body.writes); return reply(s, d); }
  if (full === `${DOCS}:runQuery`) return reply(200, []);
  if (method === 'GET' && full.startsWith(`${DOCS}/`)) {
    const n = `${ROOT}/${full.slice(DOCS.length + 1)}`;
    return docs.has(n) ? reply(200, docJson(n, docs.get(n))) : reply(404, { error: { status: 'NOT_FOUND' } });
  }
  throw new Error(`fake Firestore: unsupported ${method} ${url.pathname}`);
}
const put = (path, data) => docs.set(`${ROOT}/${path}`, { fields: encodeFields(data), createTime: new Date().toISOString(), updateTime: nextTime() });
const read = (path) => (docs.has(`${ROOT}/${path}`) ? decodeFields(docs.get(`${ROOT}/${path}`).fields) : null);
const snapshot = () => JSON.stringify([...docs.entries()]);

beforeEach(() => {
  docs = new Map(); commits = []; sends = [];
  globalThis.fetch = fakeFetch;
  console.log = () => {};
  for (const id of ['p-simple', 'p-variants', 'p-hundred']) put(`products/${id}`, PRODUCTS[id]);
});
afterEach(() => { globalThis.fetch = origFetch; console.log = origLog; delete globalThis.__DEPLOY_TARGET__; });

async function create(mode, order) {
  const pending = [];
  const req = new Request('http://worker.local/create-order', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.0.0.1' }, body: JSON.stringify({ order }) });
  const res = await worker.fetch(req, baseEnv(mode), { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return { status: res.status, body: await res.json() };
}
// a checkout order with explicit numbers (the fixture computes subtotal/discount like the storefront; shipping is given)
const order = (items, { shipping = 1, meta = {}, method = 'standard', patch = {} } = {}) => {
  const o = checkoutOrder({ id: makeOrderId(), items });
  const subtotal = items.reduce((s, l) => s + l.price * l.quantity, 0);
  const qty = items.reduce((s, l) => s + l.quantity, 0);
  const discountAmount = qty > 2 ? Math.round(subtotal * 0.1 * 1000) / 1000 : 0;
  return { ...o, subtotal, discountAmount, shippingCost: shipping, total: Math.round((subtotal - discountAmount + shipping) * 1000) / 1000, shippingMethodId: method, addressMeta: { ...o.addressMeta, ...meta }, ...patch };
};
const assertNothingHappened = (before, tag) => {
  assert.deepEqual(commits, [], `${tag}: no commit at all (no orders/, no orderLedger/, no stock write)`);
  assert.deepEqual(sends, [], `${tag}: no notification`);
  assert.equal(snapshot(), before, `${tag}: Firestore byte-identical`);
};

// ------------------------------------------------------------------ config
test('config: PRICE_CHECK_MODE log (default) | enforce accepted | anything else refused', () => {
  globalThis.__DEPLOY_TARGET__ = 'local';
  assert.equal(loadConfig(baseEnv(undefined)).priceCheckMode, 'log');
  assert.equal(loadConfig(baseEnv('log')).priceCheckMode, 'log');
  assert.equal(loadConfig(baseEnv('enforce')).priceCheckMode, 'enforce');
  for (const bad of ['Enforce ', 'strict', 'on']) {
    const c = loadConfig(baseEnv(bad));
    assert.equal(c.ok, false, bad);
    assert.ok(c.errors.some((e) => /PRICE_CHECK_MODE/.test(e)));
  }
});

// ------------------------------------------------------------------ enforce: correct orders pass, unchanged flow
test('enforce: correct order p-simple 2.50 + delivery 1.00 = 3.50 -> saved once, stock -1, both notifications', async () => {
  const o = order([line('p-simple', 1)]);
  assert.deepEqual([o.subtotal, o.discountAmount, o.shippingCost, o.total], [2.5, 0, 1, 3.5]);
  const r = await create('enforce', o);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, orderId: o.id, replay: false });
  assert.equal(read('products/p-simple').stock, 9);
  const l = read(`orderLedger/${o.id}`);
  assert.equal(l.priceMismatch, false);
  assert.deepEqual([l.serverPricing.subtotal, l.serverPricing.discount, l.serverPricing.shipping, l.serverPricing.total], [2.5, 0, 1, 3.5]);
  assert.equal(read(`orders/${o.id}`).total, 3.5);
  assert.deepEqual(sends.sort(), ['email', 'telegram']);
  // replay of the same order: no second deduction, no second notification
  const again = await create('enforce', o);
  assert.deepEqual(again.body, { ok: true, orderId: o.id, replay: true });
  assert.equal(read('products/p-simple').stock, 9);
  assert.equal(sends.length, 2);
});

// ------------------------------------------------------------------ enforce: tampering refused before ANY write
test('enforce: product price lowered by the browser (2.50 -> 0.50, totals made consistent) -> 422 PRICE_CHANGED, nothing written', async () => {
  const before = snapshot();
  commits = []; sends = []; // count only what happens from here on
  const o = order([line('p-simple', 1, { price: 0.5 })]);
  const r = await create('enforce', o);
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'PRICE_CHANGED');
  assert.ok(r.body.problems.includes('items[0].price') && r.body.problems.includes('subtotal') && r.body.problems.includes('total'), r.body.problems);
  assert.deepEqual([r.body.serverPricing.total, r.body.serverPricing.lines[0].unitPrice], [3.5, 2.5], 'server numbers returned');
  assertNothingHappened(before, 'lowered price');
  assert.equal(read('products/p-simple').stock, 10);
  assert.equal(read(`orders/${o.id}`), null);
  assert.equal(read(`orderLedger/${o.id}`), null);
});

test('enforce: only the order total changed (item price correct) -> 422, nothing written', async () => {
  const before = snapshot();
  commits = []; sends = []; // count only what happens from here on
  for (const total of [0.5, 3.45, 0, 35]) {
    const r = await create('enforce', order([line('p-simple', 1)], { patch: { total } }));
    assert.equal(r.status, 422, `total ${total}`);
    assert.deepEqual(r.body.problems, ['total']);
  }
  // within the tolerance (±0.01, as before) is accepted
  assert.equal((await create('enforce', order([line('p-simple', 1)], { patch: { total: 3.505 } }))).status, 200);
  assert.equal(commits.length >= 1, true);
  assert.notEqual(snapshot(), before);
});

test('enforce: missing numbers are never trusted (no subtotal / discount / shipping / item price) -> 422', async () => {
  const before = snapshot();
  commits = []; sends = []; // count only what happens from here on
  for (const k of ['subtotal', 'discountAmount', 'shippingCost']) {
    const o = order([line('p-simple', 1)]);
    delete o[k];
    const r = await create('enforce', o);
    assert.equal(r.status, 422, k);
    assert.ok(r.body.problems.includes(`missing:${k}`), r.body.problems);
  }
  const noPrice = order([line('p-simple', 1)]);
  delete noPrice.items[0].price;
  assert.ok((await create('enforce', noPrice)).body.problems.includes('missing:items[0].price'));
  assertNothingHappened(before, 'missing numbers');
});

// ------------------------------------------------------------------ variants
test('enforce: variants are priced from the chosen variant (var_blue 3.50, var_red 3.00), not from the product or the browser', async () => {
  const before = snapshot();
  commits = []; sends = []; // count only what happens from here on
  // blue costs 3.50: claiming the red price 3.00 is refused
  const cheat = order([line('p-variants', 1, { variantId: 'var_blue', price: 3 })]);
  const r = await create('enforce', cheat);
  assert.equal(r.status, 422);
  assert.ok(r.body.problems.includes('items[0].price'));
  assert.equal(r.body.serverPricing.lines[0].unitPrice, 3.5);
  // a variant that does not exist / no variant chosen on a variant product: price unknowable -> refused
  const ghost = order([{ ...line('p-variants', 1, { price: 3 }), selectedVariant: { ...variantSnapshot('p-variants', 'var_red'), id: 'var_ghost' } }]);
  assert.ok((await create('enforce', ghost)).body.problems.some((p) => p.startsWith('VARIANT_NOT_FOUND')));
  const none = order([line('p-variants', 1, { price: 3 })]);
  assert.ok((await create('enforce', none)).body.problems.some((p) => p.startsWith('AMBIGUOUS_VARIANT')));
  assertNothingHappened(before, 'variants');
  // the correct blue price is accepted and only the blue variant's stock moves
  const ok = await create('enforce', order([line('p-variants', 1, { variantId: 'var_blue', price: 3.5 })], { patch: {} }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const v = read('products/p-variants').variants;
  assert.deepEqual(v.map((x) => [x.id, x.stock]), [['var_red', 5], ['var_blue', 0]]);
});

// ------------------------------------------------------------------ discount
test('enforce: 10% volume discount above 2 pieces (server rule) — correct passes, missing/inflated discount refused', async () => {
  const good = order([line('p-hundred', 3)]); // 3 x 1.00 = 3.00, -0.30, +1.00 = 3.70
  assert.deepEqual([good.subtotal, good.discountAmount, good.total], [3, 0.3, 3.7]);
  assert.equal((await create('enforce', good)).status, 200);
  const before = snapshot();
  commits = []; sends = []; // count only what happens from here on
  const noDiscount = order([line('p-hundred', 3)], { patch: { discountAmount: 0, total: 4 } });
  assert.deepEqual((await create('enforce', noDiscount)).body.problems.sort(), ['discountAmount', 'total']);
  const bigDiscount = order([line('p-hundred', 3)], { patch: { discountAmount: 2, total: 2 } });
  assert.deepEqual((await create('enforce', bigDiscount)).body.problems.sort(), ['discountAmount', 'total']);
  // exactly 2 pieces: no discount allowed
  const two = order([line('p-hundred', 2)], { patch: { discountAmount: 0.2, total: 2.8 } });
  assert.deepEqual((await create('enforce', two)).body.problems.sort(), ['discountAmount', 'total']);
  assertNothingHappened(before, 'discount');
});

// ------------------------------------------------------------------ shipping
test('enforce: delivery fee from the server rules (area, fast, outside Amman) — a wrong fee is refused', async () => {
  const cases = [
    [{ citySlug: 'amman', ammanAreaId: 'a9' }, 'standard', 2.5],
    [{ citySlug: 'amman', ammanAreaId: 'a1' }, 'fast', 2.0],
    [{ citySlug: 'irbid', ammanAreaId: '' }, 'standard', 3.0],
  ];
  for (const [meta, method, fee] of cases) {
    assert.equal((await create('enforce', order([line('p-simple', 1)], { meta, method, shipping: fee }))).status, 200, `${meta.citySlug}/${meta.ammanAreaId}/${method}`);
  }
  const before = snapshot();
  commits = []; sends = []; // count only what happens from here on
  for (const [meta, method, fee] of cases) {
    const r = await create('enforce', order([line('p-simple', 1)], { meta, method, shipping: 1 }));
    assert.equal(r.status, 422);
    assert.deepEqual(r.body.problems.sort(), ['shippingCost', 'total'], `${meta.citySlug}: ${fee} expected`);
  }
  // unknown area: the server cannot price the delivery -> refused
  const unknown = await create('enforce', order([line('p-simple', 1)], { meta: { citySlug: 'amman', ammanAreaId: 'zz' } }));
  assert.ok(unknown.body.problems.includes('incomplete'));
  assertNothingHappened(before, 'shipping');
});

test('enforce: a refused order can be corrected and sent again with the same number (nothing was reserved)', async () => {
  const o = order([line('p-simple', 1, { price: 0.5 })]);
  assert.equal((await create('enforce', o)).status, 422);
  const fixed = { ...order([line('p-simple', 1)]), id: o.id };
  const r = await create('enforce', fixed);
  assert.equal(r.status, 200);
  assert.equal(r.body.replay, false);
  assert.equal(read('products/p-simple').stock, 9);
});

// ------------------------------------------------------------------ log mode: exactly as before
test('log (default and explicit): a tampered order is still SAVED with a PRICE_MISMATCH warning, stock applied, notified', async () => {
  for (const mode of [undefined, 'log']) {
    commits = []; sends = [];
    const o = order([line('p-simple', 1, { price: 0.5 })]);
    const r = await create(mode, o);
    assert.equal(r.status, 200, `${mode}: ${JSON.stringify(r.body)}`);
    const l = read(`orderLedger/${o.id}`);
    assert.equal(l.priceMismatch, true);
    assert.ok(l.warnings.some((w) => w.code === 'PRICE_MISMATCH'));
    assert.equal(read(`orders/${o.id}`).total, o.total, 'order keeps the client total (unchanged log behaviour)');
    assert.equal(read(`orders/${o.id}`).items[0].price, 0.5);
    assert.equal(l.stockDeductions[0].applied, true);
    assert.deepEqual(sends.sort(), ['email', 'telegram']);
  }
  assert.equal(read('products/p-simple').stock, 8);
});

// ------------------------------------------------------------------ the pure rule
test('enforcePriceProblems: pure checks (server pricing vs every client number)', () => {
  const lines = [{ index: 0, serverUnitPrice: 2.5, quantity: 1 }];
  const server = computeServerPricing(lines, { citySlug: 'amman', ammanAreaId: 'a1' }, 'standard');
  const client = { subtotal: 2.5, discountAmount: 0, shippingCost: 1, total: 3.5 };
  assert.deepEqual(enforcePriceProblems(server, client, lines, [{ clientUnitPrice: 2.5 }]), []);
  assert.deepEqual(enforcePriceProblems(server, client, lines, [{ clientUnitPrice: 2.51 }]), [], 'within ±0.01');
  assert.deepEqual(enforcePriceProblems(server, client, lines, [{ clientUnitPrice: 2.52 }]), ['items[0].price']);
  assert.deepEqual(enforcePriceProblems(server, client, lines, [{ clientUnitPrice: 2.5 }], [{ code: 'PRODUCT_NOT_FOUND', line: 0 }]), ['PRODUCT_NOT_FOUND:items[0]']);
  assert.deepEqual(enforcePriceProblems(server, client, lines, [{ clientUnitPrice: 2.5 }], [{ code: 'STOCK_SHORTFALL', line: 0 }]), [], 'stock warnings are not price problems');
});
