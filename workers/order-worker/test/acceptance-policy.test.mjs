// STOCK_POLICY=on_acceptance — LOCAL ONLY: the real Worker (src/index.js), the Firestore EMULATOR (demo- project), mock
// Telegram / Turnstile on 127.0.0.1, TEST signing keys. Synthetic products only; no real Telegram bot.
//   node <emu.mjs> . demo-dairsharaf-orders "node --test --test-concurrency=1 test/acceptance-policy.test.mjs"
// Owner's decision: orders are ACCEPTED from Telegram (or automatically after the checks); the stock is RESERVED at
// creation, DEDUCTED once on acceptance, given back once on a cancellation after acceptance / a confirmed return —
// and the prize wheel (prize, gift line, budget, chances) keeps following every status, through the Worker.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMockServices, makeEnv, callWorker, runCron, clearDb, seedProducts, putDoc, getDecoded, productStock, PROJECT_ID } from './helpers.mjs';
import { checkoutOrder, line, makeOrderId } from './fixtures.mjs';
import { makeTestSigner } from './token-signer.mjs';
import { clearKeyCache } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { clearAutoSettingsCache } from '../src/autoreview.js';

const SECRET = 'whsec_' + 'A1b2C3d4'.repeat(5);
const CHAT = '-1001234567890';
const ADMIN = '111111111';
const OWNER = 'ownerUid00000000000000000000O1';
const CID = 'test-campaign';
let mock;
let signer;
const BASE = {
  APPROVAL_MODE: 'telegram', STOCK_POLICY: 'on_acceptance', STOCK_MODE: 'apply', PRICE_CHECK_MODE: 'enforce',
  TELEGRAM_CHAT_ID: CHAT, TELEGRAM_BOT_TOKEN: 'test-bot-token', TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_ADMIN_USER_IDS: ADMIN,
};
const env = (o = {}) => makeEnv(mock.url, { ...BASE, ...o });
const WHEEL = { WHEEL_MODE: 'test', WHEEL_CAMPAIGN: CID, WHEEL_PHONE_SECRET: 'test-only-wheel-phone-secret-0123456789', WHEEL_GUEST_PER_IP_DAY: '100' };
const origLog = console.log;
before(async () => { mock = await startMockServices(); signer = await makeTestSigner('kid-acceptance'); console.log = () => {}; });
after(async () => { console.log = origLog; await mock?.close(); });
beforeEach(async () => {
  mock.reset(); clearKeyCache(); mock.state.jwks = { keys: [signer.jwk] };
  await clearDb(); await seedProducts(); clearAutoSettingsCache();
  await putDoc('config/roles', { ownerUid: OWNER });
});

const token = (uid) => signer.idToken({ projectId: PROJECT_ID, uid, extra: { email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'google.com' } } });
const authH = async (uid) => ({ origin: 'https://dairsharaf.com', authorization: `Bearer ${await token(uid)}` });
let phoneN = 0;
function makeOrder(items, { uid = 'guest', discount = 0, phone } = {}) {
  const o = checkoutOrder({ id: makeOrderId(), userId: uid, items });
  if (discount) { o.discountAmount = Math.round((o.discountAmount + discount) * 1000) / 1000; o.total = Math.round((o.total - discount) * 1000) / 1000; }
  o.address = { ...o.address, phone: phone || `+96278${String(++phoneN).padStart(7, '0')}` };
  return o;
}
async function create(o, e = env(), { uid = null, spinId = null } = {}) {
  const r = await callWorker(e, { method: 'POST', path: '/create-order', headers: uid ? await authH(uid) : {}, body: { order: o, turnstileToken: 'pass-token', ...(spinId ? { wheelSpinId: spinId } : {}) } });
  assert.equal(r.status, 200, r.text);
  return o;
}
let upd = 1;
const press = (e, orderId, op, from = ADMIN) => callWorker(e, {
  method: 'POST', path: '/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': SECRET },
  body: { update_id: upd++, callback_query: { id: `cq-${upd}`, from: { id: Number(from) }, message: { message_id: 1, chat: { id: Number(CHAT) } }, data: `v1:${op}:${orderId}` } },
});
const setStatus = async (e, id, status, extra = {}) => callWorker(e, { method: 'POST', path: `/admin/orders/${encodeURIComponent(id)}/status`, headers: await authH(OWNER), body: { status, ...extra } });
const ledger = (id) => getDecoded(`orderLedger/${id}`);
const order = (id) => getDecoded(`orders/${id}`);
const reserved = async (pid) => (await getDecoded(`stockReservations/${pid}`))?.product || 0;
const tgFor = (id) => mock.state.calls.filter((c) => c.channel === 'telegram' && String(c.body?.text || '').includes(id));
const buttons = (call) => (call?.body?.reply_markup?.inline_keyboard || []).flat().map((b) => b.callback_data);

