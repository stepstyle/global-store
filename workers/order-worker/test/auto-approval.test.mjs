// Smart auto-approval B01–B15 — LOCAL ONLY: the real Worker (src/index.js), the Firestore EMULATOR (demo- project),
// mock Telegram / SendGrid / Turnstile on 127.0.0.1. Synthetic fixture products only.
//   firebase emulators:exec --only firestore --project demo-dairsharaf-orders --config test/firebase.json \
//     "node --test --test-concurrency=1 test/auto-approval.test.mjs"
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMockServices, makeEnv, callWorker, runCron, clearDb, seedProducts, putDoc, getDecoded, adminDb, productStock, variantStock } from './helpers.mjs';
import { checkoutOrder, line, makeOrderId } from './fixtures.mjs';
import { encodeFields } from '../src/firestore.js';
import { __test, clearAutoSettingsCache } from '../src/autoreview.js';

const SECRET = 'whsec_' + 'A1b2C3d4'.repeat(5);
const CHAT = '-1001234567890';
const ADMIN = '111111111';
const HASH_SECRET = 'h'.repeat(40);
let mock;
const env = (o = {}) => makeEnv(mock.url, {
  APPROVAL_MODE: 'telegram', STOCK_MODE: 'apply', TELEGRAM_CHAT_ID: CHAT, TELEGRAM_BOT_TOKEN: 'test-bot-token',
  TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_ADMIN_USER_IDS: ADMIN,
  AUTO_APPROVAL_MODE: 'on', AUTO_APPROVAL_HASH_SECRET: HASH_SECRET, AUTO_APPROVAL_CACHE_MS: '0', ...o,
});
const RECOVER_NOW = { AUTO_APPROVAL_RECOVER_AFTER_MS: '0' };
const origLog = console.log;

const logs = [];
before(async () => { mock = await startMockServices(); console.log = (...a) => { logs.push(a.join(' ')); }; });
after(async () => { console.log = origLog; await mock?.close(); });
beforeEach(async () => {
  mock.reset(); await clearDb(); await seedProducts(); clearAutoSettingsCache();
  Object.assign(__test, { stopAt: null, afterAssess: null, settingsUnavailable: false });
  await putDoc('config/autoApproval', { enabled: true });
});
afterEach(() => Object.assign(__test, { stopAt: null, afterAssess: null, settingsUnavailable: false }));

let phoneN = 0;
const freshPhone = () => `+96279${String(1000000 + (++phoneN % 8999999)).slice(0, 7)}`;
/** a clean COD order (2 × notebook + 1 × red pen = 8.20 JOD) with its OWN phone unless given */
function makeOrder({ items, phone = freshPhone(), payment = 'cod', overrides = {} } = {}) {
  const { address: addressOverride = {}, ...rest } = overrides; // the address is MERGED, never replaced
  const o = checkoutOrder({ id: makeOrderId(), payment, ...(items ? { items } : {}), overrides: rest });
  o.address = { ...o.address, phone, ...addressOverride };
  return o;
}
const send = (e, o, { token = 'pass-token' } = {}) => callWorker(e, { method: 'POST', path: '/create-order', body: { order: o, ...(token ? { turnstileToken: token } : {}) } });
async function create(o, e = env(), opts) {
  const r = await send(e, o, opts);
  assert.equal(r.status, 200, r.text);
  return o;
}
const ledger = (id) => getDecoded(`orderLedger/${id}`);
const order = (id) => getDecoded(`orders/${id}`);
const tgSends = (id) => mock.state.calls.filter((c) => c.channel === 'telegram' && String(c.body?.text || '').includes(id));
const buttons = (call) => (call?.body?.reply_markup?.inline_keyboard || []).flat().map((b) => b.callback_data);
let upd = 1;
const press = (e, orderId, op, from = ADMIN) => callWorker(e, {
  method: 'POST', path: '/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': SECRET },
  body: { update_id: upd++, callback_query: { id: `cq-${upd}`, from: { id: Number(from) }, message: { message_id: 1, chat: { id: Number(CHAT) } }, data: `v1:${op}:${orderId}` } },
});
/** pretend time passed: the review marker and the notification due date are moved into the past */
async function ageLedger(id, ms) {
  const fs = adminDb();
  const r = await fs.commit([{ update: { name: fs.name(`orderLedger/${id}`), fields: encodeFields({ autoReview: { ...(await ledger(id)).autoReview, queuedAt: new Date(Date.now() - ms) }, notifyNextAt: new Date(Date.now() - 1000) }) }, updateMask: { fieldPaths: ['autoReview.queuedAt', 'notifyNextAt'] } }]);
  assert.ok(r.ok);
}
const outcome = async (id) => (await ledger(id)).autoReview;

