// Order Worker v2 (Phase 1 — compatible with the current Checkout.tsx).
//
// Routes
//   POST /create-order          create / adopt an order (idempotent, atomic stock)
//   GET  /orders/:id/status     { exists, status } only — no personal data
//   GET  /test                  Telegram test message      (x-worker-auth required)
//   POST /notify-order          resend notifications        (x-worker-auth required)
//   POST /telegram/webhook      one-tap approve/reject       (Telegram secret + owner id)
//   OPTIONS *                   CORS preflight (allow-listed origins only)
// Cron (scheduled): retry pending notifications; reconcile orphans (disabled by default).

import { loadConfig, WORKER_VERSION } from './config.js';
import { Firestore } from './firestore.js';
import { corsHeaders, json, readJsonBody, hasValidWorkerAuth, stagingAccess, clientIp, log } from './http.js';
import { allowRequest } from './ratelimit.js';
import { createOrder, orderStatus, orderSummary, reconcileOrphans } from './orders.js';
import { processNotifications, retryPendingNotifications } from './notify.js';
import { ORDER_ID_RE } from './validate.js';
import { AuthError, bearerToken, verifyFirebaseIdToken } from './auth.js';
import { handleTelegramWebhook } from './telegram-webhook.js';

const STATUS_PATH = /^\/orders\/([^/]+)\/status$/;
const SUMMARY_PATH = /^\/orders\/([^/]+)\/summary$/;

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

  // STAGING ONLY: secret access gate in front of every route except the health check "/" — BEFORE the rate limit,
  // body, identity, Turnstile, Firestore, stock and notifications. No usable secret in the Worker = all refused.
  if (cfg.isStaging && url.pathname !== '/') {
    const gate = stagingAccess(request, cfg);
    if (!gate.ok) {
      log('staging_gate.denied', { reason: gate.reason });
      return reply({ ok: false, code: 'STAGING_ACCESS_DENIED' }, 403);
    }
  }

  const fs = new Firestore(cfg);
  const ip = clientIp(request);

  if (url.pathname === '/') return reply({ ok: true, service: 'order-worker', version: WORKER_VERSION });

  // Server-to-server Telegram webhook (secret header + private owner chat/user ID).
  if (url.pathname === '/telegram/webhook') {
    if (request.method !== 'POST') return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    const result = await handleTelegramWebhook(request, fs, cfg);
    return reply(result.body, result.status);
  }

  // ---------------- create order ----------------
  if (url.pathname === '/create-order') {
    if (request.method !== 'POST') return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    if (!(await allowRequest(env, cfg, 'create', ip))) return reply({ ok: false, code: 'RATE_LIMITED' }, 429);

    const { body, error } = await readJsonBody(request, cfg.maxBodyBytes);
    if (error === 413) return reply({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    if (error) return reply({ ok: false, code: 'INVALID_JSON' }, 400);

    // Customer identity: ONLY from a verified Firebase ID token. No header = guest (old site + guests keep working).
    // A header that is present but invalid/expired is an explicit 401 — never a silent fallback to guest.
    let auth = null;
    try {
      const token = bearerToken(request.headers.get('authorization'));
      if (token !== undefined) {
        const v = await verifyFirebaseIdToken(token, { projectId: cfg.projectId, jwksUrl: cfg.authJwksUrl });
        auth = { uid: v.uid };
      }
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      log('auth.rejected', { code: e.code, reason: e.reason });
      if (e.code === 'AUTH_UNAVAILABLE') return reply({ ok: false, code: 'AUTH_UNAVAILABLE' }, 503);
      return reply({ ok: false, code: e.code }, 401);
    }

    // after the identity check, so a 401 (refresh + resend) never burns a single-use Turnstile token
    if (cfg.turnstileMode !== 'off') {
      const token = body?.turnstileToken || request.headers.get('cf-turnstile-response');
      const passed = await verifyTurnstile(cfg, token, ip);
      if (!passed) {
        if (cfg.turnstileMode === 'enforce') return reply({ ok: false, code: 'TURNSTILE_FAILED' }, 403);
        log('turnstile.missing_or_invalid', { mode: cfg.turnstileMode });
      }
    }

    const rawOrder = body && typeof body === 'object' ? body.order ?? body : null;
    // tracking-key HASH chosen by the customer's browser (outside the order: not part of the payload hash)
    const r = await createOrder(fs, cfg, rawOrder, ctx, auth, { trackingKeyHash: body?.trackingKeyHash });
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

  // ---------------- order summary (tracking key or verified owner; no personal data) ----------------
  const sm = url.pathname.match(SUMMARY_PATH);
  if (sm) {
    if (request.method !== 'GET') return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    if (!(await allowRequest(env, cfg, 'status', ip))) return reply({ ok: false, code: 'RATE_LIMITED' }, 429);
    let id;
    try {
      id = decodeURIComponent(sm[1]);
    } catch {
      return reply({ ok: false, code: 'NOT_FOUND' }, 404);
    }
    // optional owner identity; an invalid token simply grants nothing (same 404 as every other refusal)
    let authUid = null;
    try {
      const token = bearerToken(request.headers.get('authorization'));
      if (token !== undefined) authUid = (await verifyFirebaseIdToken(token, { projectId: cfg.projectId, jwksUrl: cfg.authJwksUrl })).uid;
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
    }
    const r = await orderSummary(fs, id, { key: request.headers.get('x-tracking-key'), authUid });
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