test('P01 creation: stock RESERVED (not deducted), decision pending, ONE Telegram message with accept / reject', async () => {
  const o = await create(makeOrder([line('p-simple', 3)]));
  assert.equal(await productStock('p-simple'), 10, 'nothing deducted at creation');
  assert.equal(await reserved('p-simple'), 3, 'reserved for this order');
  const L = await ledger(o.id);
  assert.equal(L.stockPolicy, 'on_acceptance');
  assert.equal(L.decision, 'pending');
  assert.equal(L.inventory, 'reserved');
  assert.deepEqual(L.orderLines.map((l) => [l.productId, l.quantity]), [['p-simple', 3]]);
  const O = await order(o.id);
  assert.deepEqual(O.approval, { policy: 'telegram', state: 'pending' });
  assert.deepEqual(O.inventory, { policy: 'on_acceptance', state: 'reserved' });
  const tg = tgFor(o.id);
  assert.equal(tg.length, 1);
  assert.deepEqual(buttons(tg[0]), [`v1:acc:${o.id}`, `v1:rej:${o.id}`]);
});

test('P02 accept from Telegram: stock DEDUCTED once, reservation released, status processing; a second press changes nothing', async () => {
  const o = await create(makeOrder([line('p-simple', 3)]));
  assert.equal((await press(env(), o.id, 'acc')).status, 200);
  assert.equal(await productStock('p-simple'), 7);
  assert.equal(await reserved('p-simple'), 0);
  const L = await ledger(o.id);
  assert.equal(L.decision, 'accepted');
  assert.equal(L.inventory, 'deducted');
  assert.equal((await order(o.id)).status, 'processing');
  assert.deepEqual((await order(o.id)).inventory, { policy: 'on_acceptance', state: 'deducted' });
  await press(env(), o.id, 'acc');
  await press(env(), o.id, 'rej');
  assert.equal(await productStock('p-simple'), 7, 'never twice');
  assert.equal((await ledger(o.id)).decision, 'accepted');
});

test('P03 reject from Telegram: reservation released, NOTHING deducted, cancelled; repeated: nothing', async () => {
  const o = await create(makeOrder([line('p-simple', 2)]));
  await press(env(), o.id, 'rej');
  assert.equal(await productStock('p-simple'), 10);
  assert.equal(await reserved('p-simple'), 0);
  assert.equal((await order(o.id)).status, 'cancelled');
  assert.equal((await ledger(o.id)).inventory, 'released');
  await press(env(), o.id, 'rej');
  await press(env(), o.id, 'acc');
  assert.equal(await productStock('p-simple'), 10);
});

