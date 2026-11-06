// Telegram: the order message (with decision buttons) and the webhook that turns a button press into an
// order decision (src/approval.js). Server-side only; the bot token never leaves the Worker.
//
// Webhook security
// - X-Telegram-Bot-Api-Secret-Token must equal TELEGRAM_WEBHOOK_SECRET (constant time) — set with setWebhook
//   secret_token; any other caller gets 401 and nothing is read
// - only callback_query updates; the PRESSING user must be in TELEGRAM_ADMIN_USER_IDS and the message must be in
//   TELEGRAM_CHAT_ID; callback_data is untrusted input: strict format, the order id is re-checked server-side and the
//   decision re-validated against Firestore (status, ledger, stock) — the button only says WHICH action was asked for
// - replay / double press / Telegram re-delivery: decisions are idempotent (orderLedger), nothing is applied twice
// - the answer to Telegram is 200 once authenticated, even when the decision fails (no retry storm); the admin sees
//   the reason in the callback answer and can press again
import { decodeFields } from './firestore.js';
import { timingSafeEqual, readJsonBody, log } from './http.js';
import { decideOrder } from './approval.js';
import { ORDER_ID_RE } from './validate.js';

const CB_RE = /^v1:(acc|rej|can|cfc|bck):(ORD-[A-Z0-9]{4,16}-[A-Z0-9]{4,16})$/; // ≤ 64 bytes (Telegram limit)
const MAX_TEXT = 3900;

// ------------------------------------------------------------------ message
const CURRENCY_AR = { JOD: 'د.أ' };
const money = (n, cur) => (typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(2)} ${CURRENCY_AR[cur] || cur}` : '—');
const PAYMENT_AR = { cod: 'الدفع عند الاستلام', cliq: 'CliQ (تحويل)' };
export const STATE_LINE = {
  pending: '⏳ حالة الطلب: بانتظار الموافقة',
  accepted: '✅ تم قبول الطلب وخصم المخزون',
  rejected: '❌ تم رفض الطلب (لم يُخصم أي مخزون)',
  cancelled: '↩️ تم إلغاء الطلب بعد القبول وإرجاع المخزون',
};

/** Arabic order message from TRUSTED data: server prices / names from the ledger; delivery details from the order. */
export function approvalText(order, ledger, cfg) {
  const a = order.address || {};
  const meta = order.addressMeta || {};
  const cur = cfg.currency || 'JOD';
  const sp = ledger.serverPricing || {};
  const lines = Array.isArray(ledger.approvalLines) ? ledger.approvalLines : [];
  const items = lines.map((l) => {
    const variant = l.variantLabel && l.variantLabel !== '.' ? ` (${l.variantLabel})` : '';
    return `- ${l.productName || l.productId}${variant}\n  الكمية: ${l.quantity} × ${money(l.unitPrice, cur)}`;
  });
  const decision = ledger.decision || 'pending';
  const who = ledger.decidedBy?.userId ? ` — بواسطة ${ledger.decidedBy.userId}` : '';
  const text = [
    '🛒 طلب جديد من مكتبة دير شرف العلمية',
    '',
    `رقم الطلب: ${order.id || ledger.orderId}`,
    '',
    `👤 اسم العميل: ${a.fullName || '—'}`,
    `📞 رقم الهاتف: ${a.phone || '—'}`,
    `📍 المحافظة والمنطقة: ${a.city || meta.citySlug || '—'}`,
    `🏠 عنوان التوصيل: ${a.street || '—'}`,
    '',
    '📦 المنتجات:',
    ...items,
    '',
    `🧾 المجموع الفرعي: ${money(sp.subtotal, cur)}`,
    ...(sp.discount ? [`🏷️ الخصم: ${money(sp.discount, cur)}`] : []),
    `🚚 تكلفة التوصيل: ${money(sp.shipping, cur)}`,
    `💰 إجمالي الطلب: ${money(sp.total, cur)}`,
    `💳 طريقة الدفع: ${PAYMENT_AR[order.paymentMethod] || order.paymentMethod || '—'}${order.paymentDetails?.cliqReference ? ` (مرجع ${order.paymentDetails.cliqReference})` : ''}`,
    ...(ledger.priceMismatch ? ['⚠️ اختلاف بين سعر العميل وسعر النظام — المعتمد سعر النظام أعلاه'] : []),
    ...(order.note ? ['', `📝 ملاحظة: ${order.note}`] : []),
    '',
    `${STATE_LINE[decision] || STATE_LINE.pending}${decision === 'pending' ? '' : who}`,
  ].join('\n');
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/** inline keyboard for the order's current decision state (none once final) */
export function keyboardFor(decision, orderId, { confirmCancel = false } = {}) {
  if (decision === 'pending') return { inline_keyboard: [[{ text: '✅ قبول الطلب', callback_data: `v1:acc:${orderId}` }, { text: '❌ رفض الطلب', callback_data: `v1:rej:${orderId}` }]] };
  if (decision === 'accepted') {
    return confirmCancel
      ? { inline_keyboard: [[{ text: '⚠️ تأكيد الإلغاء وإرجاع المخزون', callback_data: `v1:cfc:${orderId}` }], [{ text: '↩️ تراجع', callback_data: `v1:bck:${orderId}` }]] }
      : { inline_keyboard: [[{ text: '🚫 إلغاء الطلب (إرجاع المخزون)', callback_data: `v1:can:${orderId}` }]] };
  }
  return { inline_keyboard: [] };
}

// ------------------------------------------------------------------ Telegram Bot API (bounded, never throws)
export async function telegramCall(cfg, method, payload) {
  try {
    const res = await fetch(`${cfg.urls.telegram.replace(/\/+$/, '')}/bot${cfg.telegram.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Math.max(1_000, Math.min(cfg.notifySendTimeoutMs ?? 15_000, 15_000))),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok && data?.ok !== false, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

