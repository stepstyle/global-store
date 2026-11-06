// Staging notification sink — stands in for Telegram + SendGrid in the staging environment.
//
// - Forwards NOTHING anywhere. Makes no outbound request at all.
// - Writes are authenticated: Telegram path token == SINK_TELEGRAM_TOKEN, SendGrid bearer == SINK_SENDGRID_KEY.
// - Reads/control are authenticated: x-sink-auth == SINK_READ_TOKEN.
// - Stores only a SUMMARY (order id, length, sha256, mismatch flag, warning codes, totals). Never stores
//   names, phones, addresses, e-mails, chat ids, tokens or headers. Records expire after 7 days.
// - Refuses to run unless SINK_ENVIRONMENT=staging and all three tokens are set, long and distinct.
// - Telegram order approval (Worker APPROVAL_MODE=telegram): also stands in for editMessageText,
//   editMessageReplyMarkup and answerCallbackQuery. Recorded: the method, the message id, the button callback data
//   (`v1:<op>:<order id>`, no personal data), the decision state line, and the callback answer text.

const MAX_BODY = 64 * 1024;
const MIN_TOKEN = 24;
const TTL_SECONDS = 7 * 24 * 3600;
const ORDER_ID_RE = /ORD-[A-Z0-9]{4,16}-[A-Z0-9]{4,16}/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a ?? ''));
  const y = new TextEncoder().encode(String(b ?? ''));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function sinkConfig(env = {}) {
  const errors = [];
  if (env.SINK_ENVIRONMENT !== 'staging') errors.push('SINK_ENVIRONMENT must be staging');
  const t = [env.SINK_TELEGRAM_TOKEN, env.SINK_SENDGRID_KEY, env.SINK_READ_TOKEN].map((v) => String(v ?? ''));
  if (t.some((v) => v.length < MIN_TOKEN)) errors.push(`all sink tokens must be >= ${MIN_TOKEN} chars`);
  if (new Set(t).size !== 3) errors.push('sink tokens must be distinct');
  if (!env.SINK_KV || typeof env.SINK_KV.put !== 'function') errors.push('SINK_KV binding missing');
  return { ok: errors.length === 0, errors };
}

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const money = (text, label) => {
  const m = text.match(new RegExp(`${label}: JOD (\\d+(?:\\.\\d+)?)`));
  return m ? Number(m[1]) : null;
};

const TG_METHODS = ['sendMessage', 'editMessageText', 'editMessageReplyMarkup', 'answerCallbackQuery'];
const CALLBACK_RE = /^v1:[a-z]{3}:ORD-[A-Z0-9]{4,16}-[A-Z0-9]{4,16}$/;
/** the inline buttons' callback data only (never their labels or anything else) */
export function buttonsOf(replyMarkup) {
  const rows = Array.isArray(replyMarkup?.inline_keyboard) ? replyMarkup.inline_keyboard : [];
  return rows.flat().map((b) => String(b?.callback_data || '')).filter((d) => CALLBACK_RE.test(d));
}
/** the order message's decision line (fixed texts of the Worker, no personal data) */
export function decisionOf(text) {
  const t = String(text || '');
  if (t.includes('بانتظار الموافقة')) return 'pending';
  if (t.includes('تم قبول الطلب')) return 'accepted';
  if (t.includes('تم رفض الطلب')) return 'rejected';
  if (t.includes('تم إلغاء الطلب بعد القبول')) return 'cancelled';
  return null;
}
const nextMessageId = () => 1 + Math.floor(Math.random() * 2_000_000_000);

/** Summary only — no personal data, no secrets. */
export async function summarize(channel, text) {
  const t = String(text || '');
  const warnLine = t.split('\n').find((l) => l.startsWith('⚠️ Warnings:')) || '';
  return {
    channel,
    at: new Date().toISOString(),
    orderId: (t.match(ORDER_ID_RE) || [])[0] || null,
    length: t.length,
    sha256: await sha256(t),
    priceMismatch: /PRICE MISMATCH/.test(t),
    warningCodes: [...new Set((warnLine.match(/[A-Z][A-Z_]{2,}/g) || []))],
    customerTotal: money(t, 'Total \\(customer saw\\)'),
    serverTotal: money(t, 'Total \\(server check\\)'),
  };
}

async function readBody(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY) return { error: 413 };
  const text = await request.text();
  if (text.length > MAX_BODY) return { error: 413 };
  try {
    return { body: JSON.parse(text || '{}') };
  } catch {
    return { error: 400 };
  }
}

async function shouldFail(kv, channel) {
  const raw = await kv.get('control');
  if (!raw) return false;
  const c = JSON.parse(raw);
  const n = Number(c?.failNext?.[channel] || 0);
  if (n <= 0) return false;
  c.failNext[channel] = n - 1;
  await kv.put('control', JSON.stringify(c), { expirationTtl: TTL_SECONDS });
  return true;
}

let seq = 0;
async function record(kv, rec) {
  // time + per-isolate sequence keeps records in arrival order even within the same millisecond
  seq = (seq + 1) % 1_000_000;
  const key = `call:${String(Date.now()).padStart(15, '0')}:${String(seq).padStart(6, '0')}:${crypto.randomUUID().slice(0, 8)}`;
  await kv.put(key, JSON.stringify(rec), { expirationTtl: TTL_SECONDS });
}