test('P13 ONE authorised Telegram account (owner 2026-11-21): any other account, another chat, a text command or a replayed update changes nothing', async () => {
  const STRANGER = '999999999';
  const lastAnswer = () => [...mock.state.tgUi].reverse().find((c) => c.method === 'answerCallbackQuery')?.body?.text || '';
  const pressIn = (orderId, op, chatId) => callWorker(env(), {
    method: 'POST', path: '/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': SECRET },
    body: { update_id: upd++, callback_query: { id: `cq-${upd}`, from: { id: Number(ADMIN) }, message: { message_id: 1, chat: { id: Number(chatId) } }, data: `v1:${op}:${orderId}` } },
  });
  // a pending order: accept / reject by a stranger or from another chat -> nothing (still reserved, not deducted)
  const p = await create(makeOrder([line('p-simple', 2)]));
  for (const op of ['acc', 'rej']) {
    await press(env(), p.id, op, STRANGER);
    assert.match(lastAnswer(), /غير مصرح/, `stranger ${op}`);
    await pressIn(p.id, op, '-100999');
  }
  assert.equal((await ledger(p.id)).decision, 'pending');
  assert.equal(await productStock('p-simple'), 10);
  assert.equal(await reserved('p-simple'), 2);
  // a text command (not a button) is ignored, even from the admin
  for (const text of ['/accept ' + p.id, '/reject ' + p.id, 'قبول']) {
    const r = await callWorker(env(), { method: 'POST', path: '/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': SECRET }, body: { update_id: upd++, message: { message_id: 9, from: { id: Number(ADMIN) }, chat: { id: Number(CHAT) }, text } } });
    assert.equal(r.status, 200);
  }
  assert.equal((await ledger(p.id)).decision, 'pending');
  // an accepted order: cancel / confirm-cancel by a stranger -> stock stays deducted
  const a = await create(makeOrder([line('p-simple', 3)]));
  await press(env(), a.id, 'acc');
  assert.equal(await productStock('p-simple'), 7);
  for (const op of ['can', 'cfc']) { await press(env(), a.id, op, STRANGER); await pressIn(a.id, op, '-100999'); }
  assert.equal(await productStock('p-simple'), 7);
  assert.equal((await ledger(a.id)).inventory, 'deducted');
  // the SAME update delivered again (Telegram retries): one effect only
  const replay = { method: 'POST', path: '/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': SECRET }, body: { update_id: 424242, callback_query: { id: 'same', from: { id: Number(ADMIN) }, message: { message_id: 1, chat: { id: Number(CHAT) } }, data: `v1:cfc:${a.id}` } } };
  for (let i = 0; i < 3; i++) await callWorker(env(), replay);
  assert.equal(await productStock('p-simple'), 10, 'returned once');
  assert.equal((await ledger(a.id)).inventory, 'restocked');
  // the pending order is still untouched and can still be decided by the owner
  await press(env(), p.id, 'acc');
  assert.equal(await productStock('p-simple'), 8);
  // configuration: exactly one numeric id is valid; a username or an empty list is refused
  assert.deepEqual(loadConfig({ ...BASE, ENVIRONMENT: 'local', FIREBASE_PROJECT_ID: 'demo-x' }).errors.filter((e) => /ADMIN/.test(e)), []);
  for (const bad of ['@owner', '', '123, abc']) assert.ok(loadConfig({ ...BASE, ENVIRONMENT: 'local', FIREBASE_PROJECT_ID: 'demo-x', TELEGRAM_ADMIN_USER_IDS: bad }).errors.some((e) => /TELEGRAM_ADMIN_USER_IDS/.test(e)), `refused: "${bad}"`);
});

