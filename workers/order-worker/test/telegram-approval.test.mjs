// Telegram order approval + atomic stock — LOCAL ONLY: the real Worker (src/index.js), the Firestore EMULATOR
// (demo- project) and a mock Telegram / SendGrid on 127.0.0.1. Synthetic fixture products only.
//   firebase emulators:exec --only firestore --project demo-dairsharaf-orders --config test/firebase.json \
//     "node --test --test-concurrency=1 test/telegram-approval.test.mjs"
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startMockServices, makeEnv, callWorker, createOrderReq, clearDb, seedProducts, putDoc, getDecoded, count,
  productStock, variantStock,
} from './helpers.mjs';
import { checkoutOrder, line, makeOrderId } from './fixtures.mjs';

const SECRET = 'whsec_' + 'A1b2C3d4'.repeat(5);
const BOT = 'test-bot-token';
const CHAT = '-1001234567890';
const ADMIN = '111111111';
const ADMIN2 = '222222222';
const STRANGER = '999999999';
let mock;
const env = (o = {}) => makeEnv(mock.url, {
  APPROVAL_MODE: 'telegram', STOCK_MODE: 'apply', TELEGRAM_CHAT_ID: CHAT, TELEGRAM_BOT_TOKEN: BOT,
  TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_ADMIN_USER_IDS: `${ADMIN},${ADMIN2}`, ...o,
});
const logs = [];
const origLog = console.log;

before(async () => { mock = await startMockServices(); console.log = (...a) => { logs.push(a.join(' ')); }; });
after(async () => { console.log = origLog; await mock?.close(); });
beforeEach(async () => { mock.reset(); await clearDb(); await seedProducts(); });

let upd = 1;
/** a Telegram callback_query update, as Telegram delivers it to the webhook */
function press(e, { orderId, op, from = ADMIN, chat = CHAT, messageId = 1, secret = SECRET, data } = {}) {
  return callWorker(e, {
    method: 'POST', path: '/telegram/webhook',
    headers: secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret },
    body: { update_id: upd++, callback_query: { id: `cq-${upd}`, from: { id: Number(from), is_bot: false }, message: { message_id: messageId, chat: { id: Number(chat) } }, data: data ?? `v1:${op}:${orderId}` } },
  });
}
async function newOrder(items, e = env()) {
  const o = checkoutOrder({ id: makeOrderId(), items });
  const r = await createOrderReq(e, o);
  assert.equal(r.status, 200, r.text);
  return o;
}
const ledger = (id) => getDecoded(`orderLedger/${id}`);
const order = (id) => getDecoded(`orders/${id}`);
const lastAnswer = () => [...mock.state.tgUi].reverse().find((c) => c.method === 'answerCallbackQuery')?.body?.text || '';

// 1 ---------------------------------------------------------------------------------------------------------------
test('1. order creation does NOT deduct stock; order new + approval pending; ONE Telegram message with the two buttons', async () => {
  const o = await newOrder([line('p-simple', 3)]);
  assert.equal(await productStock('p-simple'), 10, 'stock untouched at creation');
  const O = await order(o.id);
  assert.equal(O.status, 'new');
  assert.deepEqual(O.approval, { policy: 'telegram', state: 'pending' });
  const L = await ledger(o.id);
  assert.equal(L.stockPolicy, 'on_approval');
  assert.equal(L.decision, 'pending');
  assert.deepEqual(L.approvalLines.map((l) => [l.productId, l.quantity, l.unitPrice]), [['p-simple', 3, 2.5]]);
  assert.ok(L.stockDeductions.every((d) => d.applied === false));
  const tg = mock.state.calls.filter((c) => c.channel === 'telegram');
  assert.equal(tg.length, 1, 'one message');
  const kb = tg[0].body.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepEqual(kb, [`v1:acc:${o.id}`, `v1:rej:${o.id}`]);
  assert.match(tg[0].body.text, /بانتظار الموافقة/);
  assert.ok(Number.isInteger(L.notifications.telegram.messageId), 'message id stored for later edits');
  assert.ok(!tg[0].body.text.includes(o.customerEmail), 'no e-mail in the Telegram message');
});

