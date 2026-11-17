// STOCK_POLICY=on_delivery — LOCAL ONLY: the real Worker (src/index.js), the Firestore EMULATOR (demo- project),
// mock Telegram / SendGrid / JWKS on 127.0.0.1, TEST signing keys generated in memory. Synthetic fixture products only.
//   firebase emulators:exec --only firestore --project demo-dairsharaf-orders --config test/firebase.json \
//     "node --test --test-concurrency=1 test/stock-on-delivery.test.mjs"
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startMockServices, makeEnv, callWorker, createOrderReq, clearDb, seedProducts, putDoc, getDecoded,
  productStock, variantStock, PROJECT_ID,
} from './helpers.mjs';
import { checkoutOrder, line, makeOrderId } from './fixtures.mjs';
import { makeTestSigner } from './token-signer.mjs';

const OWNER = 'owner-uid-0001';
const ADMIN = 'admin-uid-0002';
const INACTIVE = 'admin-uid-0003';
const CUSTOMER = 'customer-uid-0004';
let mock;
let signer;
let forger;
const env = (o = {}) => makeEnv(mock.url, { STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', ...o });
const logs = [];
const origLog = console.log;

before(async () => {
  mock = await startMockServices();
  signer = await makeTestSigner('kid-delivery');
  forger = await makeTestSigner('kid-delivery');
  console.log = (...a) => { logs.push(a.join(' ')); };
});
after(async () => { console.log = origLog; await mock?.close(); });
beforeEach(async () => {
  mock.reset();
  mock.state.jwks = { keys: [signer.jwk] };
  await clearDb();
  await seedProducts();
  await putDoc('config/roles', { ownerUid: OWNER });
  await putDoc(`admins/${ADMIN}`, { active: true });
  await putDoc(`admins/${INACTIVE}`, { active: false });
});

const token = (uid = OWNER) => signer.idToken({ projectId: PROJECT_ID, uid });
async function setStatus(orderId, status, { uid = OWNER, confirmReturn, headers, e = env() } = {}) {
  const auth = headers ?? { authorization: `Bearer ${await token(uid)}` };
  return callWorker(e, { method: 'POST', path: `/admin/orders/${encodeURIComponent(orderId)}/status`, headers: { origin: 'https://dairsharaf.com', ...auth }, body: { status, ...(confirmReturn === undefined ? {} : { confirmReturn }) } });
}
async function newOrder(items, e = env()) {
  const o = checkoutOrder({ id: makeOrderId(), items });
  const r = await createOrderReq(e, o);
  assert.equal(r.status, 200, r.text);
  return o;
}
const ledger = (id) => getDecoded(`orderLedger/${id}`);
const order = (id) => getDecoded(`orders/${id}`);
async function reserved(productId, variantId = null) {
  const r = await getDecoded(`stockReservations/${productId}`);
  if (!r) return 0;
  return (variantId ? r.variants?.[variantId] : r.product) || 0;
}

// D1 ---------------------------------------------------------------------------------------------------------------
test('D1. creation: accepted automatically (new), NOTHING deducted, quantity reserved, Telegram message WITHOUT buttons', async () => {
  const o = await newOrder([line('p-simple', 3)]);
  assert.equal(await productStock('p-simple'), 10, 'physical stock untouched');
  assert.equal(await reserved('p-simple'), 3);
  const O = await order(o.id);
  assert.equal(O.status, 'new');
  assert.deepEqual(O.inventory, { policy: 'on_delivery', state: 'reserved' });
  assert.equal(O.approval, undefined, 'no Telegram approval');
  const L = await ledger(o.id);
  assert.equal(L.stockPolicy, 'on_delivery');
  assert.equal(L.inventory, 'reserved');
  assert.deepEqual(L.reservations, [{ productId: 'p-simple', variantId: null, qty: 3 }]);
  assert.ok(L.stockDeductions.every((d) => d.applied === false && d.skippedReason === 'AWAITING_DELIVERY'));
  const tg = mock.state.calls.filter((c) => c.channel === 'telegram');
  assert.equal(tg.length, 1);
  assert.equal(tg[0].body.reply_markup, undefined, 'no buttons');
  assert.match(tg[0].body.text, /قبوله تلقائيًا/);
  assert.match(tg[0].body.text, /2\.50/, 'server prices');
  assert.ok(!tg[0].body.text.includes(o.customerEmail));
  assert.equal(mock.sent('email'), 1, 'admin e-mail unchanged');
  // the Telegram webhook does not exist in this mode
  const wh = await callWorker(env(), { method: 'POST', path: '/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': 'x'.repeat(40) }, body: { update_id: 1 } });
  assert.equal(wh.status, 404);
});

// D2, D3 -----------------------------------------------------------------------------------------------------------
test('D2/D3. processing and shipped never touch stock; delivered deducts ONCE and releases the reservation', async () => {
  const o = await newOrder([line('p-simple', 3)]);
  for (const s of ['processing', 'shipped']) {
    const r = await setStatus(o.id, s);
    assert.equal(r.status, 200, r.text);
    assert.equal(await productStock('p-simple'), 10, s);
    assert.equal(await reserved('p-simple'), 3, s);
  }
  const d = await setStatus(o.id, 'delivered', { uid: ADMIN });
  assert.equal(d.status, 200, d.text);
  assert.equal(d.body.inventory, 'deducted');
  assert.equal(await productStock('p-simple'), 7);
  assert.equal(await reserved('p-simple'), 0);
  const O = await order(o.id);
  assert.equal(O.status, 'delivered');
  assert.equal(O.seenByAdmin, true);
  assert.deepEqual(O.inventory, { policy: 'on_delivery', state: 'deducted' });
  const L = await ledger(o.id);
  assert.equal(L.deliveredBy.uid, ADMIN);
  assert.deepEqual(L.statusHistory.map((h) => h.to), ['processing', 'shipped', 'delivered']);
  // repeated update
  const again = await setStatus(o.id, 'delivered');
  assert.equal(again.body.result, 'unchanged');
  assert.equal(await productStock('p-simple'), 7);
});

test('D3b. delivered pressed many times AT THE SAME TIME (two tabs, double click): deducted exactly once', async () => {
  for (let i = 0; i < 3; i++) {
    await seedProducts();
    const o = await newOrder([line('p-simple', 2), line('p-variants', 1, { variantId: 'var_red' })]);
    const rs = await Promise.all([setStatus(o.id, 'delivered'), setStatus(o.id, 'delivered', { uid: ADMIN }), setStatus(o.id, 'delivered')]);
    assert.ok(rs.every((r) => r.status === 200), rs.map((r) => r.text).join(' | '));
    assert.equal(rs.filter((r) => r.body.result === 'changed').length, 1);
    assert.equal(await productStock('p-simple'), 8, `round ${i}`);
    assert.equal(await variantStock('p-variants', 'var_red'), 4, `round ${i}`);
    assert.equal(await reserved('p-simple'), 0);
  }
});

// D4 ---------------------------------------------------------------------------------------------------------------
test('D4. cancel before delivery: reservation released, stock untouched; cancelled is final', async () => {
  const o = await newOrder([line('p-simple', 4)]);
  await setStatus(o.id, 'processing');
  const c = await setStatus(o.id, 'cancelled');
  assert.equal(c.status, 200);
  assert.equal(c.body.inventory, 'released');
  assert.equal(await productStock('p-simple'), 10);
  assert.equal(await reserved('p-simple'), 0);
  assert.equal((await setStatus(o.id, 'cancelled')).body.result, 'unchanged');
  for (const s of ['delivered', 'new', 'processing']) {
    const r = await setStatus(o.id, s);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'TRANSITION_NOT_ALLOWED');
  }
  assert.equal(await productStock('p-simple'), 10);
  assert.equal(await reserved('p-simple'), 0);
});