test('P14 SWITCH DAY: orders created by today\'s production Worker (on_delivery, Telegram off) keep their own rules after the switch to on_acceptance', async () => {
  // today's production settings (wrangler.production.local.toml before the launch)
  const OLD = { STOCK_POLICY: 'on_delivery', APPROVAL_MODE: 'off' };
  const a = await create(makeOrder([line('p-simple', 2)]), env(OLD));
  const b = await create(makeOrder([line('p-simple', 3)]), env(OLD));
  const c = await create(makeOrder([line('p-simple', 1)]), env(OLD));
  assert.equal(await reserved('p-simple'), 6);
  assert.equal(await productStock('p-simple'), 10, 'on_delivery: nothing deducted at creation');
  // ---- the Worker now runs the launch settings (on_acceptance + Telegram) ----
  // a Telegram button can not decide an old order (it never had one): nothing changes
  await press(env(), a.id, 'acc');
  await press(env(), a.id, 'cfc');
  assert.equal(await productStock('p-simple'), 10);
  assert.equal(await reserved('p-simple'), 6);
  // the dashboard moves old orders as before: deducted ONCE at delivery, reservation released
  assert.equal((await setStatus(env(), a.id, 'processing')).status, 200, 'an old order is not "waiting for acceptance"');
  assert.equal((await setStatus(env(), a.id, 'delivered')).status, 200);
  assert.equal(await productStock('p-simple'), 8);
  assert.equal(await reserved('p-simple'), 4);
  assert.deepEqual((await order(a.id)).inventory, { policy: 'on_delivery', state: 'deducted' }, 'keeps its own policy');
  await setStatus(env(), a.id, 'delivered');
  assert.equal(await productStock('p-simple'), 8, 'never twice');
  // cancelling an old order releases its reservation (nothing was deducted)
  assert.equal((await setStatus(env(), b.id, 'cancelled')).status, 200);
  assert.equal(await productStock('p-simple'), 8);
  assert.equal(await reserved('p-simple'), 1);
  // a NEW order next to an old one: reserved at creation, deducted on acceptance; the old one still on delivery
  const n = await create(makeOrder([line('p-simple', 2)]));
  assert.equal((await ledger(n.id)).stockPolicy, 'on_acceptance');
  await press(env(), n.id, 'acc');
  assert.equal(await productStock('p-simple'), 6);
  assert.equal((await setStatus(env(), c.id, 'delivered')).status, 200);
  assert.equal(await productStock('p-simple'), 5);
  assert.equal(await reserved('p-simple'), 0);
  // rollback (back to today's settings): the accepted new order still follows ITS policy — cancel returns once
  assert.equal((await setStatus(env(OLD), n.id, 'cancelled')).status, 200);
  assert.equal(await productStock('p-simple'), 7);
  await setStatus(env(OLD), n.id, 'cancelled');
  assert.equal(await productStock('p-simple'), 7, 'never twice');
});

// ---------------------------------------------------------------- launch transition (owner 2026-11-21)
// The launch Worker: on_acceptance + Telegram + wheel live, ORDER_SIGN_IN NOT set yet (the current site still has guests)
const LAUNCH = { ...WHEEL };
const TODAY = { STOCK_POLICY: 'on_delivery', APPROVAL_MODE: 'off' };

test('P15 orders from the Nov 16-18 approval version (on_approval ledger) under the launch Worker: one deduction at most, never again', async () => {
  const OLD_APPROVAL = { STOCK_POLICY: 'on_creation' }; // + APPROVAL_MODE=telegram = the on_approval behaviour of version 274978a8
  const pend = await create(makeOrder([line('p-simple', 2)]), env(OLD_APPROVAL));
  const acc = await create(makeOrder([line('p-simple', 3)]), env(OLD_APPROVAL));
  const done = await create(makeOrder([line('p-simple', 1)]), env(OLD_APPROVAL));
  assert.equal((await ledger(pend.id)).stockPolicy, 'on_approval');
  await press(env(OLD_APPROVAL), acc.id, 'acc');
  assert.equal(await productStock('p-simple'), 7, 'accepted back then: deducted once');
  // the owner later handled `done` from the dashboard (direct write, as the old site did): status no longer new
  await putDoc(`orders/${done.id}`, { ...(await order(done.id)), status: 'delivered' });
  // ---- the launch Worker ----
  const e = env(LAUNCH);
  await press(e, done.id, 'acc');
  assert.equal(await productStock('p-simple'), 7, 'an order already handled is never deducted by an old button');
  await press(e, pend.id, 'acc');
  assert.equal(await productStock('p-simple'), 5, 'a still-undecided old order: deducted ONCE on acceptance');
  await press(e, pend.id, 'acc');
  assert.equal(await productStock('p-simple'), 5);
  await press(e, acc.id, 'cfc');
  assert.equal(await productStock('p-simple'), 8, 'an accepted old order cancelled: back ONCE');
  await press(e, acc.id, 'cfc');
  assert.equal(await productStock('p-simple'), 8, 'never twice');
  // the dashboard keeps its old path for these orders (not Worker-managed): the Worker refuses, the browser writes directly
  assert.equal((await setStatus(e, pend.id, 'shipped')).status, 409);
  assert.equal(await reserved('p-simple'), 0, 'no reservation invented for old orders');
});