// 2, 3 ------------------------------------------------------------------------------------------------------------
test('2. accept: stock deducted once, status processing, who/when recorded, message updated (cancel button)', async () => {
  const o = await newOrder([line('p-simple', 3)]);
  const r = await press(env(), { orderId: o.id, op: 'acc' });
  assert.equal(r.status, 200);
  assert.equal(await productStock('p-simple'), 7);
  const O = await order(o.id);
  assert.equal(O.status, 'processing');
  assert.equal(O.approval.state, 'accepted');
  assert.equal(O.approval.decidedBy.userId, ADMIN);
  assert.ok(O.approval.decidedAt instanceof Date);
  const L = await ledger(o.id);
  assert.equal(L.decision, 'accepted');
  assert.equal(L.stockDeductions.filter((d) => d.applied).length, 1);
  const edit = mock.state.tgUi.find((c) => c.method === 'editMessageText');
  assert.match(edit.body.text, /تم قبول الطلب/);
  assert.deepEqual(edit.body.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), [`v1:can:${o.id}`]);
  assert.match(lastAnswer(), /تم قبول الطلب/);
});

test('3. reject: no stock change, status cancelled, buttons removed', async () => {
  const o = await newOrder([line('p-simple', 3)]);
  await press(env(), { orderId: o.id, op: 'rej', from: ADMIN2 });
  assert.equal(await productStock('p-simple'), 10);
  const O = await order(o.id);
  assert.equal(O.status, 'cancelled');
  assert.equal(O.approval.state, 'rejected');
  assert.equal(O.approval.decidedBy.userId, ADMIN2);
  assert.deepEqual(mock.state.tgUi.find((c) => c.method === 'editMessageText').body.reply_markup.inline_keyboard, []);
});

// 4, 10, 19 -------------------------------------------------------------------------------------------------------
test('4/10/19. accept twice, the SAME update re-delivered, and a reject after accept: stock 10 -> 7, never 4', async () => {
  const o = await newOrder([line('p-simple', 3)]);
  await press(env(), { orderId: o.id, op: 'acc' });
  await press(env(), { orderId: o.id, op: 'acc' });
  assert.match(lastAnswer(), /مقبول مسبقًا/);
  const again = { method: 'POST', path: '/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': SECRET }, body: { update_id: 77, callback_query: { id: 'same', from: { id: Number(ADMIN) }, message: { message_id: 1, chat: { id: Number(CHAT) } }, data: `v1:acc:${o.id}` } } };
  await callWorker(env(), again);
  await callWorker(env(), again);
  await press(env(), { orderId: o.id, op: 'rej' });
  assert.equal(await productStock('p-simple'), 7);
  assert.equal((await order(o.id)).status, 'processing');
});

// 5 ---------------------------------------------------------------------------------------------------------------
test('5. accept and reject AT THE SAME TIME: exactly one decision wins; stock matches it', async () => {
  for (let i = 0; i < 4; i++) {
    await seedProducts();
    const o = await newOrder([line('p-simple', 2)]);
    await Promise.all([press(env(), { orderId: o.id, op: 'acc' }), press(env(), { orderId: o.id, op: 'rej', from: ADMIN2 }), press(env(), { orderId: o.id, op: 'acc', from: ADMIN2 })]);
    const L = await ledger(o.id);
    assert.ok(['accepted', 'rejected'].includes(L.decision));
    assert.equal(await productStock('p-simple'), L.decision === 'accepted' ? 8 : 10, `round ${i}: ${L.decision}`);
    assert.equal((await order(o.id)).status, L.decision === 'accepted' ? 'processing' : 'cancelled');
  }
});

