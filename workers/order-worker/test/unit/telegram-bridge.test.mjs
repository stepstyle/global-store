// The live-test bridge's refusals (pure, no network): it must never run against the real store bot, a bot with a
// webhook, an unconfirmed bot, or another chat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertBridgeAllowed, rewriteOutgoing, BridgeRefused } from '../local-e2e/telegram-bridge.mjs';

const TOKEN = `123456789:${'A'.repeat(35)}`;
const ok = { token: TOKEN, me: { id: 123456789, username: 'dairsharaf_test_bot' }, webhookInfo: { url: '' }, chatId: '-1001112223334', confirm: 'dairsharaf_test_bot', forbidBotId: '987654321', expectBotId: '123456789' };
const SECRET = 's'.repeat(40);

test('bridge: a confirmed TEST bot without webhook, a test group and the real bot id excluded -> allowed', () => {
  process.env.E2E_TG_LOCAL_SECRET = SECRET;
  assert.deepEqual(assertBridgeAllowed(ok), { botId: '123456789', username: 'dairsharaf_test_bot' });
});

test('bridge: with the exact test bot allow-listed, the store bot id is an optional extra', () => {
  process.env.E2E_TG_LOCAL_SECRET = SECRET;
  assert.doesNotThrow(() => assertBridgeAllowed({ ...ok, forbidBotId: undefined }));
});

test('bridge: every unsafe setup is refused', () => {
  process.env.E2E_TG_LOCAL_SECRET = SECRET;
  const bad = {
    'username without "test" (the store bot)': { me: { id: 123456789, username: 'dairsharaf_bot' }, confirm: 'dairsharaf_bot' },
    'the forbidden real bot id': { forbidBotId: '123456789' },
    'no allow-listed test bot id': { expectBotId: undefined },
    'token of another bot than the allow-listed one': { expectBotId: '555555555' },
    'bot with a webhook': { webhookInfo: { url: 'https://example.invalid/hook' } },
    'not confirmed': { confirm: 'other_test_bot' },
    'private chat / bad chat id': { chatId: '12345' },
    'getMe of another bot': { me: { id: 5, username: 'x_test_bot' }, confirm: 'x_test_bot' },
    'not a token': { token: 'nope' },
  };
  for (const [label, o] of Object.entries(bad)) assert.throws(() => assertBridgeAllowed({ ...ok, ...o }), BridgeRefused, label);
  delete process.env.E2E_TG_LOCAL_SECRET;
  assert.throws(() => assertBridgeAllowed(ok), /E2E_TG_LOCAL_SECRET/);
  assert.doesNotThrow(() => assertBridgeAllowed({ ...ok, mode: 'check', chatId: undefined, confirm: undefined }), '--check needs no run settings');
});

test('bridge: only the four approval methods pass; the chat is forced to the test group', () => {
  assert.deepEqual(rewriteOutgoing('sendMessage', { chat_id: 42, text: 'x' }, '-1001112223334'), { chat_id: -1001112223334, text: 'x' });
  assert.equal(rewriteOutgoing('editMessageText', { chat_id: 1, message_id: 7 }, '-1001112223334').chat_id, -1001112223334);
  assert.deepEqual(rewriteOutgoing('answerCallbackQuery', { callback_query_id: 'q' }, '-100111'), { callback_query_id: 'q' });
  for (const m of ['setWebhook', 'deleteWebhook', 'getUpdates', 'sendDocument', 'leaveChat']) assert.throws(() => rewriteOutgoing(m, {}, '-100111'), BridgeRefused, m);
});