export default {
  async fetch(request, env) {
    const cfg = sinkConfig(env);
    if (!cfg.ok) return json({ ok: false, code: 'CONFIG_ERROR' }, 500);
    const kv = env.SINK_KV;
    const url = new URL(request.url);

    if (url.pathname === '/' && request.method === 'GET') {
      return json({ ok: true, service: 'notify-sink', environment: 'staging' });
    }

    // ---- Telegram stand-in -------------------------------------------------
    const tg = url.pathname.match(/^\/telegram\/bot([^/]+)\/([A-Za-z]+)$/);
    if (tg && TG_METHODS.includes(tg[2])) {
      if (request.method !== 'POST') return json({ ok: false }, 405);
      if (!safeEqual(decodeURIComponent(tg[1]), env.SINK_TELEGRAM_TOKEN)) return json({ ok: false, error_code: 401 }, 401);
      const { body, error } = await readBody(request);
      if (error) return json({ ok: false }, error);
      const method = tg[2];
      if (method === 'sendMessage') {
        const failed = await shouldFail(kv, 'telegram');
        const messageId = failed ? null : nextMessageId();
        await record(kv, { ...(await summarize('telegram', body.text)), method, messageId, buttons: buttonsOf(body.reply_markup), decision: decisionOf(body.text), ok: !failed });
        return failed ? json({ ok: false, error_code: 500 }, 500) : json({ ok: true, result: { message_id: messageId } });
      }
      const failed = await shouldFail(kv, 'tgui');
      if (method === 'answerCallbackQuery') {
        await record(kv, { channel: 'telegram-ui', method, at: new Date().toISOString(), callbackQueryId: String(body.callback_query_id || '').slice(0, 64), answer: String(body.text || '').slice(0, 200), alert: body.show_alert === true, ok: !failed });
      } else {
        const text = method === 'editMessageText' ? body.text : '';
        await record(kv, { channel: 'telegram-ui', method, at: new Date().toISOString(), orderId: method === 'editMessageText' ? (String(text).match(ORDER_ID_RE) || [])[0] || null : (buttonsOf(body.reply_markup)[0] || '').slice(7) || null, messageId: Number.isInteger(body.message_id) ? body.message_id : null, buttons: buttonsOf(body.reply_markup), decision: decisionOf(text), ok: !failed });
      }
      return failed ? json({ ok: false, error_code: 400, description: 'sink failure' }, 400) : json({ ok: true, result: true });
    }

    // ---- SendGrid stand-in -------------------------------------------------
    if (url.pathname === '/sendgrid/v3/mail/send') {
      if (request.method !== 'POST') return json({ errors: [] }, 405);
      const auth = request.headers.get('authorization') || '';
      if (!safeEqual(auth, `Bearer ${env.SINK_SENDGRID_KEY}`)) return json({ errors: [{ message: 'unauthorized' }] }, 401);
      const { body, error } = await readBody(request);
      if (error) return json({ errors: [] }, error);
      const text = Array.isArray(body.content) ? body.content.map((c) => c?.value || '').join('\n') : '';
      const failed = await shouldFail(kv, 'email');
      await record(kv, { ...(await summarize('email', text)), ok: !failed });
      return failed ? json({ errors: [{ message: 'sink failure' }] }, 500) : new Response(null, { status: 202 });
    }

    // ---- Test harness (read / control), authenticated ------------------------
    if (url.pathname === '/calls' || url.pathname === '/control') {
      if (!safeEqual(request.headers.get('x-sink-auth') || '', env.SINK_READ_TOKEN)) return json({ ok: false }, 401);

      if (url.pathname === '/calls' && request.method === 'GET') {
        const list = await kv.list({ prefix: 'call:', limit: 1000 });
        const calls = [];
        for (const k of list.keys) {
          const v = await kv.get(k.name);
          if (v) calls.push(JSON.parse(v));
        }
        return json({ ok: true, calls });
      }
      if (url.pathname === '/calls' && request.method === 'DELETE') {
        const list = await kv.list({ prefix: 'call:', limit: 1000 });
        for (const k of list.keys) await kv.delete(k.name);
        await kv.delete('control');
        return json({ ok: true, deleted: list.keys.length });
      }
      if (url.pathname === '/control' && request.method === 'POST') {
        const { body, error } = await readBody(request);
        if (error) return json({ ok: false }, error);
        const failNext = {
          telegram: Math.max(0, Math.min(10, Number(body?.failNext?.telegram || 0))),
          email: Math.max(0, Math.min(10, Number(body?.failNext?.email || 0))),
          tgui: Math.max(0, Math.min(10, Number(body?.failNext?.tgui || 0))),
        };
        await kv.put('control', JSON.stringify({ failNext }), { expirationTtl: TTL_SECONDS });
        return json({ ok: true, failNext });
      }
      return json({ ok: false }, 405);
    }

    return json({ ok: false, code: 'NOT_FOUND' }, 404);
  },
};