// D5 ---------------------------------------------------------------------------------------------------------------
test('D5. return after delivery: only with an explicit confirmation, stock put back ONCE (also when pressed concurrently)', async () => {
  const o = await newOrder([line('p-simple', 3), line('p-variants', 1, { variantId: 'var_blue' })]);
  await setStatus(o.id, 'delivered');
  assert.equal(await productStock('p-simple'), 7);
  assert.equal(await variantStock('p-variants', 'var_blue'), 0);
  for (const confirmReturn of [undefined, false, 'yes']) {
    const r = await setStatus(o.id, 'cancelled', { confirmReturn });
    assert.equal(r.status, 409, String(confirmReturn));
    assert.equal(r.body.code, 'RETURN_CONFIRMATION_REQUIRED');
  }
  assert.equal((await setStatus(o.id, 'shipped')).body.code, 'TRANSITION_NOT_ALLOWED', 'delivered never goes back silently');
  assert.equal(await productStock('p-simple'), 7, 'nothing returned without confirmation');
  const rs = await Promise.all([setStatus(o.id, 'cancelled', { confirmReturn: true }), setStatus(o.id, 'cancelled', { confirmReturn: true, uid: ADMIN })]);
  assert.equal(rs.filter((r) => r.body.result === 'changed').length, 1);
  await setStatus(o.id, 'cancelled', { confirmReturn: true });
  assert.equal(await productStock('p-simple'), 10, 'returned once');
  assert.equal(await variantStock('p-variants', 'var_blue'), 1, 'variant returned once');
  const L = await ledger(o.id);
  assert.equal(L.inventory, 'restocked');
  assert.equal(L.stockRestored.length, 2);
  assert.deepEqual((await order(o.id)).inventory, { policy: 'on_delivery', state: 'restocked' });
});

