// End-to-end scenarios A01–A16: Telegram order approval (Worker APPROVAL_MODE=telegram). Shared by:
//   - test/local-e2e/inner.mjs   (E2E_SUITE=approval: real workerd via `wrangler dev --local`, notify sink, Firestore emulator)
//   - staging/run-tests.mjs      (--suite approval: deployed staging Workers + staging Firestore) — needs approval to deploy
//
// A button press is simulated EXACTLY as Telegram delivers it: POST <Worker>/telegram/webhook with the
// X-Telegram-Bot-Api-Secret-Token header and a callback_query update. The Telegram side (sendMessage / edit / answer)
// is the notify sink, which records the method, message id, button callback data and decision line (no personal data).
//
// ctx = {
//   W, S, sinkAuth, turnstileToken, projectId, label, only: Set|null,
//   get(path) -> decoded doc | null, reseed() -> Promise,
//   setStock(productId, variantId|null, value) -> Promise      // test-only stock change between creation and acceptance
//   seedLegacyOrder(order) -> Promise                          // an order WITHOUT ledger (old browser / Worker v1 path)
//   webhookSecret, chatId, adminIds: [a, b], outsiderId,
//   triggerCron?() -> Promise, skipCron, createBudget, notifyWaitMs
// }

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { checkoutOrder, line } from '../test/fixtures.mjs';
import { MARKER_PATH } from './common.mjs';
import { makeCreateBudget, makeWaitFor } from './scenarios.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the Worker's fixed callback answers (src/telegram.js ANSWER) — matched by prefix
const ANS = {
  accepted: '✅ تم قبول الطلب',
  rejected: '❌ تم رفض الطلب',
  cancelled: '↩️ تم إلغاء الطلب',
  alreadyAccepted: 'الطلب مقبول مسبقًا',
  alreadyRejected: 'الطلب مرفوض مسبقًا',
  alreadyCancelled: 'الطلب ملغى مسبقًا',
  cannot: 'لا يمكن القبول',
  denied: 'غير مصرح',
  invalid: 'طلب غير صالح',
  legacy: 'طلب قديم',
  confirm: 'اضغط «تأكيد الإلغاء»',
  back: 'تم التراجع',
};

