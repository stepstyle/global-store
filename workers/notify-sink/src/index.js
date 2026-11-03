// Staging notification sink — stands in for Telegram + SendGrid in the staging environment.
//
// - Forwards NOTHING anywhere. Makes no outbound request at all.
// - Writes are authenticated: Telegram path token == SINK_TELEGRAM_TOKEN, SendGrid bearer == SINK_SENDGRID_KEY.
// - Reads/control are authenticated: x-sink-auth == SINK_READ_TOKEN.
// - Stores only a SUMMARY (order id, length, sha256, mismatch flag, warning codes, totals). Never stores
//   names, phones, addresses, e-mails, chat ids, tokens or headers. Records expire after 7 days.
// - Refuses to run unless SINK_ENVIRONMENT=staging and all three tokens are set, long and distinct.

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
    const tg = url.pathname.match(/^\/telegram\/bot([^/]+)\/sendMessage$/);
    if (tg) {
      if (request.method !== 'POST') return json({ ok: false }, 405);
      if (!safeEqual(decodeURIComponent(tg[1]), env.SINK_TELEGRAM_TOKEN)) return json({ ok: false, error_code: 401 }, 401);
      const { body, error } = await readBody(request);
      if (error) return json({ ok: false }, error);
      const failed = await shouldFail(kv, 'telegram');
      await record(kv, { ...(await summarize('telegram', body.text)), ok: !failed });
      return failed ? json({ ok: false, error_code: 500 }, 500) : json({ ok: true, result: { message_id: Date.now() } });
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
        };
        await kv.put('control', JSON.stringify({ failNext }), { expirationTtl: TTL_SECONDS });
        return json({ ok: true, failNext });
      }
      return json({ ok: false }, 405);
    }

    return json({ ok: false, code: 'NOT_FOUND' }, 404);
  },
};