// D6 ---------------------------------------------------------------------------------------------------------------
test('D6. the last piece ordered by two customers AT THE SAME TIME: one order, the other refused OUT_OF_STOCK; stock never moves', async () => {
  for (let i = 0; i < 3; i++) {
    await clearDb();
    await seedProducts();
    const a = checkoutOrder({ id: makeOrderId(), items: [line('p-last-one', 1)] });
    const b = checkoutOrder({ id: makeOrderId(), items: [line('p-last-one', 1)], overrides: { address: { fullName: 'Other', city: 'عمّان (العاصمة) - النزهة', street: 'شارع 2', phone: '+962791111111' } } });
    const [ra, rb] = await Promise.all([createOrderReq(env(), a), createOrderReq(env(), b)]);
    const st = [ra.status, rb.status].sort();
    assert.deepEqual(st, [200, 422], `round ${i}: ${ra.text} | ${rb.text}`);
    const lost = ra.status === 422 ? ra : rb;
    assert.equal(lost.body.code, 'OUT_OF_STOCK');
    assert.deepEqual(lost.body.lines, [{ index: 0, available: 0 }]);
    assert.equal(await productStock('p-last-one'), 1, 'physical stock unchanged');
    assert.equal(await reserved('p-last-one'), 1);
    const lostId = ra.status === 422 ? a.id : b.id;
    assert.equal(await order(lostId), null, 'refused order not saved');
    assert.equal(await ledger(lostId), null);
  }
});

test('D6b. after the winner is cancelled the piece is available again; a refused order saves and notifies nothing', async () => {
  const a = await newOrder([line('p-last-one', 1)]);
  mock.reset();
  const b = checkoutOrder({ id: makeOrderId(), items: [line('p-last-one', 1)] });
  assert.equal((await createOrderReq(env(), b)).status, 422);
  assert.equal(mock.state.calls.filter((c) => c.channel !== 'turnstile').length, 0, 'no notification for a refused order');
  await setStatus(a.id, 'cancelled');
  const c = checkoutOrder({ id: makeOrderId(), items: [line('p-last-one', 1)] });
  assert.equal((await createOrderReq(env(), c)).status, 200);
  assert.equal(await reserved('p-last-one'), 1);
  await setStatus(c.id, 'delivered');
  assert.equal(await productStock('p-last-one'), 0);
  assert.equal(await reserved('p-last-one'), 0);
  assert.equal((await createOrderReq(env(), checkoutOrder({ id: makeOrderId(), items: [line('p-last-one', 1)] }))).status, 422, 'sold out');
});

test('D6c. multi-line order with one short line: whole order refused, nothing reserved', async () => {
  await newOrder([line('p-variants', 1, { variantId: 'var_blue' })]);
  const o = checkoutOrder({ id: makeOrderId(), items: [line('p-simple', 2), line('p-variants', 1, { variantId: 'var_blue' })] });
  const r = await createOrderReq(env(), o);
  assert.equal(r.status, 422);
  assert.deepEqual(r.body.lines, [{ index: 1, available: 0 }]);
  assert.equal(await reserved('p-simple'), 0);
  assert.equal(await reserved('p-variants', 'var_blue'), 1);
});

// D7 ---------------------------------------------------------------------------------------------------------------
test('D7. a resent identical order (same number) reserves once', async () => {
  const o = checkoutOrder({ id: makeOrderId(), items: [line('p-simple', 2)] });
  assert.equal((await createOrderReq(env(), o)).status, 200);
  const r2 = await createOrderReq(env(), o);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.replay, true);
  assert.equal(await reserved('p-simple'), 2);
});

