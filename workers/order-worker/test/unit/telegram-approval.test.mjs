import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFields, decodeFields } from '../../src/firestore.js';
import { decideOrder } from '../../src/approval.js';
import { parseOwnerCallback, handleTelegramWebhook } from '../../src/telegram-webhook.js';

const ID = 'ORD-ABCD1234-EFGH5678';
const SECRET = 'abcdefghijklmnopqrstuvwxyz1234567890ABCD';
const cfg = {
  stockOnApproval: true, maxBodyBytes: 32000,
  telegram: { token: 'FAKE_TEST_TOKEN', chatId: '6585888926', webhookSecret: SECRET },
  urls: { telegram: 'https://api.telegram.org' },
};

function createStore({ stock = 9, qty = 2, policy = 'on_accept' } = {}) {
  const data = new Map([
    ['orders/' + ID, {
      id: ID, status: 'new', stockApprovalRequired: true, seenByAdmin: false,
      items: [{ productId: 'p1', quantity: qty, selectedVariant: null }],
    }],
    ['orderLedger/' + ID, { stockPolicy: policy, stockApplied: false }],
    ['products/p1', { stock }],
  ]);
  const versions = new Map([...data.keys()].map((key) => [key, 1]));
  let commits = 0;
  function doc(key) {
    return data.has(key) ?
      { exists: true, fields: encodeFields(data.get(key)), updateTime: String(versions.get(key)) } :
      { exists: false };
  }
  const fs = {
    name(key) { return 'projects/demo/databases/(default)/documents/' + key; },
    get: async (key) => doc(key),
    batchGet: async (keys) => keys.map(doc),
    async commit(writes) {
      for (const w of writes) {
        const key = w.update.name.split('/documents/')[1];
        if (!data.has(key) || w.currentDocument.updateTime !== String(versions.get(key))) {
          return { ok: false, status: 409, data: { error: { status: 'FAILED_PRECONDITION' } } };
        }
      }
      for (const w of writes) {
        const key = w.update.name.split('/documents/')[1];
        const fields = decodeFields(w.update.fields);
        const obj = { ...data.get(key) };
        for (const field of w.updateMask.fieldPaths) obj[field] = fields[field];
        for (const transform of w.updateTransforms || []) obj[transform.fieldPath] = new Date();
        data.set(key, obj);
        versions.set(key, versions.get(key) + 1);
      }
      commits++;
      return { ok: true, status: 200 };
    },
  };
  return { fs, data, get commits() { return commits; } };
}

test('Telegram accept decreases stock ONLY at acceptance, once even on repeated click', async () => {
  const state = createStore();
  assert.equal(state.data.get('products/p1').stock, 9);
  const first = await decideOrder(state.fs, cfg, ID, 'accept');
  assert.deepEqual(first, { ok: true, code: 'ACCEPTED' });
  assert.equal(state.data.get('products/p1').stock, 7);
  assert.equal(state.data.get('orders/' + ID).status, 'processing');
  assert.equal(state.data.get('orderLedger/' + ID).stockApplied, true);
  assert.deepEqual(await decideOrder(state.fs, cfg, ID, 'accept'),
    { ok: true, code: 'ALREADY_ACCEPTED' });
  assert.equal(state.commits, 1);
  assert.equal(state.data.get('products/p1').stock, 7);
  assert.equal((await decideOrder(state.fs, cfg, ID, 'reject')).code, 'ALREADY_ACCEPTED');
});

test('reject cancels and never changes product stock', async () => {
  const state = createStore();
  assert.equal((await decideOrder(state.fs, cfg, ID, 'reject')).code, 'REJECTED');
  assert.equal(state.data.get('products/p1').stock, 9);
  assert.equal(state.data.get('orders/' + ID).status, 'cancelled');
  assert.equal((await decideOrder(state.fs, cfg, ID, 'accept')).code, 'ALREADY_REJECTED');
  assert.equal(state.commits, 1);
});

test('stock shortage leaves both order and inventory unchanged, no partial acceptance', async () => {
  const state = createStore({ stock: 1, qty: 2 });
  assert.equal((await decideOrder(state.fs, cfg, ID, 'accept')).code, 'STOCK_UNAVAILABLE');
  assert.equal(state.data.get('products/p1').stock, 1);
  assert.equal(state.data.get('orders/' + ID).status, 'new');
  assert.equal(state.commits, 0);
});

test('legacy order cannot be automatically approved (may already have decreased stock)', async () => {
  const state = createStore({ policy: 'legacy_unknown' });
  assert.equal((await decideOrder(state.fs, cfg, ID, 'accept')).code, 'LEGACY_ORDER');
  assert.equal(state.commits, 0);
});

function callback(fromId = 6585888926, chatId = 6585888926, action = 'accept') {
  return { callback_query: {
    id: 'test-callback', from: { id: fromId },
    message: { message_id: 15, text: 'New order', chat: { id: chatId, type: 'private' } },
    data: action + ':' + ID,
  } };
}

test('callback requires owner identity AND owner private chat, not only the order number', () => {
  assert.equal(parseOwnerCallback(callback(), cfg).action, 'accept');
  assert.equal(parseOwnerCallback(callback(123), cfg).unauthorized, true);
  assert.equal(parseOwnerCallback(callback(6585888926, 123), cfg).unauthorized, true);
  assert.equal(parseOwnerCallback(callback(6585888926, 6585888926, 'delete'), cfg).ignored, true);
  assert.equal(parseOwnerCallback({ message: { text: '/accept ' + ID } }, cfg).ignored, true);
});

test('invalid webhook secret is rejected BEFORE accessing Firestore or contacting Telegram', async () => {
  const state = createStore();
  const request = new Request('https://example.test/telegram/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong' },
    body: JSON.stringify(callback()),
  });
  const result = await handleTelegramWebhook(request, state.fs, cfg);
  assert.equal(result.status, 403);
  assert.equal(state.commits, 0);
});

test('valid owner callback accepts once and returns Telegram acknowledgement', async () => {
  const state = createStore();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true };
  };
  try {
    for (let i = 0; i < 2; i++) {
      const request = new Request('https://example.test/telegram/webhook', {
        method: 'POST', headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': SECRET,
        },
        body: JSON.stringify(callback()),
      });
      const r = await handleTelegramWebhook(request, state.fs, cfg);
      assert.equal(r.status, 200);
    }
    assert.equal(state.data.get('products/p1').stock, 7);
    assert.equal(state.commits, 1);
    assert.ok(calls.some((c) => c.url.endsWith('/answerCallbackQuery')));
    assert.ok(calls.some((c) => c.url.endsWith('/editMessageText')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
