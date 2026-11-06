// Notifications with "claim -> send -> mark" on orderLedger/{id}.notifications.<channel>.
// A channel is sent at most once in normal operation; a crash between send and mark can
// cause one duplicate after the lease expires (Telegram has no idempotency key).
//
// Cron: ONE order per run, taken from a queue ordered by orderLedger.notifyNextAt (oldest due first). After a run
// the order is moved behind every other due order (or removed from the queue when all its channels are done), so a
// failing message never blocks the others and an older order is never starved by newer ones. Channels stay
// independent: a channel is only marked 'sent' after the provider confirmed it (HTTP 2xx).

import { encodeFields, decodeFields } from './firestore.js';
import { log } from './http.js';

export const CHANNELS = ['telegram', 'email'];
const MAX_TEXT = 3900; // Telegram hard limit is 4096

export function initialNotifications(cfg) {
  const tg = cfg.telegram.token && cfg.telegram.chatId;
  const em = cfg.email.apiKey && cfg.email.to && cfg.email.from;
  return {
    telegram: { state: tg ? 'pending' : 'skipped', attempts: 0 },
    email: { state: em ? 'pending' : 'skipped', attempts: 0 },
  };
}

function eligible(st, cfg, now) {
  if (!st) return false;
  const attempts = Number(st.attempts || 0);
  if (attempts >= cfg.notifyMaxAttempts) return false;
  if (st.state === 'pending') return true;
  if (st.state === 'failed') return true;
  if (st.state === 'sending') {
    const lease = st.leaseUntil instanceof Date ? st.leaseUntil.getTime() : 0;
    return lease < now;
  }
  return false;
}

const isDone = (st, cfg) =>
  !st ||
  st.state === 'sent' ||
  st.state === 'skipped' ||
  (st.state === 'failed' && Number(st.attempts || 0) >= cfg.notifyMaxAttempts);

const fmt = (n) => (typeof n === 'number' && Number.isFinite(n) ? `JOD ${n.toFixed(2)}` : '—');

export function buildMessage(order, ledger, cfg) {
  const a = order.address || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const sp = ledger.serverPricing || {};
  const warnings = Array.isArray(ledger.warnings) ? ledger.warnings : [];

  const lines = [
    '🛒 New Order',
    '',
    `Order ID: ${order.id || ledger.orderId}`,
    `Customer: ${a.fullName || '—'}`,
    `Phone: ${a.phone || '—'}`,
    `City: ${a.city || '—'}`,
    `Street: ${a.street || '—'}`,
    `Payment: ${order.paymentMethod || '—'}${order.paymentDetails?.cliqReference ? ` (ref ${order.paymentDetails.cliqReference})` : ''}`,
    `Shipping: ${order.shippingMethod || order.shippingMethodId || '—'}`,
    '',
    'Items:',
    ...items.map((it, i) => `${i + 1}) ${it.name || it.productId} x${it.quantity} - ${fmt(it.price)}`),
    '',
    `Total (customer saw): ${fmt(order.total)}`,
    `Total (server check): ${fmt(sp.total)}`,
  ];
  if (ledger.priceMismatch) lines.push('⚠️ PRICE MISMATCH — verify the amount before confirming');
  if (warnings.length) {
    lines.push(`⚠️ Warnings: ${warnings.map((w) => (w.line !== undefined ? `${w.code}(item ${w.line + 1})` : w.code)).join(', ')}`);
  }
  if (order.note) lines.push('', `Note: ${order.note}`);
  if (cfg.adminBaseUrl) lines.push('', `Admin: ${cfg.adminBaseUrl.replace(/\/+$/, '')}/#/admin?orderId=${encodeURIComponent(order.id || '')}`);

  const text = lines.join('\n');
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/** A send may not outlive the claim's lease: aborted well before it expires (then marked failed, never sent). */
const sendSignal = (cfg) => AbortSignal.timeout(Math.max(1_000, Math.min(cfg.notifySendTimeoutMs ?? 15_000, Math.floor(cfg.leaseMs / 2))));

async function sendTelegram(cfg, text, orderId, canDecide = false) {
  const res = await fetch(`${cfg.urls.telegram.replace(/\/+$/, '')}/bot${cfg.telegram.token}/sendMessage`, {
    signal: sendSignal(cfg),
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.telegram.chatId, text, ...(orderId && canDecide ? { reply_markup: { inline_keyboard: [[{ text: '✅ قبول الطلب', callback_data: `accept:${orderId}` }, { text: '❌ رفض الطلب', callback_data: `reject:${orderId}` }]] } } : {}) }),
  });
  return { ok: res.ok, status: res.status };
}

async function sendEmail(cfg, orderId, text) {
  const res = await fetch(`${cfg.urls.sendgrid.replace(/\/+$/, '')}/v3/mail/send`, {
    signal: sendSignal(cfg),
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.email.apiKey}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: cfg.email.to }], subject: `New Order - ${orderId}` }],
      from: { email: cfg.email.from, name: cfg.email.fromName },
      content: [{ type: 'text/plain', value: text }],
    }),
  });
  return { ok: res.ok, status: res.status };
}