export function buildApprovalScenarios(ctx) {
  const { W, S, sinkAuth, get } = ctx;
  const [ADMIN_A, ADMIN_B] = ctx.adminIds.map(String);
  const budget = makeCreateBudget(ctx.createBudget);
  const waitFor = makeWaitFor(ctx.notifyWaitMs ?? 20_000);

  const stock = async (pid, vid) => {
    const p = await get(`products/${pid}`);
    return vid ? (p?.variants || []).find((v) => v.id === vid)?.stock : p?.stock;
  };
  const create = async (order) => {
    await budget.take(1);
    const r = await fetch(`${W}/create-order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order, turnstileToken: ctx.turnstileToken }),
    });
    const body = await r.json().catch(() => null);
    assert.equal(r.status, 200, `create ${order.id}: ${r.status} ${JSON.stringify(body)}`);
    return body;
  };
  const calls = async (signal) => (await (await fetch(`${S}/calls`, { headers: sinkAuth, signal })).json()).calls || [];
  const sent = async (id, signal) => (await calls(signal)).filter((c) => c.channel === 'telegram' && c.method === 'sendMessage' && c.orderId === id && c.ok);
  /** waits for the order's approval message; returns its message id */
  const messageOf = async (id) => {
    const m = await waitFor(async (signal) => (await sent(id, signal))[0]);
    assert.ok(m, `approval message for ${id} reached Telegram (sink)`);
    return m;
  };

  let seq = 0;
  /** one button press, as Telegram sends it. Returns { status, cq } */
  const press = async (op, orderId, { from = ADMIN_A, chat = ctx.chatId, messageId, secret = ctx.webhookSecret, data } = {}) => {
    seq++;
    const cq = `cq-${Date.now().toString(36)}-${seq}-${randomBytes(3).toString('hex')}`;
    const update = {
      update_id: 900000000 + seq,
      callback_query: {
        id: cq,
        from: { id: Number(from), is_bot: false, first_name: 'Admin' },
        message: { message_id: messageId, chat: { id: Number(chat), type: 'supergroup' }, date: Math.floor(Date.now() / 1000) },
        chat_instance: '1',
        data: data ?? `v1:${op}:${orderId}`,
      },
    };
    const headers = { 'content-type': 'application/json' };
    if (secret !== null) headers['x-telegram-bot-api-secret-token'] = secret;
    const r = await fetch(`${W}/telegram/webhook`, { method: 'POST', headers, body: JSON.stringify(update) });
    return { status: r.status, cq, update };
  };
  /** the Worker's answer to one press (answerCallbackQuery recorded by the sink) */
  const answerOf = async (cq) => {
    const a = await waitFor(async (signal) => (await calls(signal)).find((c) => c.method === 'answerCallbackQuery' && c.callbackQueryId === cq), 10_000);
    assert.ok(a, `answer for ${cq}`);
    return a.answer;
  };
  const expectAnswer = async (p, prefix) => {
    assert.equal(p.status, 200, 'webhook answers 200 once authenticated');
    const a = await answerOf(p.cq);
    assert.ok(a.startsWith(prefix), `answer "${a}" should start with "${prefix}"`);
  };
  const lastEdit = async (id) => (await calls()).filter((c) => c.method === 'editMessageText' && c.orderId === id).pop();
  const state = async (id) => {
    const [o, l] = [await get(`orders/${id}`), await get(`orderLedger/${id}`)];
    return { status: o?.status, approval: o?.approval?.state, decision: l?.decision, by: l?.decidedBy?.userId, order: o, ledger: l };
  };
  const newOrder = async (items) => {
    const o = checkoutOrder(items ? { items } : {});
    await create(o);
    const m = await messageOf(o.id);
    return { o, id: o.id, mid: m.messageId, msg: m };
  };

  return [
    ['A01', 'new order: status new, NO stock change, one Telegram message with ✅/❌ buttons', async () => {
      const { o, msg } = await newOrder();
      const s = await state(o.id);
      assert.equal(s.status, 'new');
      assert.equal(s.approval, 'pending');
      assert.equal(s.ledger.stockPolicy, 'on_approval');
      assert.equal(s.decision, 'pending');
      assert.equal(await stock('p-simple'), 10, 'no deduction at creation');
      assert.equal(await stock('p-variants', 'var_red'), 5);
      assert.deepEqual(msg.buttons, [`v1:acc:${o.id}`, `v1:rej:${o.id}`]);
      assert.equal(msg.decision, 'pending');
      await sleep(1500);
      assert.equal((await sent(o.id)).length, 1, 'exactly one message for the order');
    }],

    ['A02', 'accept: stock deducted once on the right product/variant, status processing, admin + time recorded, message updated', async () => {
      const { id, mid } = await newOrder();
      const p = await press('acc', id, { messageId: mid });
      await expectAnswer(p, ANS.accepted);
      const s = await state(id);
      assert.equal(s.status, 'processing');
      assert.equal(s.approval, 'accepted');
      assert.equal(s.decision, 'accepted');
      assert.equal(s.by, ADMIN_A);
      assert.ok(s.ledger.decidedAt, 'decision time recorded');
      assert.equal(await stock('p-simple'), 8);
      assert.equal(await stock('p-variants', 'var_red'), 4);
      assert.equal(await stock('p-variants', 'var_blue'), 1, 'other variant untouched');
      assert.equal(await stock('p-variants'), 0, 'top-level stock of a variant product untouched');
      const e = await lastEdit(id);
      assert.equal(e?.decision, 'accepted');
      assert.deepEqual(e.buttons, [`v1:can:${id}`], 'only "cancel" left after acceptance');
    }],

    ['A03', 'repeated presses: 5 sequential + 5 parallel accepts + the SAME update re-delivered -> deducted exactly once', async () => {
      const { id, mid } = await newOrder();
      const first = await press('acc', id, { messageId: mid });
      await expectAnswer(first, ANS.accepted);
      for (let i = 0; i < 5; i++) await expectAnswer(await press('acc', id, { messageId: mid }), ANS.alreadyAccepted);
      const par = await Promise.all(Array.from({ length: 5 }, () => press('acc', id, { messageId: mid, from: ADMIN_B })));
      for (const p of par) await expectAnswer(p, ANS.alreadyAccepted);
      // Telegram re-delivers an update it got no 200 for: identical body
      const again = await fetch(`${W}/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': ctx.webhookSecret }, body: JSON.stringify(first.update) });
      assert.equal(again.status, 200);
      assert.equal(await stock('p-simple'), 8, 'still deducted once');
      assert.equal(await stock('p-variants', 'var_red'), 4);
    }],

    ['A04', 'reject: cancelled, NO stock change; accept after reject changes nothing', async () => {
      const { id, mid } = await newOrder();
      await expectAnswer(await press('rej', id, { messageId: mid }), ANS.rejected);
      let s = await state(id);
      assert.equal(s.status, 'cancelled');
      assert.equal(s.approval, 'rejected');
      assert.equal(s.decision, 'rejected');
      assert.equal(s.by, ADMIN_A);
      assert.equal(await stock('p-simple'), 10);
      assert.equal(await stock('p-variants', 'var_red'), 5);
      const e = await lastEdit(id);
      assert.equal(e?.decision, 'rejected');
      assert.deepEqual(e.buttons, [], 'buttons removed after a final decision');
      await expectAnswer(await press('acc', id, { messageId: mid }), ANS.alreadyRejected);
      await expectAnswer(await press('cfc', id, { messageId: mid }), ANS.alreadyRejected);
      s = await state(id);
      assert.equal(s.status, 'cancelled');
      assert.equal(await stock('p-simple'), 10);
    }],

    ['A05', 'cancel after accept: confirm step, back, confirm -> restored ONCE; repeated confirms restore nothing more', async () => {
      const { id, mid } = await newOrder();
      await expectAnswer(await press('acc', id, { messageId: mid }), ANS.accepted);
      assert.equal(await stock('p-simple'), 8);
      await expectAnswer(await press('can', id, { messageId: mid }), ANS.confirm);
      let ui = (await calls()).filter((c) => c.method === 'editMessageReplyMarkup' && c.messageId === mid).pop();
      assert.deepEqual(ui?.buttons, [`v1:cfc:${id}`, `v1:bck:${id}`], 'confirm + back shown');
      assert.equal((await state(id)).status, 'processing', '"cancel" alone changes nothing');
      await expectAnswer(await press('bck', id, { messageId: mid }), ANS.back);
      ui = (await calls()).filter((c) => c.method === 'editMessageReplyMarkup' && c.messageId === mid).pop();
      assert.deepEqual(ui?.buttons, [`v1:can:${id}`]);
      await expectAnswer(await press('cfc', id, { messageId: mid }), ANS.cancelled);
      const s = await state(id);
      assert.equal(s.status, 'cancelled');
      assert.equal(s.approval, 'cancelled');
      assert.equal(s.decision, 'cancelled');
      assert.equal(await stock('p-simple'), 10, 'restored');
      assert.equal(await stock('p-variants', 'var_red'), 5);
      const par = await Promise.all([1, 2, 3].map(() => press('cfc', id, { messageId: mid, from: ADMIN_B })));
      for (const p of par) await expectAnswer(p, ANS.alreadyCancelled);
      assert.equal(await stock('p-simple'), 10, 'never restored twice');
      assert.equal(await stock('p-variants', 'var_red'), 5);
    }],

    ['A06', 'two admins at the same moment: accept vs reject -> exactly one decision, stock consistent with it', async () => {
      const { id, mid } = await newOrder();
      const [a, b] = await Promise.all([press('acc', id, { messageId: mid, from: ADMIN_A }), press('rej', id, { messageId: mid, from: ADMIN_B })]);
      const answers = [await answerOf(a.cq), await answerOf(b.cq)];
      const s = await state(id);
      if (s.decision === 'accepted') {
        assert.ok(answers[0].startsWith(ANS.accepted) && answers[1].startsWith(ANS.alreadyAccepted), answers.join(' | '));
        assert.equal(await stock('p-simple'), 8);
      } else {
        assert.equal(s.decision, 'rejected');
        assert.ok(answers[1].startsWith(ANS.rejected) && answers[0].startsWith(ANS.alreadyRejected), answers.join(' | '));
        assert.equal(await stock('p-simple'), 10);
      }
    }],

    ['A07', 'two pending orders for the LAST piece accepted at the same time -> one accepted, the other refused and still pending, never negative', async () => {
      const one = await newOrder([line('p-last-one', 1)]);
      const two = await newOrder([line('p-last-one', 1)]);
      assert.equal(await stock('p-last-one'), 1, 'pending orders reserve nothing');
      const [a, b] = await Promise.all([press('acc', one.id, { messageId: one.mid }), press('acc', two.id, { messageId: two.mid, from: ADMIN_B })]);
      const answers = [await answerOf(a.cq), await answerOf(b.cq)];
      assert.equal(answers.filter((x) => x.startsWith(ANS.accepted)).length, 1, answers.join(' | '));
      assert.equal(answers.filter((x) => x.startsWith(ANS.cannot)).length, 1, answers.join(' | '));
      assert.equal(await stock('p-last-one'), 0);
      const states = [await state(one.id), await state(two.id)].map((s) => s.decision).sort();
      assert.deepEqual(states, ['accepted', 'pending']);
    }],

    ['A08', 'stock changed between order and acceptance: refused with nothing deducted; accepted after restock', async () => {
      const { id, mid } = await newOrder(); // p-simple x2 + var_red x1
      await ctx.setStock('p-simple', null, 1);
      const p = await press('acc', id, { messageId: mid });
      await expectAnswer(p, ANS.cannot);
      assert.ok((await answerOf(p.cq)).includes('STOCK_SHORTFALL'));
      let s = await state(id);
      assert.equal(s.decision, 'pending');
      assert.equal(s.status, 'new');
      assert.equal(await stock('p-simple'), 1, 'no partial deduction');
      assert.equal(await stock('p-variants', 'var_red'), 5, 'no partial deduction on the other line');
      await ctx.setStock('p-simple', null, 5);
      await expectAnswer(await press('acc', id, { messageId: mid }), ANS.accepted);
      s = await state(id);
      assert.equal(s.decision, 'accepted');
      assert.equal(await stock('p-simple'), 3);
      assert.equal(await stock('p-variants', 'var_red'), 4);
    }],

    ['A09', 'multi-line: the same variant on two lines is summed; shortfall across lines refuses the whole order', async () => {
      const ok = await newOrder([line('p-variants', 2, { variantId: 'var_red' }), line('p-variants', 2, { variantId: 'var_red' }), line('p-simple', 1)]);
      await expectAnswer(await press('acc', ok.id, { messageId: ok.mid }), ANS.accepted);
      assert.equal(await stock('p-variants', 'var_red'), 1, '5 - (2 + 2)');
      assert.equal(await stock('p-simple'), 9);
      const short = await newOrder([line('p-variants', 1, { variantId: 'var_blue' }), line('p-variants', 1, { variantId: 'var_blue' }), line('p-simple', 1)]);
      await expectAnswer(await press('acc', short.id, { messageId: short.mid }), ANS.cannot);
      assert.equal(await stock('p-variants', 'var_blue'), 1, 'var_blue has 1, the order needs 2: nothing taken');
      assert.equal(await stock('p-simple'), 9, 'the other line is not deducted either');
      assert.equal((await state(short.id)).decision, 'pending');
    }],

    ['A10', 'security: wrong/missing secret -> 401; unauthorised user or chat, forged data, GET -> nothing changes', async () => {
      const { id, mid } = await newOrder();
      assert.equal((await press('acc', id, { messageId: mid, secret: 'x'.repeat(48) })).status, 401);
      assert.equal((await press('acc', id, { messageId: mid, secret: null })).status, 401);
      await expectAnswer(await press('acc', id, { messageId: mid, from: ctx.outsiderId }), ANS.denied);
      await expectAnswer(await press('acc', id, { messageId: mid, chat: '-1000000000999' }), ANS.denied);
      for (const data of [`v1:acc:${id}x`, `v2:acc:${id}`, `v1:del:${id}`, `v1:acc:ORD-../../products`, 'x'.repeat(200)]) {
        await expectAnswer(await press('acc', id, { messageId: mid, data }), ANS.invalid);
      }
      assert.equal((await fetch(`${W}/telegram/webhook`)).status, 405);
      const s = await state(id);
      assert.equal(s.decision, 'pending');
      assert.equal(s.status, 'new');
      assert.equal(await stock('p-simple'), 10);
    }],

    ['A11', 'legacy order (no ledger: old browser / Worker v1 path): a forged accept is refused, never deducted', async () => {
      const o = checkoutOrder();
      await ctx.seedLegacyOrder(o);
      await expectAnswer(await press('acc', o.id, { messageId: 1 }), ANS.legacy);
      await expectAnswer(await press('cfc', o.id, { messageId: 1 }), ANS.legacy);
      await expectAnswer(await press('can', o.id, { messageId: 1 }), ANS.legacy);
      assert.equal((await get(`orders/${o.id}`)).status, 'new');
      assert.equal(await stock('p-simple'), 10);
    }],

    ['A12', 'the same order sent again (customer retry / double tap) -> ONE order, ONE Telegram message', async () => {
      const o = checkoutOrder();
      await create(o);
      const again = await Promise.all([1, 2, 3].map(async () => {
        await budget.take(1);
        const r = await fetch(`${W}/create-order`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order: o, turnstileToken: ctx.turnstileToken }) });
        return r.json();
      }));
      for (const b of again) assert.equal(b.replay, true, JSON.stringify(b));
      await messageOf(o.id);
      await sleep(3000);
      assert.equal((await sent(o.id)).length, 1, 'one message for one order');
    }],

    ['A13', 'a failing Telegram edit never undoes the decision; the next press repairs the message', async () => {
      const { id, mid } = await newOrder();
      await fetch(`${S}/control`, { method: 'POST', headers: { ...sinkAuth, 'content-type': 'application/json' }, body: JSON.stringify({ failNext: { tgui: 1 } }) });
      const p = await press('acc', id, { messageId: mid });
      assert.equal(p.status, 200);
      assert.equal((await state(id)).decision, 'accepted', 'decision stored although the edit failed');
      assert.equal(await stock('p-simple'), 8);
      await expectAnswer(await press('acc', id, { messageId: mid }), ANS.alreadyAccepted);
      const e = await lastEdit(id);
      assert.equal(e?.ok, true);
      assert.equal(e.decision, 'accepted', 'message repaired to the real state');
      assert.equal(await stock('p-simple'), 8);
    }],

    ['A14', 'Telegram down at order time: order stays pending (no stock change) and the cron re-sends the message WITH buttons', async () => {
      if (ctx.skipCron || !ctx.triggerCron) return 'skipped (no cron trigger)';
      await fetch(`${S}/control`, { method: 'POST', headers: { ...sinkAuth, 'content-type': 'application/json' }, body: JSON.stringify({ failNext: { telegram: 1 } }) });
      const o = checkoutOrder();
      await create(o);
      await sleep(2000);
      assert.equal((await sent(o.id)).length, 0, 'first send failed');
      assert.equal(await stock('p-simple'), 10);
      const m = await waitFor(async (signal) => {
        await ctx.triggerCron();
        return (await sent(o.id, signal))[0];
      }, ctx.cronWaitMs ?? 60_000, 2_000);
      assert.ok(m, 'cron re-sent the approval message');
      assert.deepEqual(m.buttons, [`v1:acc:${o.id}`, `v1:rej:${o.id}`]);
      await expectAnswer(await press('acc', o.id, { messageId: m.messageId }), ANS.accepted);
      assert.equal(await stock('p-simple'), 8);
    }],

    ['A15', 'tracking: the customer sees the decision (new -> processing / cancelled) through the status endpoint', async () => {
      const a = await newOrder();
      const r = await newOrder();
      // what the order-success / tracking pages call (public: { exists, status } only, no personal data)
      const st = async (id) => (await (await fetch(`${W}/orders/${id}/status`)).json());
      assert.equal((await st(a.id)).status, 'new');
      await expectAnswer(await press('acc', a.id, { messageId: a.mid }), ANS.accepted);
      await expectAnswer(await press('rej', r.id, { messageId: r.mid }), ANS.rejected);
      const sa = await st(a.id);
      const sr = await st(r.id);
      assert.equal(sa.status, 'processing', JSON.stringify(sa));
      assert.equal(sr.status, 'cancelled', JSON.stringify(sr));
      for (const b of [sa, sr]) assert.deepEqual(Object.keys(b).filter((k) => !['ok', 'exists', 'status'].includes(k)), [], 'nothing else exposed');
    }],

    ['A16', 'cancel before acceptance is impossible from Telegram (no restock of stock never taken)', async () => {
      const { id, mid } = await newOrder();
      await expectAnswer(await press('cfc', id, { messageId: mid }), 'الطلب لم يُقبل بعد');
      await expectAnswer(await press('can', id, { messageId: mid }), 'الطلب لم يُقبل بعد');
      const s = await state(id);
      assert.equal(s.decision, 'pending');
      assert.equal(await stock('p-simple'), 10, 'nothing "restored" either');
    }],
  ];
}