// ------------------------------------------------------------------------------------------------------------------
test('B01 clean order: accepted automatically — stock deducted ONCE, status processing, decided by "auto", one 🤖 message with the cancel button', async () => {
  const o = await create(makeOrder());
  const L = await ledger(o.id);
  assert.equal(L.autoReview.state, 'done');
  assert.equal(L.autoReview.outcome, 'auto_accepted');
  assert.equal(L.decision, 'accepted');
  assert.deepEqual(L.decidedBy, { source: 'auto', userId: 'auto' });
  assert.match(L.phoneHash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(L).includes(o.address.phone.slice(4)), 'the phone is not stored in the ledger again');
  const O = await order(o.id);
  assert.equal(O.status, 'processing');
  assert.equal(O.approval.state, 'accepted');
  assert.equal(await productStock('p-simple'), 8);
  assert.equal(await variantStock('p-variants', 'var_red'), 4);
  const m = tgSends(o.id);
  assert.equal(m.length, 1, 'one message');
  assert.match(m[0].body.text, /قُبل تلقائيًا/);
  assert.match(m[0].body.text, /لا يثبت هوية صاحب رقم الهاتف/);
  assert.match(m[0].body.text, /تم قبول الطلب وخصم المخزون — تلقائيًا/);
  assert.deepEqual(buttons(m[0]), [`v1:can:${o.id}`]);
});

test('B02 each risk sends the order to MANUAL review: status new, no stock change, ⚠️ reason, ✅/❌ buttons', async () => {
  const cases = [
    ['no Turnstile token', makeOrder(), { token: null }, 'فحص الحماية من الروبوتات'],
    ['6 of one product', makeOrder({ items: [line('p-hundred', 6)] }), {}, 'كمية كبيرة لمنتج واحد'],
    ['16 pieces', makeOrder({ items: [line('p-hundred', 5), line('p-simple', 5), line('p-string-stock', 5), line('p-empty-variants', 1)] }), {}, 'عدد قطع كبير'],
    ['placeholder street', makeOrder({ overrides: { address: { street: 'لم يتم إدخال عنوان تفصيلي' } } }), {}, 'عنوان التوصيل ناقص'],
    ['unknown Amman area', makeOrder({ overrides: { addressMeta: { ...checkoutOrder().addressMeta, ammanAreaId: 'zz9' } } }), {}, 'منطقة التوصيل غير معروفة'],
    ['untracked stock', makeOrder({ items: [line('p-no-stock', 1)] }), {}, 'مشكلة في المخزون'],
  ];
  for (const [label, o, opts, reason] of cases) {
    mock.reset();
    const before = { simple: await productStock('p-simple'), hundred: await productStock('p-hundred') };
    await create(o, env(), opts);
    const ar = await outcome(o.id);
    assert.equal(ar.outcome, 'manual_review', label);
    assert.equal((await order(o.id)).status, 'new', label);
    assert.equal((await ledger(o.id)).decision, 'pending', label);
    assert.deepEqual({ simple: await productStock('p-simple'), hundred: await productStock('p-hundred') }, before, `${label}: no stock change`);
    const m = tgSends(o.id);
    assert.equal(m.length, 1, label);
    assert.match(m[0].body.text, /يحتاج مراجعة يدوية/, label);
    assert.ok(m[0].body.text.includes(reason), `${label}: "${reason}" in the message`);
    assert.deepEqual(buttons(m[0]), [`v1:acc:${o.id}`, `v1:rej:${o.id}`], label);
  }
  // value above the configured limit (limits come from the dashboard document)
  await putDoc('config/autoApproval', { enabled: true, maxOrderTotal: 5 });
  const v = await create(makeOrder());
  assert.equal((await outcome(v.id)).outcome, 'manual_review');
  assert.ok((await outcome(v.id)).reasons.some((r) => r.code === 'ORDER_TOTAL_HIGH'));
});