// 6, 7, 8 ---------------------------------------------------------------------------------------------------------
test('6. several products in one order: all deducted together', async () => {
  const o = await newOrder([line('p-simple', 2), line('p-hundred', 5), line('p-simple', 1)]);
  await press(env(), { orderId: o.id, op: 'acc' });
  assert.equal(await productStock('p-simple'), 7, 'same product on two lines: 2 + 1');
  assert.equal(await productStock('p-hundred'), 95);
});

test('7. variants: only the chosen variant is deducted (top-level stock of a variant product untouched)', async () => {
  const o = await newOrder([line('p-variants', 2, { variantId: 'var_red' }), line('p-variants', 1, { variantId: 'var_red' })]);
  await press(env(), { orderId: o.id, op: 'acc' });
  assert.equal(await variantStock('p-variants', 'var_red'), 2, '5 - 3');
  assert.equal(await variantStock('p-variants', 'var_blue'), 1);
  assert.equal(await productStock('p-variants'), 0, 'top-level manual number unchanged');
});

test('8. one product short inside a multi-product order: NOTHING deducted, order stays pending, reason shown', async () => {
  const o = await newOrder([line('p-simple', 2), line('p-last-one', 2)]);
  await press(env(), { orderId: o.id, op: 'acc' });
  assert.equal(await productStock('p-simple'), 10);
  assert.equal(await productStock('p-last-one'), 1);
  assert.equal((await order(o.id)).status, 'new');
  assert.equal((await ledger(o.id)).decision, 'pending');
  assert.match(lastAnswer(), /لا يمكن القبول.*STOCK_SHORTFALL/);
});

// 9 ---------------------------------------------------------------------------------------------------------------
test('9. two orders accepted AT THE SAME TIME on the last piece: one accepted, the other refused, stock never negative', async () => {
  const a = await newOrder([line('p-last-one', 1)]);
  const b = await newOrder([line('p-last-one', 1)]);
  assert.equal(await productStock('p-last-one'), 1, 'creation took nothing');
  await Promise.all([press(env(), { orderId: a.id, op: 'acc' }), press(env(), { orderId: b.id, op: 'acc', from: ADMIN2 })]);
  const d = [(await ledger(a.id)).decision, (await ledger(b.id)).decision].sort();
  assert.deepEqual(d, ['accepted', 'pending']);
  assert.equal(await productStock('p-last-one'), 0);
});

// 11, 12 ----------------------------------------------------------------------------------------------------------
test('11. unauthenticated webhook calls (no / wrong secret, GET): 401/405, nothing read or changed', async () => {
  const o = await newOrder([line('p-simple', 1)]);
  mock.reset();
  for (const secret of [null, 'wrong', SECRET.slice(0, -1), `${SECRET}x`]) {
    assert.equal((await press(env(), { orderId: o.id, op: 'acc', secret })).status, 401);
  }
  assert.equal((await callWorker(env(), { method: 'GET', path: '/telegram/webhook' })).status, 405);
  assert.equal(await productStock('p-simple'), 10);
  assert.equal(mock.state.tgUi.length, 0, 'not even an answer');
  // approval off: the route does not exist
  assert.equal((await press(env({ APPROVAL_MODE: 'off' }), { orderId: o.id, op: 'acc' })).status, 404);
});

test('12. a button pressed by a non-admin, or in another chat: refused, nothing changed', async () => {
  const o = await newOrder([line('p-simple', 1)]);
  await press(env(), { orderId: o.id, op: 'acc', from: STRANGER });
  await press(env(), { orderId: o.id, op: 'acc', chat: '-100999' });
  assert.equal(await productStock('p-simple'), 10);
  assert.equal((await ledger(o.id)).decision, 'pending');
  assert.match(lastAnswer(), /غير مصرح/);
  // tampered / unknown callback data
  for (const data of [`v1:acc:${o.id}x`, `v2:acc:${o.id}`, `v1:del:${o.id}`, 'v1:acc:../products/p-simple', '', `v1:acc:${o.id}\nv1:acc:x`]) await press(env(), { data });
  assert.equal((await ledger(o.id)).decision, 'pending');
});