test('P16 ROLLBACK BY SETTINGS with orders still pending: nothing lost, nothing doubled; forward again works', async () => {
  const e = env(LAUNCH);
  const p1 = await create(makeOrder([line('p-simple', 2)]), e);
  const p2 = await create(makeOrder([line('p-simple', 3)]), e);
  const a1 = await create(makeOrder([line('p-simple', 1)]), e);
  await press(e, a1.id, 'acc');
  assert.equal(await productStock('p-simple'), 9);
  assert.equal(await reserved('p-simple'), 5);
  // ---- rollback: same new code, today's settings (on_delivery, Telegram off) ----
  const r = env(TODAY);
  // Telegram buttons are off: a press changes nothing
  const off = await press(r, p1.id, 'acc');
  assert.notEqual(off.status, 200);
  assert.equal(await productStock('p-simple'), 9);
  // a pending order cannot be moved forward (no deduction behind the owner's back) but CAN be cancelled = rejected
  assert.equal((await setStatus(r, p2.id, 'processing')).status, 409);
  assert.equal(await reserved('p-simple'), 5, 'reservation kept');
  assert.equal((await setStatus(r, p1.id, 'cancelled')).status, 200);
  assert.equal(await reserved('p-simple'), 3, 'p1 released once');
  await setStatus(r, p1.id, 'cancelled');
  assert.equal(await reserved('p-simple'), 3);
  // the accepted one follows its own policy: delivered = nothing more, stock unchanged
  assert.equal((await setStatus(r, a1.id, 'delivered')).status, 200);
  assert.equal(await productStock('p-simple'), 9);
  // a new order under the rollback settings: the old on_delivery behaviour
  const n = await create(makeOrder([line('p-simple', 1)]), r);
  assert.equal((await ledger(n.id)).stockPolicy, 'on_delivery');
  // ---- forward again: the pending order is still decidable ----
  await press(e, p2.id, 'acc');
  assert.equal(await productStock('p-simple'), 6);
  assert.equal(await reserved('p-simple'), 1, 'only the new on_delivery order is still reserved');
});

test('P17 the OPENING CAMPAIGN (50 JOD / 30 days) saved through the dashboard endpoint; a won prize goes through acceptance and delivery inside the budget', async () => {
  const { launchCampaign } = await import('../../../src/services/wheelAdmin.ts');
  const e = env(LAUNCH);
  const save = await callWorker(e, { method: 'POST', path: '/admin/wheel/campaign', headers: await authH(OWNER), body: { campaign: launchCampaign(new Date()) } });
  assert.equal(save.status, 200, save.text);
  const adm = (await callWorker(e, { method: 'GET', path: '/admin/wheel', headers: await authH(OWNER) })).body;
  assert.equal(adm.budget.allowanceJod, 50);
  assert.equal(adm.budget.availableJod, 50);
  // the unknown-cost prizes are stored but never offered
  const st = (await callWorker(e, { method: 'GET', path: '/wheel/state', headers: await authH('p17Viewer0000000000000000000V') })).body;
  assert.equal(st.campaign, 'open');
  for (const id of ['watch-1', 'toy-1', 'acc-1']) assert.ok(!JSON.stringify(st).includes(`"${id}"`), `${id} not offered`);
  // spin with fresh accounts until a prize usable on THIS order (gift or cash discount) comes up
  let won = null; let uid = null;
  for (let i = 0; i < 120 && !won; i++) {
    uid = `p17Uid${String(i).padStart(24, '0')}`;
    const s = (await callWorker(e, { method: 'POST', path: '/wheel/spin', headers: await authH(uid), body: {} })).body.result;
    if (s && ['gift-2', 'gift-3', 'gift-4', 'gift-5', 'disc-1', 'disc-4', 'disc-5'].includes(s.prizeId)) won = s;
  }
  assert.ok(won, 'a prize was won within 120 spins');
  const held = (await getDecoded(`wheelBudget/${CID}`)).heldMils;
  assert.ok(held > 0 && held <= 50_000, 'held cost inside the 50 JOD');
  const discount = won.prizeId.startsWith('disc-') ? Number(won.prizeId.split('-')[1]) : 0;
  const o = await create(makeOrder([line('p-simple', 7)], { uid, discount }), e, { uid, spinId: won.spinId });
  assert.equal(await reserved('p-simple'), 7);
  await press(e, o.id, 'acc');
  assert.equal(await productStock('p-simple'), 3, 'deducted once on acceptance (a generic gift takes no product stock)');
  assert.equal((await setStatus(e, o.id, 'delivered')).status, 200);
  assert.equal(await productStock('p-simple'), 3, 'nothing more on delivery');
  const b = await getDecoded(`wheelBudget/${CID}`);
  assert.equal(b.deliveredOrders, 1);
  assert.ok(b.spentMils > 0 && b.spentMils + b.heldMils <= 50_000, 'spent + held never above 50 JOD');
  assert.equal((await getDecoded(`wheelSpins/${won.spinId}`)).status, 'consumed');
});