test('B03 locks: server ceiling off = no review at all; switch off / no settings = disabled (normal pending message, no 🤖/⚠️)', async () => {
  const off = await create(makeOrder(), env({ AUTO_APPROVAL_MODE: 'off' }));
  const L = await ledger(off.id);
  assert.equal(L.autoReview, undefined, 'no marker when the server ceiling is off');
  assert.equal(L.phoneHash, undefined);
  assert.equal(L.decision, 'pending');
  await putDoc('config/autoApproval', { enabled: false });
  const sw = await create(makeOrder());
  assert.equal((await outcome(sw.id)).outcome, 'disabled');
  await adminDb().commit([{ delete: adminDb().name('config/autoApproval') }]);
  const none = await create(makeOrder());
  assert.equal((await outcome(none.id)).outcome, 'disabled', 'no settings document = switch OFF');
  for (const id of [off.id, sw.id, none.id]) {
    const m = tgSends(id);
    assert.equal(m.length, 1);
    assert.ok(!/قُبل تلقائيًا|يحتاج مراجعة يدوية/.test(m[0].body.text));
    assert.deepEqual(buttons(m[0]), [`v1:acc:${id}`, `v1:rej:${id}`]);
  }
  assert.equal(await productStock('p-simple'), 10, 'nothing deducted by any of them');
  // AUTO_APPROVAL_MODE=on without Telegram approval is refused by the configuration
  const bad = await callWorker(env({ APPROVAL_MODE: 'off' }), { path: '/' });
  assert.equal(bad.body.ok, false);
});

test('B04 the same order sent again 5× in a row and 5× at once: ONE review, stock deducted once, ONE message', async () => {
  const o = makeOrder();
  await create(o);
  for (let i = 0; i < 5; i++) assert.equal((await send(env(), o)).body.replay, true);
  const par = await Promise.all(Array.from({ length: 5 }, () => send(env(), o)));
  for (const r of par) assert.equal(r.body.replay, true);
  assert.equal(await productStock('p-simple'), 8);
  assert.equal(await variantStock('p-variants', 'var_red'), 4);
  assert.equal(tgSends(o.id).length, 1);
  assert.equal((await outcome(o.id)).outcome, 'auto_accepted');
});

test('B05 the automatic review and an admin press at the same moment: ONE decision, stock deducted once', async () => {
  __test.stopAt = 'after_assess';
  const o = await create(makeOrder()); // saved, review interrupted (queued), no message yet
  __test.stopAt = null;
  assert.equal((await outcome(o.id)).state, 'queued');
  await Promise.all([runCron(env(RECOVER_NOW)), press(env(), o.id, 'acc')]);
  const L = await ledger(o.id);
  assert.equal(L.decision, 'accepted');
  assert.equal(await productStock('p-simple'), 8, 'exactly one deduction');
  assert.equal(L.autoReview.state, 'done');
  assert.ok(['auto_accepted', 'superseded'].includes(L.autoReview.outcome), L.autoReview.outcome);
});