// 13, 14 ----------------------------------------------------------------------------------------------------------
test('13. Firestore unavailable during the decision: nothing changes, the admin is told to retry', async () => {
  const o = await newOrder([line('p-simple', 1)]);
  await press(env({ FIRESTORE_BASE_URL: 'http://127.0.0.1:1/v1' }), { orderId: o.id, op: 'acc' });
  assert.match(lastAnswer(), /تعذّر تنفيذ العملية/);
  assert.equal((await ledger(o.id)).decision, 'pending');
  assert.equal(await productStock('p-simple'), 10);
});

test('14. Telegram API failing AFTER the commit: data stays correct; a second press never deducts again', async () => {
  const o = await newOrder([line('p-simple', 4)]);
  mock.state.tgUiFail = true;
  assert.equal((await press(env(), { orderId: o.id, op: 'acc' })).status, 200);
  assert.equal(await productStock('p-simple'), 6);
  assert.equal((await order(o.id)).status, 'processing');
  mock.state.tgUiFail = false;
  await press(env(), { orderId: o.id, op: 'acc' });
  assert.equal(await productStock('p-simple'), 6);
  assert.match(mock.state.tgUi.filter((c) => c.method === 'editMessageText').at(-1).body.text, /تم قبول الطلب/, 'the press repairs the message');
});

// 15 ---------------------------------------------------------------------------------------------------------------
test('15. legacy orders are never deducted again: no ledger (browser / Worker v1) or stock taken at creation', async () => {
  // a) browser / v1 order: no ledger
  await putDoc('orders/ORD-LEGACY01-AAAA', { id: 'ORD-LEGACY01-AAAA', status: 'new', items: [{ productId: 'p-simple', quantity: 2 }], userId: 'guest' });
  await press(env(), { orderId: 'ORD-LEGACY01-AAAA', op: 'acc' });
  assert.match(lastAnswer(), /طلب قديم/);
  for (const op of ['can', 'bck', 'cfc']) {
    await press(env(), { orderId: 'ORD-LEGACY01-AAAA', op });
    assert.match(lastAnswer(), /طلب قديم/, `${op} on a legacy order (no ledger) is answered as legacy, not "not found"`);
  }
  assert.equal(await productStock('p-simple'), 10);
  assert.equal((await getDecoded('orders/ORD-LEGACY01-AAAA')).status, 'new');
  // b) Worker v2 order created BEFORE approval mode (stock taken at creation)
  const o = await newOrder([line('p-simple', 2)], env({ APPROVAL_MODE: 'off' }));
  assert.equal(await productStock('p-simple'), 8, 'old policy: deducted at creation');
  assert.equal((await ledger(o.id)).stockPolicy, 'on_creation');
  await press(env(), { orderId: o.id, op: 'acc' });
  await press(env(), { orderId: o.id, op: 'can' });
  await press(env(), { orderId: o.id, op: 'cfc' });
  assert.equal(await productStock('p-simple'), 8, 'never deducted or restored by the approval flow');
  // c) ledger without stockPolicy (written before the field existed) = legacy
  await putDoc('orderLedger/ORD-LEGACY02-BBBB', { orderId: 'ORD-LEGACY02-BBBB', stockDeductions: [] });
  await putDoc('orders/ORD-LEGACY02-BBBB', { id: 'ORD-LEGACY02-BBBB', status: 'new' });
  await press(env(), { orderId: 'ORD-LEGACY02-BBBB', op: 'acc' });
  assert.equal((await getDecoded('orders/ORD-LEGACY02-BBBB')).status, 'new');
});