test('P18 the secret-match probe {"update_id":0}: 200 with the right secret, 401 otherwise — no order, stock, ledger or Telegram call touched', async () => {
  const e = env(LAUNCH);
  const o = await create(makeOrder([line('p-simple', 2)]), e);
  const before = { stock: await productStock('p-simple'), reserved: await reserved('p-simple'), ledger: JSON.stringify(await ledger(o.id)), order: JSON.stringify(await order(o.id)) };
  const tgBefore = mock.state.calls.filter((c) => c.channel === 'telegram').length + (mock.state.tgUi?.length || 0);
  const probe = (h) => callWorker(e, { method: 'POST', path: '/telegram/webhook', headers: h, body: { update_id: 0 } });
  assert.equal((await probe({ 'x-telegram-bot-api-secret-token': SECRET })).status, 200, 'right secret');
  assert.equal((await probe({ 'x-telegram-bot-api-secret-token': 'f'.repeat(64) })).status, 401, 'other secret');
  assert.equal((await probe({})).status, 401, 'no secret');
  assert.equal(await productStock('p-simple'), before.stock);
  assert.equal(await reserved('p-simple'), before.reserved);
  assert.equal(JSON.stringify(await ledger(o.id)), before.ledger, 'ledger untouched');
  assert.equal(JSON.stringify(await order(o.id)), before.order, 'order untouched');
  assert.equal(mock.state.calls.filter((c) => c.channel === 'telegram').length + (mock.state.tgUi?.length || 0), tgBefore, 'no Telegram call');
});

test('P04 cancel AFTER acceptance from Telegram (confirm step): stock back ONCE; a second cancel changes nothing', async () => {
  const o = await create(makeOrder([line('p-simple', 4)]));
  await press(env(), o.id, 'acc');
  assert.equal(await productStock('p-simple'), 6);
  await press(env(), o.id, 'can'); // asks for confirmation only
  assert.equal(await productStock('p-simple'), 6);
  await press(env(), o.id, 'cfc');
  assert.equal(await productStock('p-simple'), 10);
  assert.equal((await ledger(o.id)).inventory, 'restocked');
  await press(env(), o.id, 'cfc');
  assert.equal(await productStock('p-simple'), 10, 'never twice');
});

test('P05 dashboard: a PENDING order cannot be moved forward (accept happens in Telegram); cancelling it = rejecting it', async () => {
  const o = await create(makeOrder([line('p-simple', 2)]));
  const r = await setStatus(env(), o.id, 'processing');
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'APPROVAL_PENDING');
  const c = await setStatus(env(), o.id, 'cancelled');
  assert.equal(c.status, 200, c.text);
  assert.equal((await ledger(o.id)).decision, 'rejected');
  assert.equal(await reserved('p-simple'), 0);
  assert.equal(await productStock('p-simple'), 10);
});

test('P06 dashboard after acceptance: shipped / delivered deduct NOTHING more (delivery time recorded); a return needs confirmation, then stock back once', async () => {
  const o = await create(makeOrder([line('p-simple', 3)]));
  await press(env(), o.id, 'acc');
  for (const s of ['shipped', 'delivered']) assert.equal((await setStatus(env(), o.id, s)).status, 200, s);
  assert.equal(await productStock('p-simple'), 7, 'deducted once (on acceptance)');
  assert.ok((await ledger(o.id)).deliveredAt instanceof Date);
  assert.equal((await setStatus(env(), o.id, 'delivered')).body.result, 'unchanged');
  const noConfirm = await setStatus(env(), o.id, 'cancelled');
  assert.equal(noConfirm.body.code, 'RETURN_CONFIRMATION_REQUIRED');
  assert.equal((await setStatus(env(), o.id, 'cancelled', { confirmReturn: true })).status, 200);
  assert.equal(await productStock('p-simple'), 10);
  await setStatus(env(), o.id, 'cancelled', { confirmReturn: true });
  assert.equal(await productStock('p-simple'), 10, 'never twice');
});

