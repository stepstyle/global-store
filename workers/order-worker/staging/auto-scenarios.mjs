// Smart auto-approval scenarios C01–C13 in a REAL Worker runtime (workerd), shared by
//   - test/local-e2e/inner.mjs  (E2E_SUITE=auto: `wrangler dev --local`, notify sink, Turnstile mock, Firestore emulator)
//   - staging later (needs a separate approval to deploy)
// The Worker runs with AUTO_APPROVAL_MODE=on, Telegram approval on, Turnstile ENFORCE. Telegram is the notify sink,
// which records the method, message id, button data, decision line and the auto line ('auto' | 'review') — no
// personal data. Stops of the Worker are simulated (local build only) with the order note "__e2e_stop:<point>".
//
// ctx = { W, S, sinkAuth, get(path), reseed(), turnstileToken, createBudget, webhookSecret, chatId, adminIds,
//         setStock(pid, vid, value), setAutoSwitch(enabled), triggerCron(), recoverWaitMs, projectId, label, only }

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { checkoutOrder, line } from '../test/fixtures.mjs';
import { MARKER_PATH } from './common.mjs';
import { makeCreateBudget, makeWaitFor } from './scenarios.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function buildAutoScenarios(ctx) {
  const { W, S, sinkAuth, get } = ctx;
  const ADMIN = String(ctx.adminIds[0]);
  const budget = makeCreateBudget(ctx.createBudget);
  const waitFor = makeWaitFor(ctx.notifyWaitMs ?? 20_000);
  let phoneN = Math.floor(Math.random() * 1000);
  const phone = () => `+96278${String(1_000_000 + (++phoneN % 8_999_999)).slice(0, 7)}`;

  const stock = async (pid, vid) => {
    const p = await get(`products/${pid}`);
    return vid ? (p?.variants || []).find((v) => v.id === vid)?.stock : p?.stock;
  };
  const order = ({ items, payment = 'cod', ph = phone(), note } = {}) => {
    const o = checkoutOrder({ ...(items ? { items } : {}), payment, ...(note ? { overrides: { note } } : {}) });
    o.address = { ...o.address, phone: ph };
    return o;
  };
  const send = async (o, { token = ctx.turnstileToken, budgeted = true } = {}) => {
    if (budgeted) await budget.take(1);
    const r = await fetch(`${W}/create-order`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order: o, ...(token ? { turnstileToken: token } : {}) }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const create = async (o) => {
    const r = await send(o);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return o;
  };
  const calls = async (signal) => (await (await fetch(`${S}/calls`, { headers: sinkAuth, signal })).json()).calls || [];
  const sends = async (id, signal) => (await calls(signal)).filter((c) => c.channel === 'telegram' && c.method === 'sendMessage' && c.orderId === id && c.ok);
  const messageOf = async (id) => {
    const m = await waitFor(async (signal) => (await sends(id, signal))[0]);
    assert.ok(m, `message for ${id}`);
    return m;
  };
  const review = async (id) => (await get(`orderLedger/${id}`))?.autoReview;
  const doneReview = async (id) => {
    const a = await waitFor(async () => { const r = await review(id); return r?.state === 'done' ? r : null; });
    assert.ok(a, `review of ${id} finished`);
    return a;
  };
  let seq = 0;
  const press = async (op, orderId, messageId) => {
    seq++;
    const r = await fetch(`${W}/telegram/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': ctx.webhookSecret },
      body: JSON.stringify({ update_id: 800000000 + seq, callback_query: { id: `cq-${seq}-${randomBytes(3).toString('hex')}`, from: { id: Number(ADMIN), is_bot: false }, message: { message_id: messageId, chat: { id: Number(ctx.chatId) } }, chat_instance: '1', data: `v1:${op}:${orderId}` } }),
    });
    assert.equal(r.status, 200);
  };
  /** cron until `done()` or the time is up; returns the number of cron triggers */
  const cronUntil = async (done, maxRuns = 15) => {
    let runs = 0;
    while (runs < maxRuns) {
      if (await done()) return runs;
      await ctx.triggerCron();
      runs++;
      await sleep(1500);
    }
    assert.ok(await done(), `finished within ${maxRuns} cron runs`);
    return runs;
  };

  return [
    ['C01', 'clean order: accepted AUTOMATICALLY — stock once, processing, one 🤖 message with only the cancel button', async () => {
      const o = await create(order());
      const m = await messageOf(o.id);
      assert.equal(m.auto, 'auto');
      assert.equal(m.decision, 'accepted');
      assert.deepEqual(m.buttons, [`v1:can:${o.id}`]);
      assert.equal((await review(o.id)).outcome, 'auto_accepted');
      assert.equal((await get(`orders/${o.id}`)).status, 'processing');
      assert.equal(await stock('p-simple'), 8);
      assert.equal(await stock('p-variants', 'var_red'), 4);
      await sleep(1500);
      assert.equal((await sends(o.id)).length, 1);
    }],

    ['C02', 'Turnstile missing / invalid (ENFORCE): the order is refused before anything is saved — never auto-accepted', async () => {
      for (const token of [null, 'not-a-valid-token']) {
        const o = order();
        const r = await send(o, { token });
        assert.equal(r.status, 403, JSON.stringify(r.body));
        assert.equal(r.body?.code, 'TURNSTILE_FAILED');
        assert.equal(await get(`orders/${o.id}`), null);
        assert.equal(await get(`orderLedger/${o.id}`), null);
      }
      assert.equal(await stock('p-simple'), 10);
    }],

    ['C03', 'CliQ is never automatic: manual review, ⚠️ message with ✅/❌, nothing deducted', async () => {
      const o = await create(order({ payment: 'cliq' }));
      const m = await messageOf(o.id);
      assert.equal(m.auto, 'review');
      assert.equal(m.decision, 'pending');
      assert.deepEqual(m.buttons, [`v1:acc:${o.id}`, `v1:rej:${o.id}`]);
      assert.deepEqual((await review(o.id)).reasons.map((r) => r.code), ['CLIQ_NEEDS_VERIFICATION']);
      assert.equal(await stock('p-simple'), 10);
    }],

    ['C04', 'unusual quantity (6 of one product): manual review, nothing deducted', async () => {
      const o = await create(order({ items: [line('p-hundred', 6)] }));
      await messageOf(o.id);
      assert.ok((await review(o.id)).reasons.some((r) => r.code === 'LINE_QTY_HIGH'));
      assert.equal(await stock('p-hundred'), 100);
    }],

    ['C05', 'dashboard switch OFF: no automatic acceptance (normal message, nothing deducted); ON again: automatic again', async () => {
      await ctx.setAutoSwitch(false);
      const off = await create(order());
      const m = await messageOf(off.id);
      assert.equal(m.auto, null);
      assert.deepEqual(m.buttons, [`v1:acc:${off.id}`, `v1:rej:${off.id}`]);
      assert.equal((await review(off.id)).outcome, 'disabled');
      assert.equal(await stock('p-simple'), 10);
      await ctx.setAutoSwitch(true);
      const on = await create(order());
      assert.equal((await messageOf(on.id)).auto, 'auto');
      assert.equal(await stock('p-simple'), 8);
    }],

    ['C06', 'the same order sent 5× at once: ONE review, stock deducted once, ONE message', async () => {
      const o = order();
      await create(o);
      await budget.take(5);
      const rs = await Promise.all(Array.from({ length: 5 }, () => send(o, { budgeted: false })));
      for (const r of rs) assert.equal(r.body?.replay, true, JSON.stringify(r.body));
      await messageOf(o.id);
      await sleep(1500);
      assert.equal((await sends(o.id)).length, 1);
      assert.equal(await stock('p-simple'), 8);
    }],

    ['C07', 'two clean orders for the LAST piece at once: one automatic, the other manual review, never negative', async () => {
      const a = order({ items: [line('p-last-one', 1)] });
      const b = order({ items: [line('p-last-one', 1)] });
      await budget.take(2);
      const rs = await Promise.all([send(a, { budgeted: false }), send(b, { budgeted: false })]);
      for (const r of rs) assert.equal(r.status, 200);
      const outs = [(await doneReview(a.id)).outcome, (await doneReview(b.id)).outcome].sort();
      assert.deepEqual(outs, ['auto_accepted', 'manual_review']);
      assert.equal(await stock('p-last-one'), 0);
    }],

    ['C08', 'cancel an automatically accepted order: confirm pressed 3× at once -> stock restored ONCE', async () => {
      const o = await create(order());
      const m = await messageOf(o.id);
      assert.equal(await stock('p-simple'), 8);
      await press('can', o.id, m.messageId);
      await Promise.all([1, 2, 3].map(() => press('cfc', o.id, m.messageId)));
      assert.equal((await get(`orderLedger/${o.id}`)).decision, 'cancelled');
      assert.equal(await stock('p-simple'), 10);
      assert.equal(await stock('p-variants', 'var_red'), 5);
    }],

    ['C09', 'Worker stops after saving, before the review: order kept, no message; the cron finishes it — stock once, ONE message', async () => {
      const o = await create(order({ note: '__e2e_stop:after_assess' }));
      await sleep(1500);
      assert.equal((await review(o.id)).state, 'queued');
      assert.equal((await sends(o.id)).length, 0);
      assert.equal(await stock('p-simple'), 10);
      await sleep(ctx.recoverWaitMs);
      const runs = await cronUntil(async () => (await sends(o.id)).length > 0);
      const r = await review(o.id);
      assert.equal(r.outcome, 'auto_accepted');
      assert.equal(r.recovered, true);
      assert.equal(await stock('p-simple'), 8);
      await ctx.triggerCron();
      await sleep(1500);
      assert.equal((await sends(o.id)).length, 1, `one message (${runs} cron runs)`);
    }],

    ['C10', 'Worker stops AFTER the acceptance, before closing the review: recovery never deducts again', async () => {
      const o = await create(order({ note: '__e2e_stop:after_decide' }));
      await sleep(1500);
      assert.equal((await get(`orderLedger/${o.id}`)).decision, 'accepted');
      assert.equal((await review(o.id)).state, 'queued');
      assert.equal(await stock('p-simple'), 8);
      await sleep(ctx.recoverWaitMs);
      await cronUntil(async () => (await sends(o.id)).length > 0);
      assert.equal((await review(o.id)).outcome, 'auto_accepted');
      assert.equal(await stock('p-simple'), 8, 'still once');
      assert.equal((await sends(o.id)).length, 1);
    }],

    ['C11', '10 orders stuck at once: the cron finishes all of them within its budget — none lost, each deducted once, ONE message each', async () => {
      const os = Array.from({ length: 10 }, () => order({ items: [line('p-hundred', 1)], note: '__e2e_stop:after_assess' }));
      await budget.take(10);
      const rs = await Promise.all(os.map((o) => send(o, { budgeted: false })));
      for (const r of rs) assert.equal(r.status, 200, JSON.stringify(r.body));
      await sleep(1500);
      for (const o of os) assert.equal((await review(o.id)).state, 'queued');
      await sleep(ctx.recoverWaitMs);
      // a recovered order costs ~25 subrequests: inside the Workers Free budget (45 of 50) a run finishes ONE of them
      // (plain notification retries: 2–3 per run). Correctness is asserted; the number of runs is reported.
      const runs = await cronUntil(async () => (await Promise.all(os.map((o) => review(o.id)))).every((r) => r.state === 'done'), 14);
      await sleep(2000);
      for (const o of os) {
        assert.equal((await review(o.id)).outcome, 'auto_accepted');
        assert.equal((await sends(o.id)).length, 1, `one message for ${o.id}`);
      }
      assert.equal(await stock('p-hundred'), 90);
      return `${runs} cron runs for 10 stuck orders (free-plan budget)`;
    }],

    ['C12', 'same phone again within 24 h: manual review (not rejected)', async () => {
      const ph = phone();
      const a = await create(order({ ph }));
      assert.equal((await doneReview(a.id)).outcome, 'auto_accepted');
      const b = await create(order({ ph }));
      const r = await doneReview(b.id);
      assert.equal(r.outcome, 'manual_review');
      assert.ok(r.reasons.some((x) => x.code === 'DUPLICATE_PHONE'));
      assert.equal((await get(`orders/${b.id}`)).status, 'new');
    }],

    ['C13', 'never beyond "processing" automatically, even after cron runs', async () => {
      const o = await create(order());
      await messageOf(o.id);
      await ctx.triggerCron();
      await sleep(1500);
      assert.equal((await get(`orders/${o.id}`)).status, 'processing');
    }],
  ];
}

export async function runAutoScenarios(ctx) {
  const root = await (await fetch(`${ctx.W}/`)).json();
  assert.equal(root.ok, true, 'order Worker root');
  await ctx.reseed();
  const marker = await ctx.get(MARKER_PATH);
  if (!marker || marker.project !== ctx.projectId || marker.syntheticDataOnly !== true) throw new Error(`marker missing in ${ctx.projectId}`);
  const results = [];
  for (const [id, name, fn] of buildAutoScenarios(ctx)) {
    if (ctx.only && !ctx.only.has(id)) continue;
    await ctx.reseed();
    await ctx.setAutoSwitch(true);
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
  console.log(`\n${ctx.label}: ${results.length - failed}/${results.length} auto-approval scenarios passed`);
  return results;
}