// ------------------------------------------------------------------ webhook
const ANSWER = {
  accepted: '✅ تم قبول الطلب وخصم المخزون',
  rejected: '❌ تم رفض الطلب',
  cancelled: '↩️ تم إلغاء الطلب وإرجاع المخزون',
  already_accepted: 'الطلب مقبول مسبقًا — لم يتغير شيء',
  already_rejected: 'الطلب مرفوض مسبقًا — لم يتغير شيء',
  already_cancelled: 'الطلب ملغى مسبقًا — لم يتغير شيء',
  not_accepted: 'الطلب لم يُقبل بعد',
  cannot_accept: 'لا يمكن القبول: المخزون غير كافٍ أو منتج غير متوفر. الطلب ما زال بانتظار القرار.',
  status_changed: 'تغيّرت حالة الطلب من مكان آخر — لم يُنفَّذ شيء',
  legacy: 'طلب قديم (نظام سابق) — يُدار من لوحة الإدارة، لم يُنفَّذ شيء',
  not_found: 'الطلب غير موجود',
  busy: 'ضغط متزامن كبير — أعد المحاولة',
  error: 'تعذّر تنفيذ العملية — لم يتغير شيء، أعد المحاولة',
};

/** Handles POST /telegram/webhook. Returns a Response. */
export async function handleTelegramWebhook(request, cfg, fs) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (cfg.approvalMode !== 'telegram') return json({ ok: false, code: 'NOT_FOUND' }, 404);
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
  const secret = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!cfg.telegram.webhookSecret || !timingSafeEqual(secret, cfg.telegram.webhookSecret)) {
    log('telegram.webhook_refused', { reason: secret ? 'bad_secret' : 'no_secret' });
    return json({ ok: false, code: 'UNAUTHORIZED' }, 401);
  }
  const { body, error } = await readJsonBody(request, 64 * 1024);
  if (error) return json({ ok: true }); // malformed: nothing to do (200 = no Telegram retry)

  const cq = body?.callback_query;
  if (!cq || typeof cq !== 'object') return json({ ok: true }); // other update types are ignored
  const answer = (text, alert = false) => telegramCall(cfg, 'answerCallbackQuery', { callback_query_id: String(cq.id || ''), text: text.slice(0, 190), show_alert: alert });

  const fromId = String(cq.from?.id ?? '');
  const chatId = String(cq.message?.chat?.id ?? '');
  const messageId = cq.message?.message_id;
  if (!cfg.telegram.adminUserIds.has(fromId) || chatId !== String(cfg.telegram.chatId)) {
    log('telegram.callback_refused', { reason: !cfg.telegram.adminUserIds.has(fromId) ? 'user' : 'chat' });
    await answer('غير مصرح لك بتنفيذ هذا الإجراء', true);
    return json({ ok: true });
  }
  const m = typeof cq.data === 'string' ? cq.data.match(CB_RE) : null;
  if (!m || !ORDER_ID_RE.test(m[2]) || !Number.isInteger(messageId)) {
    await answer('طلب غير صالح', true);
    return json({ ok: true });
  }
  const [, op, orderId] = m;

  // pure UI steps (no data change): ask for confirmation / go back
  if (op === 'can' || op === 'bck') {
    const led = await fs.get(`orderLedger/${orderId}`).catch(() => ({ exists: false }));
    const L = led.exists ? decodeFields(led.fields) : null;
    if (!L || L.stockPolicy !== 'on_approval') {
      await answer(L ? ANSWER.legacy : ANSWER.not_found, true);
      return json({ ok: true });
    }
    const decision = L.decision || 'pending';
    const confirm = op === 'can' && decision === 'accepted';
    await telegramCall(cfg, 'editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: keyboardFor(decision, orderId, { confirmCancel: confirm }) });
    await answer(op === 'bck' ? 'تم التراجع' : confirm ? 'اضغط «تأكيد الإلغاء» لإلغاء الطلب وإرجاع المخزون' : decision === 'pending' ? ANSWER.not_accepted : ANSWER[`already_${decision}`] || ANSWER.error, !confirm && op === 'can');
    return json({ ok: true });
  }

  const action = op === 'acc' ? 'accept' : op === 'rej' ? 'reject' : 'cancel';
  let out;
  try {
    out = await decideOrder(fs, cfg, { orderId, action, actor: { source: 'telegram', userId: fromId } });
  } catch (e) {
    log('telegram.decision_error', { orderId, action, message: String(e?.message || e).slice(0, 120) });
    out = { result: 'error' };
  }
  const ok = ['accepted', 'rejected', 'cancelled'].includes(out.result);
  // refresh the message to the order's REAL state (also after "already …": a lost edit is repaired by any press).
  // A failing edit never touches the data — Firestore already holds the decision.
  try {
    const [o, l] = await fs.batchGet([`orders/${orderId}`, `orderLedger/${orderId}`]);
    if (o.exists && l.exists) {
      const order = decodeFields(o.fields);
      const ledger = decodeFields(l.fields);
      if (ledger.stockPolicy === 'on_approval') {
        await telegramCall(cfg, 'editMessageText', { chat_id: chatId, message_id: messageId, text: approvalText(order, ledger, cfg), reply_markup: keyboardFor(ledger.decision || 'pending', orderId) });
      }
    }
  } catch {
    // not fatal
  }
  const extra = out.result === 'cannot_accept' && Array.isArray(out.problems) ? ` (${[...new Set(out.problems.map((p) => p.code))].join('، ')})` : '';
  await answer(`${ANSWER[out.result] || ANSWER.error}${extra}`, !ok);
  return json({ ok: true });
}
