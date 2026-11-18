// src/services/adminOrders.ts — dashboard -> Worker status changes (fake fetch, no network).
//   node --test tests/unit/adminOrders.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWorkerManaged, inventoryState, canCancel, deleteBlockedReason, changeStatusViaWorker, messageFor, problemLineAr } from '../../src/services/adminOrders.ts';

const W = 'https://anta-order-v2.example.workers.dev';
const ID = 'ORD-ABCD1234-XYZ1';
const res = (status, body) => ({ status, text: async () => JSON.stringify(body) });
function deps(steps, { token = 'tok-1' } = {}) {
  const calls = [];
  const refreshes = [];
  return {
    calls, refreshes,
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      const s = steps[Math.min(calls.length - 1, steps.length - 1)];
      if (s === 'network') throw new TypeError('fetch failed');
      return s;
    },
    getIdToken: async (refresh) => { refreshes.push(refresh); return typeof token === 'function' ? token(refresh) : token; },
  };
}

test('which orders go through the Worker, and what the buttons allow', () => {
  const w = (status, state) => ({ status, inventory: { policy: 'on_delivery', state } });
  assert.equal(isWorkerManaged(w('new', 'reserved')), true);
  assert.equal(isWorkerManaged({ status: 'new' }), false, 'old site / v1 order');
  assert.equal(isWorkerManaged({ status: 'new', inventory: { policy: 'other' } }), false);
  assert.equal(inventoryState(w('new', 'reserved')), 'reserved');
  assert.equal(inventoryState(w('new', 'bogus')), null);
  assert.equal(canCancel(w('new', 'reserved')), true);
  assert.equal(canCancel(w('delivered', 'deducted')), true, 'return after delivery');
  assert.equal(canCancel({ status: 'delivered' }), false, 'legacy delivered: unchanged (no button)');
  assert.equal(canCancel(w('cancelled', 'released')), false);
  assert.match(deleteBlockedReason(w('processing', 'reserved')), /ألغِ الطلب أولًا/);
  assert.equal(deleteBlockedReason(w('cancelled', 'released')), null);
  assert.equal(deleteBlockedReason({ status: 'new' }), null);
});

test('success only when the Worker confirms THIS order and THIS status; the ID token is sent as Bearer', async () => {
  const d = deps([res(200, { ok: true, orderId: ID, status: 'delivered', result: 'changed', inventory: 'deducted' })]);
  const r = await changeStatusViaWorker(`${W}/`, ID, 'delivered', {}, d);
  assert.deepEqual(r, { ok: true, status: 'delivered', inventory: 'deducted', changed: true });
  assert.equal(d.calls[0].url, `${W}/admin/orders/${ID}/status`);
  assert.equal(d.calls[0].init.headers.authorization, 'Bearer tok-1');
  assert.deepEqual(d.calls[0].body, { status: 'delivered' });
  for (const bad of [
    res(200, { ok: true, orderId: 'ORD-OTHER111-XYZ1', status: 'delivered' }),
    res(200, { ok: true, orderId: ID, status: 'shipped' }),
    res(200, { ok: false }),
    { status: 200, text: async () => 'not json' },
  ]) {
    assert.equal((await changeStatusViaWorker(W, ID, 'delivered', {}, deps([bad]))).ok, false);
  }
});

test('a return sends confirmReturn only when explicitly confirmed', async () => {
  const d = deps([res(200, { ok: true, orderId: ID, status: 'cancelled', result: 'changed', inventory: 'restocked' })]);
  await changeStatusViaWorker(W, ID, 'cancelled', { confirmReturn: true }, d);
  assert.deepEqual(d.calls[0].body, { status: 'cancelled', confirmReturn: true });
  const d2 = deps([res(409, { ok: false, code: 'RETURN_CONFIRMATION_REQUIRED' })]);
  const r = await changeStatusViaWorker(W, ID, 'cancelled', { confirmReturn: 'yes' }, d2);
  assert.deepEqual(d2.calls[0].body, { status: 'cancelled' });
  assert.equal(r.code, 'RETURN_CONFIRMATION_REQUIRED');
});