test('B06 two clean orders for the LAST piece at the same time: one accepted automatically, the other to manual review, never negative', async () => {
  const a = makeOrder({ items: [line('p-last-one', 1)] });
  const b = makeOrder({ items: [line('p-last-one', 1)] });
  await Promise.all([create(a), create(b)]);
  const outs = [(await outcome(a.id)).outcome, (await outcome(b.id)).outcome].sort();
  assert.deepEqual(outs, ['auto_accepted', 'manual_review']);
  assert.equal(await productStock('p-last-one'), 0);
  const manual = (await outcome(a.id)).outcome === 'manual_review' ? a : b;
  assert.equal((await order(manual.id)).status, 'new');
  assert.ok((await outcome(manual.id)).reasons.some((r) => r.code === 'STOCK_PROBLEM'));
});

test('B07 the FINAL stock check is inside the atomic acceptance: stock gone after the pre-check -> manual review, nothing deducted', async () => {
  __test.afterAssess = async () => { await putDoc('products/p-last-one', { name: 'آخر قطعة', price: 5, stock: 0 }); };
  const o = await create(makeOrder({ items: [line('p-last-one', 1)] }));
  const ar = await outcome(o.id);
  assert.equal(ar.outcome, 'manual_review');
  assert.deepEqual(ar.reasons.map((r) => [r.code, r.final]), [['STOCK_PROBLEM', true]]);
  assert.equal(await productStock('p-last-one'), 0, 'never negative, nothing deducted');
  assert.equal((await ledger(o.id)).decision, 'pending');
});

test('B08 same phone within 24 h -> manual review (not rejected); another phone is fine; no fingerprint key -> manual', async () => {
  const phone = freshPhone();
  const first = await create(makeOrder({ phone }));
  assert.equal((await outcome(first.id)).outcome, 'auto_accepted');
  const second = await create(makeOrder({ phone }));
  const ar = await outcome(second.id);
  assert.equal(ar.outcome, 'manual_review');
  assert.ok(ar.reasons.some((r) => r.code === 'DUPLICATE_PHONE' && r.count === 1));
  assert.equal((await order(second.id)).status, 'new', 'kept for a human, not rejected');
  assert.equal((await outcome((await create(makeOrder())).id)).outcome, 'auto_accepted', 'other phone');
  const noKey = await create(makeOrder(), env({ AUTO_APPROVAL_HASH_SECRET: '' }));
  assert.ok((await outcome(noKey.id)).reasons.some((r) => r.code === 'DUPLICATE_CHECK_UNAVAILABLE'));
});

test('B09 CliQ is never accepted automatically, even when everything else is fine', async () => {
  const o = await create(makeOrder({ payment: 'cliq' }));
  const ar = await outcome(o.id);
  assert.equal(ar.outcome, 'manual_review');
  assert.deepEqual(ar.reasons.map((r) => r.code), ['CLIQ_NEEDS_VERIFICATION']);
  assert.equal(await productStock('p-simple'), 10);
  assert.match(tgSends(o.id)[0].body.text, /دفع CliQ يحتاج تحققًا/);
});

test('B10 cancelling an automatically accepted order restores the stock ONCE (confirm pressed 3× at once)', async () => {
  const o = await create(makeOrder());
  assert.equal(await productStock('p-simple'), 8);
  await press(env(), o.id, 'can');
  await Promise.all([1, 2, 3].map(() => press(env(), o.id, 'cfc')));
  assert.equal((await ledger(o.id)).decision, 'cancelled');
  assert.equal((await order(o.id)).status, 'cancelled');
  assert.equal(await productStock('p-simple'), 10);
  assert.equal(await variantStock('p-variants', 'var_red'), 5);
});

test('B11 never beyond "processing" automatically; orders created with the ceiling off are never reviewed later', async () => {
  const o = await create(makeOrder());
  await runCron(env(RECOVER_NOW));
  assert.equal((await order(o.id)).status, 'processing');
  const legacy = await create(makeOrder(), env({ AUTO_APPROVAL_MODE: 'off' }));
  await runCron(env(RECOVER_NOW));
  await runCron(env(RECOVER_NOW));
  const L = await ledger(legacy.id);
  assert.equal(L.autoReview, undefined);
  assert.equal(L.decision, 'pending', 'an existing order is never auto-accepted afterwards');
});