export async function runApprovalScenarios(ctx) {
  const root = await (await fetch(`${ctx.W}/`)).json();
  assert.equal(root.ok, true, 'order Worker root');
  await ctx.reseed();
  const marker = await ctx.get(MARKER_PATH);
  if (!marker || marker.project !== ctx.projectId || marker.syntheticDataOnly !== true) {
    throw new Error(`marker missing in ${ctx.projectId}: refusing to run scenarios`);
  }
  const results = [];
  for (const [id, name, fn] of buildApprovalScenarios(ctx)) {
    if (ctx.only && !ctx.only.has(id)) continue;
    await ctx.reseed();
    await fetch(`${ctx.S}/calls`, { method: 'DELETE', headers: ctx.sinkAuth });
    const t0 = Date.now();
    try {
      const note = await fn();
      results.push({ id, name, ok: true, ms: Date.now() - t0, ...(note ? { note } : {}) });
      console.log(`✔ ${id} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)${note ? ` — ${note}` : ''}`);
    } catch (e) {
      results.push({ id, name, ok: false, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 800) });
      console.log(`✖ ${id} ${name}\n    ${String(e?.message || e).split('\n')[0]}`);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${ctx.label}: ${results.length - failed}/${results.length} approval scenarios passed (project ${ctx.projectId})`);
  return results;
}
