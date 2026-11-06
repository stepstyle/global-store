// Telegram webhook: authenticate Telegram's server secret AND the store owner's
// Telegram user+private chat ID before touching Firestore. Never use an order ID as auth.
import { timingSafeEqual, readJsonBody } from './http.js';
import { decideOrder } from './approval.js';
import { ORDER_ID_RE } from './validate.js';

async function telegramApi(cfg, method, body) {
  const res = await fetch(cfg.urls.telegram.replace(/\/+$/, '') + '/bot' +
    cfg.telegram.token + '/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

export function parseOwnerCallback(update, cfg) {
  const cb = update && update.callback_query;
  if (!cb || typeof cb !== 'object') return { ignored: true };
  const userId = String(cb.from && cb.from.id || '');
  const chat = cb.message && cb.message.chat;
  const chatId = String(chat && chat.id || '');
  if (!cfg.telegram.chatId || userId !== cfg.telegram.chatId ||
      chatId !== cfg.telegram.chatId || chat.type !== 'private') {
    return { ignored: true, unauthorized: true };
  }
  if (typeof cb.id !== 'string' || !cb.id || cb.id.length > 128 ||
      !Number.isInteger(cb.message.message_id)) return { ignored: true };
  const match = /^(accept|reject):(ORD-[A-Z0-9]{4,16}-[A-Z0-9]{4,16})$/.exec(cb.data || '');
  if (!match || !ORDER_ID_RE.test(match[2])) return { ignored: true };
  return { callbackId: cb.id, messageId: cb.message.message_id,
    messageText: String(cb.message.text || ''), action: match[1], orderId: match[2] };
}

const labels = {
  ACCEPTED: '✅ تم قبول الطلب وخصم الكمية من المخزون.',
  REJECTED: '❌ تم رفض الطلب دون خصم أي كمية.',
  ALREADY_ACCEPTED: '✅ الطلب مقبول مسبقًا، ولم يُخصم المخزون مرة ثانية.',
  ALREADY_REJECTED: '❌ الطلب مرفوض مسبقًا.',
  STOCK_UNAVAILABLE: '⚠️ الكمية غير كافية أو غير مسجّلة. لم يُقبل الطلب ولم يُخصم شيء.',
  LEGACY_ORDER: '⚠️ هذا طلب قديم؛ راجعه من لوحة الإدارة لتجنب خصم المخزون مرتين.',
  ALREADY_RESOLVED: '⚠️ حالة الطلب تغيرت مسبقًا. راجع لوحة الإدارة.',
  ORDER_NOT_FOUND: '⚠️ الطلب غير موجود.',
  CONCURRENT_UPDATE: '⚠️ حصل تعديل متزامن؛ حاول مجددًا.',
};

export async function handleTelegramWebhook(request, fs, cfg) {
  const secret = cfg.telegram.webhookSecret;
  if (!secret || secret.length < 32 || !cfg.stockOnApproval) {
    return { status: 503, body: { ok: false, code: 'WEBHOOK_NOT_CONFIGURED' } };
  }
  if (!timingSafeEqual(request.headers.get('x-telegram-bot-api-secret-token') || '', secret)) {
    return { status: 403, body: { ok: false, code: 'FORBIDDEN' } };
  }
  const { body, error } = await readJsonBody(request, cfg.maxBodyBytes);
  if (error) return { status: error, body: { ok: false, code: 'BAD_UPDATE' } };
  const cb = parseOwnerCallback(body, cfg);
  if (cb.ignored) return { status: 200, body: { ok: true, ignored: true } };
  const decision = await decideOrder(fs, cfg, cb.orderId, cb.action);
  const text = labels[decision.code] || '⚠️ تعذّر تحديث الطلب. حاول مرة ثانية.';
  // A database commit may have succeeded even if Telegram's reply fails. Never retry
  // the Firestore action just because answerCallbackQuery/editMessageText failed.
  try {
    await telegramApi(cfg, 'answerCallbackQuery', {
      callback_query_id: cb.callbackId, text, show_alert: !decision.ok,
    });
  } catch {}
  if (decision.ok) {
    try {
      const headline = decision.code === 'ACCEPTED' || decision.code === 'ALREADY_ACCEPTED'
        ? '\n\n✅ تم قبول الطلب — الكمية خُصمت مرة واحدة.'
        : '\n\n❌ تم رفض الطلب — لم يُخصم المخزون.';
      await telegramApi(cfg, 'editMessageText', {
        chat_id: cfg.telegram.chatId, message_id: cb.messageId,
        text: cb.messageText.slice(0, 3700) + headline,
        reply_markup: { inline_keyboard: [] },
      });
    } catch {}
  }
  return { status: 200, body: { ok: true, result: decision.code } };
}
