// Order Worker v2 (Phase 1 — compatible with the current Checkout.tsx).
//
// Routes
//   POST /create-order          create / adopt an order (idempotent, atomic stock)
//   GET  /orders/:id/status     { exists, status } only — no personal data
//   GET  /test                  Telegram test message      (x-worker-auth required)
//   POST /notify-order          resend notifications        (x-worker-auth required)
//   OPTIONS *                   CORS preflight (allow-listed origins only)
// Cron (scheduled): retry pending notifications; reconcile orphans (disabled by default).

import { loadConfig, WORKER_VERSION } from './config.js';
import { Firestore } from './firestore.js';
import { corsHeaders, json, readJsonBody, hasValidWorkerAuth, clientIp, log } from './http.js';
import { allowRequest } from './ratelimit.js';
import { createOrder, orderStatus, reconcileOrphans } from './orders.js';
import { processNotifications, retryPendingNotifications } from './notify.js';
import { ORDER_ID_RE } from './validate.js';

const STATUS_PATH = /^\/orders\/([^/]+)\/status$/;

async function verifyTurnstile(cfg, token, ip) {
  if (!token || !cfg.turnstileSecret) return false;
  try {
    const res = await fetch(cfg.urls.turnstile, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: cfg.turnstileSecret, response: String(token), remoteip: ip }),
    });
    const data = await res.json().catch(() => ({}));
    return data.success === true;
  } catch {
    return false;
  }
}

async function handle(request, env, ctx, cfg) {
  const url = new URL(request.url);
  const cors = corsHeaders(request, cfg);
  const reply = (body, status = 200) => json(body, status, cors);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const fs = new Firestore(cfg);
  const ip = clientIp(request);

  if (url.pathname === '/') return reply({ ok: true, service: 'order-worker', version: WORKER_VERSION });

  // ---------------- create order ----------------
  if (url.pathname === '/create-order') {
    if (request.method !== 'POST') return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    if (!(await allowRequest(env, cfg, 'create', ip))) return reply({ ok: false, code: 'RATE_LIMITED' }, 429);

    const { body, error } = await readJsonBody(request, cfg.maxBodyBytes);
    if (error === 413) return reply({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    if (error) return reply({ ok: false, code: 'INVALID_JSON' }, 400);

    if (cfg.turnstileMode !== 'off') {
      const token = body?.turnstileToken || request.headers.get('cf-turnstile-response');
      const passed = await verifyTurnstile(cfg, token, ip);
      if (!passed) {
        if (cfg.turnstileMode === 'enforce') return reply({ ok: false, code: 'TURNSTILE_FAILED' }, 403);
        log('turnstile.missing_or_invalid', { mode: cfg.turnstileMode });
      }
    }

    const rawOrder = body && typeof body === 'object' ? body.order ?? body : null;
    const r = await createOrder(fs, cfg, rawOrder, ctx);
    return reply(r.body, r.status);
  }

  // ---------------- order status ----------------
  const m = url.pathname.match(STATUS_PATH);
  if (m) {
    if (request.method !== 'GET') return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    if (!(await allowRequest(env, cfg, 'status', ip))) return reply({ ok: false, code: 'RATE_LIMITED' }, 429);
    let id;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      return reply({ ok: false, code: 'INVALID_ID' }, 400);
    }
    const r = await orderStatus(fs, id);
    return reply(r.body, r.status);
  }

  // ---------------- owner-only tools ----------------
  if (url.pathname === '/test') {
    if (request.method !== 'GET') return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    if (!hasValidWorkerAuth(request, cfg)) return reply({ ok: false, code: 'UNAUTHORIZED' }, 401);
    const res = await fetch(`${cfg.urls.telegram.replace(/\/+$/, '')}/bot${cfg.telegram.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegram.chatId, text: '✅ Worker v2 test message' }),
    });
    return reply({ ok: res.ok }, res.ok ? 200 : 502);
  }

  if (url.pathname === '/notify-order') {
    if (request.method !== 'POST') return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    if (!hasValidWorkerAuth(request, cfg)) return reply({ ok: false, code: 'UNAUTHORIZED' }, 401);
    const { body, error } = await readJsonBody(request, cfg.maxBodyBytes);
    if (error) return reply({ ok: false, code: 'INVALID_JSON' }, 400);
    const id = String(body?.orderId ?? body?.order?.id ?? '');
    if (!ORDER_ID_RE.test(id)) return reply({ ok: false, code: 'INVALID_ID' }, 400);
    await processNotifications(fs, cfg, id);
    return reply({ ok: true });
  }

  return reply({ ok: false, code: 'NOT_FOUND' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const cfg = loadConfig(env);
    if (!cfg.ok) {
      log('config.invalid', { errors: cfg.errors });
      return json({ ok: false, code: 'CONFIG_ERROR' }, 500);
    }
    try {
      return await handle(request, env, ctx, cfg);
    } catch (e) {
      log('request.error', { message: String(e?.message || e).slice(0, 200) });
      return json({ ok: false, code: 'INTERNAL' }, 500, corsHeaders(request, cfg));
    }
  },

  async scheduled(event, env, ctx) {
    const cfg = loadConfig(env);
    if (!cfg.ok) {
      log('config.invalid', { errors: cfg.errors });
      return;
    }
    const fs = new Firestore(cfg);
    const job = (async () => {
      const retried = await retryPendingNotifications(fs, cfg);
      const rec = await reconcileOrphans(fs, cfg);
      log('cron.done', { retried, reconcile: rec.enabled, processed: rec.processed, skipped: rec.skipped.length });
      return { retried, reconcile: rec };
    })();
    if (ctx?.waitUntil) ctx.waitUntil(job);
    return job;
  },
};