// D8 ---------------------------------------------------------------------------------------------------------------
test('D8. stock lowered by hand below the ordered quantity: delivery refused with a clear code, nothing written', async () => {
  const o = await newOrder([line('p-simple', 3)]);
  await putDoc('products/p-simple', { name: 'دفتر', price: 2.5, stock: 2, category: 'Stationery' });
  const r = await setStatus(o.id, 'delivered');
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'INSUFFICIENT_STOCK');
  assert.deepEqual(r.body.problems, [{ index: 0, productId: 'p-simple', available: 2, requested: 3 }]);
  assert.equal(await productStock('p-simple'), 2);
  assert.equal((await order(o.id)).status, 'new');
  assert.equal(await reserved('p-simple'), 3);
  await putDoc('products/p-simple', { name: 'دفتر', price: 2.5, stock: 5, category: 'Stationery' });
  assert.equal((await setStatus(o.id, 'delivered')).status, 200);
  assert.equal(await productStock('p-simple'), 2);
});

// D9 ---------------------------------------------------------------------------------------------------------------
test('D9. legacy orders (no ledger / v1, on_creation, on_approval) are refused here and never touch stock', async () => {
  await putDoc('orders/ORD-LEGACY01-AAAA', { id: 'ORD-LEGACY01-AAAA', status: 'new', items: [{ productId: 'p-simple', quantity: 2 }], userId: 'guest' });
  const old = await newOrder([line('p-simple', 2)], env({ STOCK_POLICY: 'on_creation' }));
  assert.equal(await productStock('p-simple'), 8, 'old policy deducted at creation');
  await putDoc('orderLedger/ORD-LEGACY02-BBBB', { orderId: 'ORD-LEGACY02-BBBB', stockPolicy: 'on_approval', decision: 'pending' });
  await putDoc('orders/ORD-LEGACY02-BBBB', { id: 'ORD-LEGACY02-BBBB', status: 'new' });
  for (const id of ['ORD-LEGACY01-AAAA', old.id, 'ORD-LEGACY02-BBBB']) {
    for (const s of ['delivered', 'cancelled']) {
      const r = await setStatus(id, s, { confirmReturn: true });
      assert.equal(r.status, 409, `${id} ${s}`);
      assert.equal(r.body.code, 'LEGACY_ORDER');
    }
  }
  assert.equal(await productStock('p-simple'), 8);
  assert.equal((await getDecoded('orders/ORD-LEGACY01-AAAA')).status, 'new');
  assert.equal((await setStatus('ORD-NOTHERE1-CCCC', 'delivered')).status, 404);
});

