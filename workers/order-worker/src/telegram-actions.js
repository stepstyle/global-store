// Telegram order decisions. Never trust callback_data alone: authenticate the webhook
// and the Telegram sender, then commit the decision and stock changes atomically.
import { decodeFields, encodeFields, isConflict } from './firestore.js';
import { planInventory } from './inventory.js';
import { ORDER_ID_RE } from './validate.js';

const DATA_RE = /^(accept|reject):(ORD-[A-Z0-9]{4,16}-[A-Z0-9]{4,16})$/;
export function parseDecisionData(s) {
  const m = typeof s === 'string' ? s.match(DATA_RE) : null;
  return m ? { action: m[1], id: m[2] } : null;
}

export function secureEqual(a, b) {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false;
  let mismatch = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}

export function authorizedCallback(update, cfg) {
  const cb = update?.callback_query;
  const from = cb?.from?.id;
  const chat = cb?.message?.chat;
  return !!(
    cb?.id && Number.isSafeInteger(from) && chat?.type === 'private' &&
    String(from) === String(cfg.telegram.adminUserId || '') &&
    String(chat?.id) === String(cfg.telegram.chatId || '') &&
    String(from) === String(chat?.id) &&
    parseDecisionData(cb.data)
  );
}

function inventoryLines(order) {
  if (!Array.isArray(order.items) || order.items.length < 1 || order.items.length > 30) return null;
  const lines = [];
  for (const [index, it] of order.items.entries()) {
    const productId = it?.productId;
    const quantity = it?.quantity;
    if (typeof productId !== 'string' || !productId || productId.includes('/') ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return null;
    const variantId = it.selectedVariant?.id || null;
    if (variantId !== null && (typeof variantId !== 'string' || variantId.includes('/'))) return null;
    lines.push({ index, productId, variantId, quantity });
  }
  return lines;
}

/** Only new Worker-v2, stock-not-yet-applied orders are eligible.
 * Preconditions on the order, ledger and products make duplicate/concurrent clicks harmless.
 * Never accepts an old Worker-v1 order (it might already have deducted stock).
 */
export async function decideOrder(fs, cfg, orderId, action) {
  if (!ORDER_ID_RE.test(orderId) || !['accept', 'reject'].includes(action)) return { code: 'INVALID' };
  for (let attempt = 0; attempt < 5; attempt++) {
    const [od, ld] = await fs.batchGet([`orders/${orderId}`, `orderLedger/${orderId}`]);
    if (!od.exists || !ld.exists) return { code: 'NOT_FOUND' };
    const order = decodeFields(od.fields);
    const ledger = decodeFields(ld.fields);
    if (order.source !== 'worker-v2' || ledger.stockMode !== 'log' ||
        ledger.mode !== 'created' || ledger.orderId !== orderId ||
        (ledger.stockDeductions || []).some((d) => d.applied)) return { code: 'UNSUPPORTED_ORDER' };
    if (order.status !== 'new') return { code: 'ALREADY_DECIDED', status: order.status };
    if (ledger.decision?.state) return { code: 'ALREADY_DECIDED', status: ledger.decision.state };

    let stockWrites = [];
    let deductions = [];
    if (action === 'accept') {
      const lines = inventoryLines(order);
      if (!lines) return { code: 'INVALID_ITEMS' };
      const productIds = [...new Set(lines.map((line) => line.productId))];
      const docs = await fs.batchGet(productIds.map((id) => `products/${id}`));
      const products = new Map(productIds.map((id, i) => [id, docs[i]]));
      const inv = planInventory(lines, products, 'apply');
      // Fail closed for missing stock, ambiguous variants, shortages, or untracked products.
      if (inv.warnings.some((w) => !['STOCK_STRING_NORMALIZED'].includes(w.code)) ||
          inv.deductions.length !== lines.length ||
          inv.deductions.some((d) => d.applied !== true)) {
        return { code: 'STOCK_UNAVAILABLE' };
      }
      stockWrites = inv.writes;
      deductions = inv.deductions;
    }

    const now = new Date();
    const status = action === 'accept' ? 'processing' : 'cancelled';
    const writes = [
      {
        update: { name: fs.name(`orders/${orderId}`), fields: encodeFields({ status, updatedAt: now, seenByAdmin: true }) },
        updateMask: { fieldPaths: ['status', 'updatedAt', 'seenByAdmin'] },
        currentDocument: { updateTime: od.updateTime },
      },
      {
        update: { name: fs.name(`orderLedger/${orderId}`), fields: encodeFields({
          decision: { state: status, source: 'telegram', at: now },
          acceptedStockDeductions: deductions,
        }) },
        updateMask: { fieldPaths: ['decision', 'acceptedStockDeductions'] },
        currentDocument: { updateTime: ld.updateTime },
      },
      ...stockWrites.map((w) => ({
        update: { name: fs.name(`products/${w.productId}`), fields: w.fields },
        updateMask: { fieldPaths: w.mask },
        currentDocument: { updateTime: w.updateTime },
      })),
    ];
    const r = await fs.commit(writes);
    if (r.ok) return { code: 'OK', status, deductions };
    if (!isConflict(r)) return { code: 'STORE_ERROR' };
  }
  return { code: 'CONFLICT_RETRY' };
}

async function telegramApi(cfg, method, payload) {
  const r = await fetch(`${cfg.urls.telegram.replace(/\\/+$/, '')}/bot${cfg.telegram.token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.ok;
}

export async function handleTelegramWebhook(request, fs, cfg, maxBodyBytes) {
  const expected = cfg.telegram.webhookSecret;
  if (!expected || !cfg.telegram.adminUserId ||
      !secureEqual(request.headers.get('x-telegram-bot-api-secret-token'), expected)) {
    return new Response('Forbidden', { status: 403 });
  }
  const size = Number(request.headers.get('content-length') || 0);
  if (size > Math.min(maxBodyBytes, 16_384)) return new Response('Too large', { status: 413 });
  let update;
  try {
    const raw = await request.text();
    if (raw.length > 16_384) return new Response('Too large', { status: 413 });
    update = JSON.parse(raw);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const cb = update?.callback_query;
  if (!cb?.id) return new Response('OK', { status: 200 });
  if (!authorizedCallback(update, cfg)) {
    // Acknowledge invalid actors without exposing order details.
    await telegramApi(cfg, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'غير مصرح', show_alert: true });
    return new Response('OK', { status: 200 });
  }
  const decision = parseDecisionData(cb.data);
  const result = await decideOrder(fs, cfg, decision.id, decision.action);
  const messages = {
    OK: decision.action === 'accept' ? '✅ تم قبول الطلب وخصم المخزون' : '❌ تم رفض الطلب دون خصم',
    ALREADY_DECIDED: 'تم التعامل مع هذا الطلب سابقًا',
    STOCK_UNAVAILABLE: '⚠️ الكمية غير كافية أو المخزون غير مضبوط. لم يتم قبول الطلب',
    UNSUPPORTED_ORDER: 'الطلب قديم أو خُصم مخزونه سابقًا؛ راجعه من الإدارة',
    NOT_FOUND: 'الطلب غير موجود',
    INVALID_ITEMS: 'بيانات المنتجات غير صحيحة',
    STORE_ERROR: 'تعذّر حفظ القرار، حاول مجددًا',
    CONFLICT_RETRY: 'حدث تعارض، حاول مجددًا',
    INVALID: 'طلب غير صحيح',
  };
  const text = messages[result.code] || 'تعذّر إكمال الطلب';
  await telegramApi(cfg, 'answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: result.code !== 'OK' });
  if ((result.code === 'OK' || result.code === 'ALREADY_DECIDED') && cb.message?.message_id) {
    // Remove buttons after the first definitive decision; never delete the message.
    await telegramApi(cfg, 'editMessageReplyMarkup', {
      chat_id: cfg.telegram.chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] },
    });
  }
  return new Response('OK', { status: 200 });
}