// 17 ---------------------------------------------------------------------------------------------------------------
test('17. cancel after acceptance: two-step confirm, stock returned ONCE; cancel of a pending order refused', async () => {
  const o = await newOrder([line('p-simple', 3), line('p-variants', 1, { variantId: 'var_blue' })]);
  await press(env(), { orderId: o.id, op: 'can' });
  assert.match(lastAnswer(), /اضغط|لم يُقبل/);
  await press(env(), { orderId: o.id, op: 'cfc' });
  assert.match(lastAnswer(), /لم يُقبل بعد/);
  await press(env(), { orderId: o.id, op: 'acc' });
  assert.equal(await productStock('p-simple'), 7);
  assert.equal(await variantStock('p-variants', 'var_blue'), 0);
  await press(env(), { orderId: o.id, op: 'can' }); // only asks for confirmation
  assert.equal((await order(o.id)).status, 'processing');
  assert.deepEqual(mock.state.tgUi.filter((c) => c.method === 'editMessageReplyMarkup').at(-1).body.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), [`v1:cfc:${o.id}`, `v1:bck:${o.id}`]);
  await Promise.all([press(env(), { orderId: o.id, op: 'cfc' }), press(env(), { orderId: o.id, op: 'cfc', from: ADMIN2 })]);
  await press(env(), { orderId: o.id, op: 'cfc' });
  assert.equal(await productStock('p-simple'), 10, 'restored once');
  assert.equal(await variantStock('p-variants', 'var_blue'), 1, 'variant restored once');
  const O = await order(o.id);
  assert.equal(O.status, 'cancelled');
  assert.equal(O.approval.state, 'cancelled');
  assert.equal((await ledger(o.id)).stockRestored.length, 2);
});

// 18, 20 ----------------------------------------------------------------------------------------------------------
test('18. no secret in any webhook answer or log line (bot token, webhook secret)', async () => {
  const o = await newOrder([line('p-simple', 1)]);
  const r = [await press(env(), { orderId: o.id, op: 'acc' }), await press(env(), { orderId: o.id, op: 'acc', secret: 'bad' }), await press(env(), { orderId: o.id, op: 'acc', from: STRANGER })];
  const all = [...r.map((x) => x.text), ...logs].join('\n');
  assert.ok(!all.includes(SECRET) && !all.includes(BOT));
});

test('20. trusted prices: the Telegram message and the acceptance use SERVER prices, never the browser\'s', async () => {
  const o = checkoutOrder({ id: makeOrderId(), items: [line('p-simple', 2, { price: 0.5 })] }); // tampered price (log mode keeps it)
  assert.equal((await createOrderReq(env(), o)).status, 200);
  const tg = mock.state.calls.find((c) => c.channel === 'telegram').body.text;
  assert.match(tg, /2 × 2\.50/, 'server unit price');
  assert.ok(!/0\.50 د\.أ/.test(tg.split('🧾')[0]), 'client price not shown as the item price');
  assert.match(tg, /اختلاف بين سعر العميل وسعر النظام/);
  assert.equal((await ledger(o.id)).approvalLines[0].unitPrice, 2.5);
  // enforce: a tampered order is refused before anything (no message, no ledger)
  mock.reset();
  const e = await createOrderReq(env({ PRICE_CHECK_MODE: 'enforce' }), { ...o, id: makeOrderId() });
  assert.equal(e.status, 422);
  assert.equal(mock.state.calls.length, 0);
});

test('config: telegram approval refuses to start without its secret / admins / numeric chat / STOCK_MODE=apply', async () => {
  for (const o of [{ TELEGRAM_WEBHOOK_SECRET: '' }, { TELEGRAM_WEBHOOK_SECRET: 'short' }, { TELEGRAM_ADMIN_USER_IDS: '' }, { TELEGRAM_ADMIN_USER_IDS: '12,abc' }, { TELEGRAM_CHAT_ID: 'chat' }, { STOCK_MODE: 'log' }]) {
    const r = await callWorker(env(o), { path: '/' });
    assert.equal(r.status, 500, JSON.stringify(o));
    assert.equal(r.body.code, 'CONFIG_ERROR');
  }
  assert.equal(await count('orders'), 0);
});