// D10 --------------------------------------------------------------------------------------------------------------
test('D10. only a VERIFIED owner / active admin may change a status; every refusal writes nothing', async () => {
  const o = await newOrder([line('p-simple', 1)]);
  const cases = [
    ['no token', { headers: {} }, 401, 'AUTH_REQUIRED'],
    ['garbage', { headers: { authorization: 'Bearer abc.def.ghi' } }, 401, 'AUTH_INVALID'],
    ['not a bearer', { headers: { authorization: 'Basic xyz' } }, 401, 'AUTH_INVALID'],
    ['forged signature', { headers: { authorization: `Bearer ${await forger.idToken({ projectId: PROJECT_ID, uid: OWNER })}` } }, 401, 'AUTH_INVALID'],
    ['other project', { headers: { authorization: `Bearer ${await signer.idToken({ projectId: 'demo-other', uid: OWNER })}` } }, 401, 'AUTH_INVALID'],
    ['expired', { headers: { authorization: `Bearer ${await signer.idToken({ projectId: PROJECT_ID, uid: OWNER, nowSec: Math.floor(Date.now() / 1000) - 7200 })}` } }, 401, 'AUTH_EXPIRED'],
    ['customer', { uid: CUSTOMER }, 403, 'NOT_ADMIN'],
    ['inactive admin', { uid: INACTIVE }, 403, 'NOT_ADMIN'],
  ];
  for (const [name, opt, status, code] of cases) {
    const r = await setStatus(o.id, 'delivered', opt);
    assert.equal(r.status, status, name);
    assert.equal(r.body.code, code, name);
  }
  assert.equal((await order(o.id)).status, 'new');
  assert.equal(await productStock('p-simple'), 10);
  assert.equal((await callWorker(env(), { method: 'GET', path: `/admin/orders/${o.id}/status` })).status, 405);
  assert.equal((await setStatus(o.id, 'fraud')).body.code, 'INVALID_STATUS');
  assert.equal((await setStatus('../products/p-simple', 'delivered')).status, 400);
  // allowed
  assert.equal((await setStatus(o.id, 'processing', { uid: ADMIN })).status, 200);
  assert.equal((await setStatus(o.id, 'shipped', { uid: OWNER })).status, 200);
  // CORS: only the site
  const pre = await callWorker(env(), { method: 'OPTIONS', path: `/admin/orders/${o.id}/status`, headers: { origin: 'https://evil.example' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
});

// D11 --------------------------------------------------------------------------------------------------------------
test('D11. delivered and cancelled AT THE SAME TIME: exactly one wins and the stock matches it', async () => {
  for (let i = 0; i < 4; i++) {
    await seedProducts();
    await putDoc('stockReservations/p-simple', { productId: 'p-simple', product: 0, variants: {} });
    const o = await newOrder([line('p-simple', 2)]);
    await Promise.all([setStatus(o.id, 'delivered'), setStatus(o.id, 'cancelled'), setStatus(o.id, 'delivered')]);
    const O = await order(o.id);
    assert.ok(['delivered', 'cancelled'].includes(O.status));
    assert.equal(await productStock('p-simple'), O.status === 'delivered' ? 8 : 10, `round ${i}: ${O.status}`);
    assert.equal(await reserved('p-simple'), 0);
  }
});

// D12 --------------------------------------------------------------------------------------------------------------
test('D12. untracked / unknown lines: order accepted, nothing reserved or deducted for them', async () => {
  const o = await newOrder([line('p-no-stock', 5)]);
  assert.equal((await ledger(o.id)).inventory, 'none');
  const r = await setStatus(o.id, 'delivered');
  assert.equal(r.status, 200);
  assert.equal(r.body.inventory, 'deducted');
  assert.equal(await productStock('p-no-stock'), undefined);
});

// D13 --------------------------------------------------------------------------------------------------------------
test('D13. invariant over a mixed day: stock = start - delivered + returned; reserved = open orders', async () => {
  const start = await productStock('p-hundred');
  const orders = [];
  for (let i = 0; i < 8; i++) orders.push(await newOrder([line('p-hundred', i + 1)]));
  // 0,1,2 delivered; 3 delivered then returned; 4 cancelled; 5,6,7 stay open (new / processing / shipped)
  for (const i of [0, 1, 2, 3]) await setStatus(orders[i].id, 'delivered');
  await setStatus(orders[3].id, 'cancelled', { confirmReturn: true });
  await setStatus(orders[4].id, 'cancelled');
  await setStatus(orders[6].id, 'processing');
  await setStatus(orders[7].id, 'shipped');
  const delivered = 1 + 2 + 3 + 4;
  const returned = 4;
  assert.equal(await productStock('p-hundred'), start - delivered + returned);
  assert.equal(await reserved('p-hundred'), 6 + 7 + 8);
});

// D14 --------------------------------------------------------------------------------------------------------------
test('D14. Firestore unavailable during a status change: 5xx, nothing changed', async () => {
  const o = await newOrder([line('p-simple', 1)]);
  const r = await setStatus(o.id, 'delivered', { e: env({ FIRESTORE_BASE_URL: 'http://127.0.0.1:1/v1' }) });
  assert.ok(r.status >= 500, r.text);
  assert.equal((await order(o.id)).status, 'new');
  assert.equal(await productStock('p-simple'), 10);
});

test('D15. no secret or token in any answer or log line', async () => {
  const o = await newOrder([line('p-simple', 1)]);
  const t = await token();
  const r = await setStatus(o.id, 'delivered', { headers: { authorization: `Bearer ${t}` } });
  const all = [r.text, ...logs].join('\n');
  assert.ok(!all.includes(t) && !all.includes('test-bot-token'));
});

test('config: on_delivery refuses STOCK_MODE other than apply, and the combination with Telegram approval', async () => {
  for (const o of [{ STOCK_MODE: 'log' }, { STOCK_MODE: 'off' }, { APPROVAL_MODE: 'telegram', TELEGRAM_CHAT_ID: '-100123', TELEGRAM_WEBHOOK_SECRET: 'A'.repeat(40), TELEGRAM_ADMIN_USER_IDS: '1' }, { STOCK_POLICY: 'later' }]) {
    const r = await callWorker(env(o), { path: '/' });
    assert.equal(r.status, 500, JSON.stringify(o));
  }
});