test('P07 dashboard cancel AFTER acceptance (before delivery): stock back ONCE; a later Telegram cancel changes nothing', async () => {
  const o = await create(makeOrder([line('p-simple', 5)]));
  await press(env(), o.id, 'acc');
  assert.equal((await setStatus(env(), o.id, 'cancelled')).status, 200);
  assert.equal(await productStock('p-simple'), 10);
  assert.equal((await ledger(o.id)).inventory, 'restocked');
  assert.equal((await order(o.id)).approval.state, 'cancelled');
  await press(env(), o.id, 'cfc');
  assert.equal(await productStock('p-simple'), 10, 'never twice');
});

test('P08 CONCURRENCY: 5 accept presses + a dashboard cancel at the same moment -> ONE outcome, stock consistent, never double', async () => {
  for (let round = 0; round < 6; round++) {
    await clearDb(); await seedProducts();
    await putDoc('config/roles', { ownerUid: OWNER });
    const o = await create(makeOrder([line('p-simple', 3)]));
    await Promise.all([...Array.from({ length: 5 }, () => press(env(), o.id, 'acc')), setStatus(env(), o.id, 'cancelled')]);
    const L = await ledger(o.id);
    const stock = await productStock('p-simple');
    assert.equal(await reserved('p-simple'), 0, 'reservation released in every outcome');
    if (L.decision === 'accepted') assert.equal(stock, 7, 'accepted: deducted once');
    else if (L.decision === 'rejected') assert.equal(stock, 10, 'rejected: nothing deducted');
    else if (L.decision === 'cancelled') assert.equal(stock, 10, 'accepted then cancelled: back once');
    else assert.fail(`unexpected ${L.decision}`);
  }
});

test('P09 last unit: two orders for the same last pieces — the second is refused at creation (reservation), never oversold at acceptance', async () => {
  const a = await create(makeOrder([line('p-simple', 8)]));
  const r = await callWorker(env(), { method: 'POST', path: '/create-order', body: { order: makeOrder([line('p-simple', 3)]), turnstileToken: 'pass-token' } });
  assert.equal(r.status, 422, r.text);
  assert.equal(r.body.code, 'OUT_OF_STOCK');
  await press(env(), a.id, 'acc');
  assert.equal(await productStock('p-simple'), 2);
});

test('P10 AUTOMATIC acceptance on this policy: deducted once by the automatic decision (same commit path); the order and stock as for a Telegram acceptance', async () => {
  const e = env({ AUTO_APPROVAL_MODE: 'on', AUTO_APPROVAL_HASH_SECRET: 'h'.repeat(40), AUTO_APPROVAL_CACHE_MS: '0' });
  await putDoc('config/autoApproval', { enabled: true });
  const o = await create(makeOrder([line('p-simple', 2)]), e);
  const L = await ledger(o.id);
  assert.equal(L.autoReview?.outcome, 'auto_accepted', JSON.stringify(L.autoReview));
  assert.equal(L.decision, 'accepted');
  assert.equal(L.decidedBy.source, 'auto');
  assert.equal(await productStock('p-simple'), 8);
  assert.equal(await reserved('p-simple'), 0);
  assert.equal((await order(o.id)).status, 'processing');
  await runCron(e); // recovery never decides twice
  assert.equal(await productStock('p-simple'), 8);
});