export async function processNotifications(fs, cfg, orderId) {
  const ledgerPath = `orderLedger/${orderId}`;
  for (const ch of CHANNELS) {
    const led = await fs.get(ledgerPath);
    if (!led.exists) return;
    const L = decodeFields(led.fields);
    const st = L.notifications?.[ch];
    const now = Date.now();
    if (!eligible(st, cfg, now)) continue;

    const attempts = Number(st.attempts || 0) + 1;
    // unique per claim: only the run that still holds THIS claim may record the result (see markOwned)
    const claimId = crypto.randomUUID();
    const claim = await fs.commit([
      {
        update: {
          name: fs.name(ledgerPath),
          fields: encodeFields({ notifications: { [ch]: { state: 'sending', attempts, leaseUntil: new Date(now + cfg.leaseMs), claimId } } }),
        },
        updateMask: { fieldPaths: [`notifications.${ch}`] },
        currentDocument: { updateTime: led.updateTime },
      },
    ]);
    if (!claim.ok) continue; // someone else claimed it

    let result;
    try {
      const orderDoc = await fs.get(`orders/${orderId}`);
      const order = orderDoc.exists ? decodeFields(orderDoc.fields) : { id: orderId };
      const text = buildMessage(order, L, cfg);
      result = ch === 'telegram' ? await sendTelegram(cfg, text, orderId, L.inventoryWorkflow === 'approval-v1' && L.stockDecision === 'pending') : await sendEmail(cfg, orderId, text);
    } catch (e) {
      result = { ok: false, status: 0 };
    }

    // 'sent' ONLY after the provider confirmed it; anything else (error, timeout, non-2xx) is 'failed' -> retried
    const mark = result.ok
      ? { state: 'sent', attempts, sentAt: new Date() }
      : { state: 'failed', attempts, lastStatus: result.status, failedAt: new Date() };
    const marked = await markOwned(fs, ledgerPath, ch, claimId, mark);
    log('notify', { orderId, channel: ch, ok: result.ok, status: result.status, attempts, marked });
  }

  const after = await fs.get(ledgerPath);
  if (!after.exists) return;
  const N = decodeFields(after.fields).notifications || {};
  const done = CHANNELS.every((c) => isDone(N[c], cfg));
  // done: leave the queue. Otherwise: due again, BEHIND every order that is already due (failures never block
  // others). Precondition: a newer write by another run (e.g. "done") is never overwritten by this stale view.
  const maxTried = CHANNELS.map((c) => Number(N[c]?.attempts || 0)).reduce((a, b) => Math.max(a, b), 0);
  const fields = done ? { notifyPending: false } : { notifyNextAt: new Date(Date.now() + retryDelay(cfg, maxTried)) };
  try {
    await fs.commit([
      {
        update: { name: fs.name(ledgerPath), fields: encodeFields(fields) },
        updateMask: { fieldPaths: done ? ['notifyPending', 'notifyNextAt'] : ['notifyNextAt'] },
        currentDocument: { updateTime: after.updateTime },
      },
    ]);
  } catch {
    // not fatal: the order stays due and is retried on a later run
  }
}

/**
 * Record a channel's result ONLY while this run still holds the claim (compare-and-set): read the ledger, check the
 * channel is still 'sending' with OUR claimId, write with that read's updateTime as precondition; retried on a
 * concurrent change or a transient error. If the lease expired and another run claimed the channel meanwhile, its
 * newer state is never overwritten ('lost' — the newer run records its own result).
 * Returns 'marked' | 'lost' | 'error'.
 */
async function markOwned(fs, ledgerPath, ch, claimId, mark) {
  for (let i = 0; i < 4; i++) {
    try {
      const cur = await fs.get(ledgerPath);
      if (!cur.exists) return 'lost';
      const st = decodeFields(cur.fields).notifications?.[ch];
      if (!st || st.state !== 'sending' || st.claimId !== claimId) return 'lost';
      const r = await fs.commit([
        {
          update: { name: fs.name(ledgerPath), fields: encodeFields({ notifications: { [ch]: mark } }) },
          updateMask: { fieldPaths: [`notifications.${ch}`] },
          currentDocument: { updateTime: cur.updateTime },
        },
      ]);
      if (r.ok) return 'marked';
      // precondition failed (another field/channel changed meanwhile): re-read and check ownership again
    } catch {
      // transient error: try again
    }
  }
  return 'error';
}

/** Extra wait before the next try (0 by default = the next cron run, behind the other due orders). */
function retryDelay(cfg, attempts) {
  const base = Number(cfg.notifyRetryBaseMs || 0);
  if (base <= 0) return 0;
  return Math.min(base * 2 ** Math.max(0, attempts - 1), 60 * 60 * 1000);
}

/**
 * Cron: process at most ONE order per run (bounded work per invocation). The oldest DUE order first
 * (notifyNextAt <= now, ascending: one range filter + order on the same field = Firestore's automatic single-field
 * index, no composite index). Ledgers written before notifyNextAt existed (notifyPending true, no notifyNextAt) are
 * picked up when nothing is due. Nothing is ever deleted from the queue without all channels being done.
 */
export async function retryPendingNotifications(fs, cfg) {
  const now = new Date();
  const due = await fs.runQuery({
    from: [{ collectionId: 'orderLedger' }],
    where: { fieldFilter: { field: { fieldPath: 'notifyNextAt' }, op: 'LESS_THAN_OR_EQUAL', value: { timestampValue: now.toISOString() } } },
    orderBy: [{ field: { fieldPath: 'notifyNextAt' }, direction: 'ASCENDING' }],
    limit: 1,
  });
  let id = due[0]?.name.split('/').pop();
  if (!id) {
    const legacy = await fs.runQuery({
      from: [{ collectionId: 'orderLedger' }],
      where: { fieldFilter: { field: { fieldPath: 'notifyPending' }, op: 'EQUAL', value: { booleanValue: true } } },
      limit: 10,
    });
    id = legacy.find((d) => d.fields?.notifyNextAt === undefined)?.name.split('/').pop();
  }
  if (!id) return 0;
  await processNotifications(fs, cfg, id);
  return 1;
}