test('B12 settings cannot be read -> manual review (never an automatic acceptance)', async () => {
  __test.settingsUnavailable = true;
  const o = await create(makeOrder());
  assert.deepEqual((await outcome(o.id)).reasons.map((r) => r.code), ['SETTINGS_UNAVAILABLE']);
  assert.equal(await productStock('p-simple'), 10);
});

test('B13 Worker stops after saving the order, before the review: the order is kept; the cron waits, then finishes it — stock once, ONE message', async () => {
  __test.stopAt = 'after_assess';
  const o = await create(makeOrder());
  __test.stopAt = null;
  assert.ok(await order(o.id), 'the order is saved');
  assert.equal((await outcome(o.id)).state, 'queued');
  assert.equal(tgSends(o.id).length, 0, 'no message yet');
  assert.equal(await productStock('p-simple'), 10);
  // a cron run right away does NOT race the (possibly still running) request: it waits
  await runCron(env());
  assert.equal((await outcome(o.id)).state, 'queued');
  assert.equal(tgSends(o.id).length, 0);
  // later: the cron finishes the review, then sends the message
  await ageLedger(o.id, 120_000);
  await runCron(env());
  const ar = await outcome(o.id);
  assert.equal(ar.state, 'done');
  assert.equal(ar.outcome, 'auto_accepted');
  assert.equal(ar.recovered, true);
  assert.equal(await productStock('p-simple'), 8);
  assert.equal(tgSends(o.id).length, 1);
  await runCron(env(RECOVER_NOW));
  assert.equal(tgSends(o.id).length, 1, 'no duplicate message');
  assert.equal(await productStock('p-simple'), 8);
});

test('B13b a review that cannot be finished for 30 min is closed as manual review and the message is sent (never stuck)', async () => {
  __test.stopAt = 'after_assess';
  const o = await create(makeOrder());
  await ageLedger(o.id, 31 * 60_000);
  await runCron(env()); // the recovery stops again (still failing) -> gives up
  __test.stopAt = null;
  const ar = await outcome(o.id);
  assert.equal(ar.outcome, 'manual_review');
  assert.deepEqual(ar.reasons.map((r) => r.code), ['AUTO_REVIEW_FAILED']);
  assert.equal(await productStock('p-simple'), 10);
  assert.equal(tgSends(o.id).length, 1);
  assert.match(tgSends(o.id)[0].body.text, /تعذّر إكمال الفحص التلقائي/);
});

test('B14 Worker stops AFTER the acceptance, before closing the review: recovery finds it accepted — NO second deduction, one message', async () => {
  __test.stopAt = 'after_decide';
  const o = await create(makeOrder());
  __test.stopAt = null;
  assert.equal((await ledger(o.id)).decision, 'accepted');
  assert.equal((await outcome(o.id)).state, 'queued');
  assert.equal(await productStock('p-simple'), 8);
  await ageLedger(o.id, 120_000);
  await runCron(env());
  const ar = await outcome(o.id);
  assert.equal(ar.outcome, 'auto_accepted');
  assert.equal(await productStock('p-simple'), 8, 'still deducted once');
  assert.equal(await variantStock('p-variants', 'var_red'), 4);
  assert.equal(tgSends(o.id).length, 1);
  assert.deepEqual(buttons(tgSends(o.id)[0]), [`v1:can:${o.id}`]);
});

test('B15 the switch is turned OFF before the recovery: no automatic acceptance, nothing deducted, normal message', async () => {
  __test.stopAt = 'after_assess';
  const o = await create(makeOrder());
  __test.stopAt = null;
  await putDoc('config/autoApproval', { enabled: false });
  await ageLedger(o.id, 120_000);
  await runCron(env());
  assert.equal((await outcome(o.id)).outcome, 'disabled');
  assert.equal((await ledger(o.id)).decision, 'pending');
  assert.equal(await productStock('p-simple'), 10);
  assert.deepEqual(buttons(tgSends(o.id)[0]), [`v1:acc:${o.id}`, `v1:rej:${o.id}`]);
});