test('P11 PRIZE WHEEL with acceptance: prize + gift line reserved at creation, gift deducted on acceptance, prize consumed + chance + budget on delivery; reject / cancel give it back once', async () => {
  const e = env({ ...WHEEL, ORDER_SIGN_IN: 'google' });
  const prizes = [
    { id: 'gift-1', type: 'gift', label: 'هدية', productId: 'p-simple', unitCostJod: 2.5, costConfirmed: true, minOrderJod: 5, weight: 1_000_000, quantity: 10 },
    { id: 'none-1', type: 'none', label: 'حظ أوفر', weight: 1 },
  ];
  await putDoc(`wheelCampaigns/${CID}`, { active: true, minOrderJod: 5, budgetJod: 100, budgetPer100Jod: 12, budgetStartJod: 20, giftOnCancel: 'return', startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', terms: '', prizes });
  await putDoc(`wheelPool/${CID}_gift-1`, { remaining: 10 });
  const U = 'accWheelUid000000000000000000A';
  const s = (await callWorker(e, { method: 'POST', path: '/wheel/spin', headers: await authH(U), body: {} })).body.result;
  assert.equal(s.prizeId, 'gift-1');
  // order (products 7.5 >= 5) + the gift line (1 x p-simple): reserved 3 + 1
  const o = await create(makeOrder([line('p-simple', 3)], { uid: U }), e, { uid: U, spinId: s.spinId });
  assert.equal(await reserved('p-simple'), 4, 'gift line reserved with the order');
  assert.equal((await getDecoded(`wheelSpins/${s.spinId}`)).status, 'reserved');
  await press(e, o.id, 'acc');
  assert.equal(await productStock('p-simple'), 6, '3 + the gift, deducted once on acceptance');
  for (const st of ['shipped', 'delivered']) assert.equal((await setStatus(e, o.id, st)).status, 200, st);
  assert.equal(await productStock('p-simple'), 6, 'nothing more on delivery');
  assert.equal((await getDecoded(`wheelSpins/${s.spinId}`)).status, 'consumed');
  const b = await getDecoded(`wheelBudget/${CID}`);
  assert.equal(b.deliveredOrders, 1);
  assert.equal(b.spentMils, 2500);
  assert.equal(b.heldMils, 0);
  assert.equal((await getDecoded(`wheelEntitlements/${CID}_${U}`)).granted, 2, 'a new chance after the delivered order');
  // a second account: prize won, order REJECTED in Telegram -> the prize goes back, nothing deducted
  const V = 'accWheelUid000000000000000000B';
  const s2 = (await callWorker(e, { method: 'POST', path: '/wheel/spin', headers: await authH(V), body: {} })).body.result;
  const o2 = await create(makeOrder([line('p-simple', 2)], { uid: V }), e, { uid: V, spinId: s2.spinId });
  await press(e, o2.id, 'rej');
  assert.equal((await getDecoded(`wheelSpins/${s2.spinId}`)).status, 'issued', 'return policy: usable again');
  assert.equal(await productStock('p-simple'), 6);
  assert.equal(await reserved('p-simple'), 0);
  // ...used again, ACCEPTED, then cancelled after acceptance -> stock back once (gift included), prize back once
  const o3 = await create(makeOrder([line('p-simple', 2)], { uid: V }), e, { uid: V, spinId: s2.spinId });
  await press(e, o3.id, 'acc');
  assert.equal(await productStock('p-simple'), 3);
  assert.equal((await setStatus(e, o3.id, 'cancelled')).status, 200);
  assert.equal(await productStock('p-simple'), 6);
  assert.equal((await getDecoded(`wheelSpins/${s2.spinId}`)).status, 'issued');
  await setStatus(e, o3.id, 'cancelled');
  assert.equal(await productStock('p-simple'), 6, 'never twice');
});

test('P12 configuration: on_acceptance needs Telegram approval; production allows ONLY on_delivery+off or on_acceptance+telegram', async () => {
  const errs = (o) => loadConfig(makeEnv(mock.url, o)).errors.join(' | ');
  assert.match(errs({ STOCK_POLICY: 'on_acceptance', STOCK_MODE: 'apply' }), /on_acceptance requires APPROVAL_MODE=telegram/);
  assert.equal(loadConfig(env()).ok, true, 'the test combination is valid');
  assert.equal(loadConfig(env(WHEEL)).ok, true, 'the wheel works with on_acceptance');
  assert.match(errs({ ...BASE, STOCK_POLICY: 'on_delivery' }), /cannot be combined with APPROVAL_MODE=telegram/);
});