test('refusals become clear Arabic messages; INSUFFICIENT_STOCK carries the lines', async () => {
  const problems = [{ index: 0, productId: 'p1', available: 2, requested: 3 }];
  const r = await changeStatusViaWorker(W, ID, 'delivered', {}, deps([res(409, { ok: false, code: 'INSUFFICIENT_STOCK', problems })]));
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, problems);
  assert.match(r.messageAr, /صحّح المخزون/);
  assert.match(messageFor('NOT_ADMIN'), /ليس مسؤولًا/);
  assert.match(messageFor('SOMETHING_NEW'), /لم يتغير شيء/);
  assert.equal((await changeStatusViaWorker(W, ID, 'delivered', {}, deps(['network']))).code, 'NETWORK');
});

test('ITEMS_MISSING (a product / colour / size is gone): clear message + one line per item with the reason', async () => {
  const problems = [
    { index: 0, productId: 'p1', variantId: null, reason: 'PRODUCT_NOT_FOUND' },
    { index: 1, productId: 'p2', variantId: 'red', reason: 'VARIANT_NOT_FOUND' },
    { index: 2, productId: 'p3', variantId: 'size_m', reason: 'DUPLICATE_VARIANT_ID' },
  ];
  const r = await changeStatusViaWorker(W, ID, 'delivered', {}, deps([res(409, { ok: false, code: 'ITEMS_MISSING', problems })]));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ITEMS_MISSING');
  assert.deepEqual(r.problems, problems);
  assert.match(r.messageAr, /لم تتغير الحالة ولا أي كمية/);
  assert.equal(problemLineAr(problems[0], 'دفتر'), '• دفتر: المنتج لم يعد موجودًا');
  assert.equal(problemLineAr(problems[1], 'قلم - أحمر'), '• قلم - أحمر: اللون/المقاس لم يعد موجودًا في المنتج');
  assert.match(problemLineAr(problems[2], 'قميص M'), /مكرر/);
  assert.equal(problemLineAr({ index: 0, available: 2, requested: 3 }, 'دفتر'), '• دفتر: المتوفر 2، المطلوب 3');
});

test('STOCK_UNTRACKED (no valid stock number for a product / colour / size): clear message + the item named', async () => {
  const problems = [{ index: 0, productId: 'p-sizes', variantId: 'size_m', reason: 'STOCK_UNTRACKED' }];
  const r = await changeStatusViaWorker(W, ID, 'delivered', {}, deps([res(409, { ok: false, code: 'STOCK_UNTRACKED', problems })]));
  assert.equal(r.code, 'STOCK_UNTRACKED');
  assert.deepEqual(r.problems, problems);
  assert.match(r.messageAr, /ليس له رقم مخزون صالح/);
  assert.match(r.messageAr, /لم تتغير الحالة ولا أي كمية/);
  assert.equal(problemLineAr(problems[0], 'قميص M'), '• قميص M: لا يوجد رقم مخزون صالح لهذا المنتج/اللون/المقاس');
});

test('expired token: refreshed ONCE and resent; no token at all: nothing sent', async () => {
  const d = deps([res(401, { ok: false, code: 'AUTH_EXPIRED' }), res(200, { ok: true, orderId: ID, status: 'shipped', result: 'changed', inventory: 'reserved' })], { token: (refresh) => (refresh ? 'fresh' : 'old') });
  const r = await changeStatusViaWorker(W, ID, 'shipped', {}, d);
  assert.equal(r.ok, true);
  assert.deepEqual(d.refreshes, [false, true]);
  assert.equal(d.calls[1].init.headers.authorization, 'Bearer fresh');
  const none = deps([res(200, {})], { token: null });
  const n = await changeStatusViaWorker(W, ID, 'shipped', {}, none);
  assert.equal(n.code, 'AUTH_REQUIRED');
  assert.equal(none.calls.length, 0);
});

test('no Worker URL (sandbox build): refused locally, nothing sent', async () => {
  const d = deps([res(200, {})]);
  assert.equal((await changeStatusViaWorker('', ID, 'delivered', {}, d)).code, 'NO_WORKER');
  assert.equal((await changeStatusViaWorker('javascript:alert(1)', ID, 'delivered', {}, d)).code, 'NO_WORKER');
  assert.equal(d.calls.length, 0);
});