test('B16 10 orders stuck at once: the cron finishes SEVERAL per run inside the subrequest budget (overlapping runs too) — each deducted once, ONE message each, none lost', async () => {
  __test.stopAt = 'after_assess';
  const orders = Array.from({ length: 10 }, () => makeOrder({ items: [line('p-hundred', 1)] }));
  await Promise.all(orders.map((o) => create(o)));
  __test.stopAt = null;
  for (const o of orders) assert.equal((await outcome(o.id)).state, 'queued');
  assert.equal(await productStock('p-hundred'), 100, 'nothing deducted yet');
  for (const o of orders) await ageLedger(o.id, 120_000);
  logs.length = 0;
  let runs = 0;
  // two cron invocations at the same time each round (Cloudflare may overlap them)
  while (runs < 20) {
    const left = (await Promise.all(orders.map((o) => outcome(o.id)))).filter((a) => a.state === 'queued').length;
    if (!left) break;
    await Promise.all([runCron(env()), runCron(env())]);
    runs += 2;
  }
  const states = await Promise.all(orders.map((o) => outcome(o.id)));
  assert.ok(states.every((a) => a.state === 'done' && a.outcome === 'auto_accepted' && a.recovered === true), JSON.stringify(states.map((a) => a.outcome)));
  assert.equal(await productStock('p-hundred'), 90, 'exactly 10 pieces, one per order');
  for (const o of orders) assert.equal(tgSends(o.id).length, 1, `one message for ${o.id}`);
  const runLogs = logs.filter((l) => l.includes('"event":"cron.notify"')).map((l) => JSON.parse(l));
  assert.ok(runLogs.length > 0);
  assert.ok(runLogs.every((r) => r.subrequests <= r.budget), `budget respected: ${JSON.stringify(runLogs.map((r) => r.subrequests))}`);
  assert.ok(runLogs.some((r) => r.orders > 1), 'several orders in one run');
  assert.ok(runs <= 12, `bounded number of runs (${runs})`);
});

test('B17 a pending order\'s Telegram message is NEVER dropped: after the retries it is retried slowly, and sent once Telegram works again', async () => {
  mock.state.failAlways.telegram = true;
  const o = await create(makeOrder({ payment: 'cliq' }), env({ NOTIFY_MAX_ATTEMPTS: '2' })); // manual review, waits for an admin
  for (let i = 0; i < 4; i++) {
    await ageLedger(o.id, 120_000);
    await runCron(env({ NOTIFY_MAX_ATTEMPTS: '2', NOTIFY_EXHAUSTED_RETRY_MS: '0' }));
  }
  let L = await ledger(o.id);
  assert.equal(L.notifications.telegram.state, 'failed');
  assert.ok(L.notifications.telegram.attempts >= 2);
  assert.equal(L.notifyPending, true, 'still in the queue (an old behaviour would drop it after the attempts)');
  // the slow interval: right after a failure it is NOT retried on every run
  await runCron(env({ NOTIFY_MAX_ATTEMPTS: '2' }));
  L = await ledger(o.id);
  assert.ok(L.notifyNextAt.getTime() > Date.now() + 10 * 60_000, 'next try ~30 min later');
  // Telegram is back: the message goes out once
  mock.state.failAlways.telegram = false;
  await ageLedger(o.id, 120_000);
  await runCron(env({ NOTIFY_MAX_ATTEMPTS: '2', NOTIFY_EXHAUSTED_RETRY_MS: '0' }));
  L = await ledger(o.id);
  assert.equal(L.notifications.telegram.state, 'sent');
  assert.equal(tgSends(o.id).filter((c) => c.ok).length, 1, 'delivered exactly once');
  await runCron(env({ NOTIFY_MAX_ATTEMPTS: '2', NOTIFY_EXHAUSTED_RETRY_MS: '0' }));
  assert.equal((await ledger(o.id)).notifications.telegram.state, 'sent', 'not sent again');
});
