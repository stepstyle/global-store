import test from 'node:test';
import assert from 'node:assert/strict';
import { decideOrder, parseDecisionData, secureEqual, authorizedCallback, handleTelegramWebhook } from '../../src/telegram-actions.js';
import { orderKeyboard } from '../../src/notify.js';
import { encodeFields, decodeFields } from '../../src/firestore.js';

const ID = 'ORD-ABCD1234-WXYZ5678';
const CFG = {
  telegram: { token: 'test-only', chatId: '12345', adminUserId: '12345', webhookSecret: 'test_webhook_secret_123' },
  urls: { telegram: 'https://api.telegram.org' }, maxBodyBytes: 32_768,
};

const seedOrder = (status = 'new') => ({
  id: ID, source: 'worker-v2', status,
  items: [{ productId: 'p1', quantity: 2, selectedVariant: null }],
});
const seedLedger = (stockMode = 'log') => ({
  orderId: ID, mode: 'created', stockMode, stockDeductions: [{ productId: 'p1', qty: 2, applied: false }],
});

class FakeFirestore {
  constructor(stock = 6, order = seedOrder(), ledger = seedLedger()) {
    this.docs = new Map();
    this.clock = 0;
    this.put(`orders/${ID}`, order);
    this.put(`orderLedger/${ID}`, ledger);
    this.put('products/p1', { stock });
  }
  name(p) { return p; }
  put(p, obj) { this.docs.set(p, { name: p, fields: encodeFields(obj), updateTime: String(++this.clock), exists: true }); }
  async batchGet(paths) { return paths.map(p => this.docs.get(p) || { exists: false }); }
  get(p) { return decodeFields(this.docs.get(p).fields); }
  async commit(writes) {
    for (const w of writes) {
      const cur = this.docs.get(w.update.name);
      if (w.currentDocument?.updateTime && cur?.updateTime !== w.currentDocument.updateTime) return { ok: false, data: { error: { status: 'FAILED_PRECONDITION' } } };
    }
    for (const w of writes) {
      const p = w.update.name;
      const cur = this.get(p);
      const changed = decodeFields(w.update.fields);
      for (const key of w.updateMask.fieldPaths) cur[key] = changed[key];
      this.put(p, cur);
    }
    return { ok: true };
  }
}
test('strict Telegram admin, secret and callback data', () => {
  assert.equal(secureEqual('abc', 'abc'), true);
  assert.equal(secureEqual('abc', 'abC'), false);
  assert.deepEqual(parseDecisionData(`accept:${ID}`), { action: 'accept', id: ID });
  assert.equal(parseDecisionData(`delete:${ID}`), null);
  const cb = { callback_query: { id: 'cb1', from: { id: 12345 }, message: { chat: { id: 12345, type: 'private' }, message_id: 5 }, data: `accept:${ID}` } };
  assert.equal(authorizedCallback(cb, CFG), true);
  assert.equal(authorizedCallback({ callback_query: { ...cb.callback_query, from: { id: 999 } } }, CFG), false);
  assert.equal(authorizedCallback({ callback_query: { ...cb.callback_query, message: { chat: { id: 12345, type: 'group' } } } }, CFG), false);
});
test('accept deducts stock exactly once, repeat click does not deduct', async () => {
  const fs = new FakeFirestore();
  assert.equal(fs.get('products/p1').stock, 6);
  const a = await decideOrder(fs, CFG, ID, 'accept');
  assert.equal(a.code, 'OK');
  assert.equal(fs.get('orders/' + ID).status, 'processing');
  assert.equal(fs.get('products/p1').stock, 4);
  const b = await decideOrder(fs, CFG, ID, 'accept');
  assert.equal(b.code, 'ALREADY_DECIDED');
  assert.equal(fs.get('products/p1').stock, 4);
});
test('reject marks cancelled without stock deduction', async () => {
  const fs = new FakeFirestore();
  assert.equal((await decideOrder(fs, CFG, ID, 'reject')).code, 'OK');
  assert.equal(fs.get('orders/' + ID).status, 'cancelled');
  assert.equal(fs.get('products/p1').stock, 6);
  assert.equal((await decideOrder(fs, CFG, ID, 'accept')).code, 'ALREADY_DECIDED');
});
test('insufficient / missing stock never accepts and never partially deducts', async () => {
  const fs = new FakeFirestore(1);
  assert.equal((await decideOrder(fs, CFG, ID, 'accept')).code, 'STOCK_UNAVAILABLE');
  assert.equal(fs.get('orders/' + ID).status, 'new');
  assert.equal(fs.get('products/p1').stock, 1);
});
test('legacy or previously applied stock is never deducted again', async () => {
  const fs = new FakeFirestore(6, seedOrder(), seedLedger('apply'));
  assert.equal((await decideOrder(fs, CFG, ID, 'accept')).code, 'UNSUPPORTED_ORDER');
  assert.equal(fs.get('products/p1').stock, 6);
});
test('only pending v2 log-mode orders receive buttons', () => {
  const keyboard = orderKeyboard(seedOrder(), seedLedger(), CFG);
  assert.equal(keyboard.inline_keyboard[0].length, 2);
  assert.equal(orderKeyboard(seedOrder('processing'), seedLedger(), CFG), undefined);
  assert.equal(orderKeyboard(seedOrder(), seedLedger('apply'), CFG), undefined);
  assert.equal(orderKeyboard(seedOrder(), seedLedger(), { telegram: { ...CFG.telegram, webhookSecret: '' } }), undefined);
});
test('forged webhook cannot mutate inventory; valid click can', async () => {
  const fs = new FakeFirestore();
  const req = (secret) => new Request('https://worker.example/telegram/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify({ callback_query: { id: 'cb1', from: { id: 12345 }, message: { chat: { id: 12345, type: 'private' }, message_id: 5 }, data: `accept:${ID}` } }),
  });
  assert.equal((await handleTelegramWebhook(req('wrong'), fs, CFG, 32_768)).status, 403);
  assert.equal(fs.get('products/p1').stock, 6);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  try {
    assert.equal((await handleTelegramWebhook(req(CFG.telegram.webhookSecret), fs, CFG, 32_768)).status, 200);
    assert.equal(fs.get('products/p1').stock, 4);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
