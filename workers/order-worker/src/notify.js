// Notifications with "claim -> send -> mark" on orderLedger/{id}.notifications.<channel>.
// A channel is sent at most once in normal operation; a crash between send and mark can
// cause one duplicate after the lease expires (Telegram has no idempotency key).

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

async function sendTelegram(cfg, text) {
  const res = await fetch(`${cfg.urls.telegram.replace(/\/+$/, '')}/bot${cfg.telegram.token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.telegram.chatId, text }),
  });
  return { ok: res.ok, status: res.status };
}

async function sendEmail(cfg, orderId, text) {
  const res = await fetch(`${cfg.urls.sendgrid.replace(/\/+$/, '')}/v3/mail/send`, {
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
    const claim = await fs.commit([
      {
        update: {
          name: fs.name(ledgerPath),
          fields: encodeFields({ notifications: { [ch]: { state: 'sending', attempts, leaseUntil: new Date(now + cfg.leaseMs) } } }),
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
      result = ch === 'telegram' ? await sendTelegram(cfg, text) : await sendEmail(cfg, orderId, text);
    } catch (e) {
      result = { ok: false, status: 0 };
    }

    const mark = result.ok
      ? { state: 'sent', attempts, sentAt: new Date() }
      : { state: 'failed', attempts, lastStatus: result.status, failedAt: new Date() };
    await fs.commit([
      {
        update: { name: fs.name(ledgerPath), fields: encodeFields({ notifications: { [ch]: mark } }) },
        updateMask: { fieldPaths: [`notifications.${ch}`] },
      },
    ]);
    log('notify', { orderId, channel: ch, ok: result.ok, status: result.status, attempts });
  }

  const after = await fs.get(ledgerPath);
  if (!after.exists) return;
  const N = decodeFields(after.fields).notifications || {};
  if (CHANNELS.every((c) => isDone(N[c], cfg))) {
    await fs.commit([
      {
        update: { name: fs.name(ledgerPath), fields: encodeFields({ notifyPending: false }) },
        updateMask: { fieldPaths: ['notifyPending'] },
      },
    ]);
  }
}

export async function retryPendingNotifications(fs, cfg, limit = 25) {
  const docs = await fs.runQuery({
    from: [{ collectionId: 'orderLedger' }],
    where: { fieldFilter: { field: { fieldPath: 'notifyPending' }, op: 'EQUAL', value: { booleanValue: true } } },
    limit,
  });
  for (const d of docs) {
    const id = d.name.split('/').pop();
    await processNotifications(fs, cfg, id);
  }
  return docs.length;
}
