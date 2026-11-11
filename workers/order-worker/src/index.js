// Order Worker v2 (Phase 1 — compatible with the current Checkout.tsx).
//
// Routes
//   POST /create-order          create / adopt an order (idempotent, atomic stock)
//   GET  /orders/:id/status     { exists, status } only — no personal data
//   POST /admin/orders/:id/status  dashboard status change; stock deducted on delivery (Firebase ID token of an admin)
//   POST /orders/:id/claim       link a guest order to the signed-in account (ID token + the order's tracking key)
//   GET  /wheel/state            prize wheel (WHEEL_MODE=test only; 404 when off): chances + stored results (ID token)
//   POST /wheel/spin             one server-side draw per chance, stored; a repeat returns the stored result (ID token)
//   POST /wheel/guest/spin|state the spin WITHOUT an account (random ticket from the browser; one result per ticket)
//   POST /wheel/guest/claim      the ticket's result becomes the signed-in account's welcome result (ID token)
//   POST /products/:id/ratings   recompute a product's rating figures from its published reviews (ID token)
//   GET  /test                  Telegram test message      (x-worker-auth required)
//   POST /notify-order          resend notifications        (x-worker-auth required)
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
import { handleTelegramWebhook } from './telegram.js';
import { requireAdmin } from './admin.js';
import { changeOrderStatus, syncDirectStatusChanges } from './fulfilment.js';
import { claimOrder } from './claims.js';
import { recomputeProductRating } from './ratings.js';
import { wheelState, wheelPublic, spinWheel, expireUnclaimedPrizes } from './wheel.js';
import { adminWheelGet, adminWheelSave, adminWheelSpins } from './wheel-admin.js';
import { guestSpin, guestState, claimGuest, releaseExpiredGuestHolds } from './wheel-guest.js';

const STATUS_PATH = /^\/orders\/([^/]+)\/status$/;
const ADMIN_STATUS_PATH = /^\/admin\/orders\/([^/]+)\/status$/;
const SUMMARY_PATH = /^\/orders\/([^/]+)\/summary$/;
const CLAIM_PATH = /^\/orders\/([^/]+)\/claim$/;
const RATINGS_PATH = /^\/products\/([^/]+)\/ratings$/;

/**
 * Server-side Turnstile check (the secret never leaves the Worker). false on: no token, invalid / reused token,
 * Cloudflare unreachable or slow (bounded wait), or — in production — a token issued for ANOTHER hostname than the
 * store's (Cloudflare's recommended hostname check). false never auto-accepts an order (enforce: refused; log: manual).
 */
export function turnstileResultOk(data, cfg) {
  if (data?.success !== true) return false;
  if (!cfg.isProd) return true; // test keys answer with a placeholder hostname
  const allowed = new Set((cfg.allowedOrigins || []).map((o) => { try { return new URL(o).hostname; } catch { return ''; } }).filter(Boolean));
  return typeof data.hostname === 'string' && allowed.has(data.hostname);
}

async function verifyTurnstile(cfg, token, ip) {
  if (!token || !cfg.turnstileSecret) return false;
  try {
    const res = await fetch(cfg.urls.turnstile, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: cfg.turnstileSecret, response: String(token), remoteip: ip }),
      signal: AbortSignal.timeout(5_000),
    });
    const data = await res.json().catch(() => ({}));
    const ok = turnstileResultOk(data, cfg);
    if (!ok && data?.success === true) log('turnstile.hostname_mismatch', {});
    return ok;
  } catch {
    return false;
  }
}

/** A VERIFIED Firebase identity from the Authorization header (required): { ok, uid } or { ok: false, code }. */
async function signedInUid(request, cfg) {
  try {
    const token = bearerToken(request.headers.get('authorization'));
    if (token === undefined) return { ok: false, code: 'AUTH_REQUIRED' };
    const v = await verifyFirebaseIdToken(token, { projectId: cfg.projectId, jwksUrl: cfg.authJwksUrl });
    return { ok: true, uid: v.uid, email: v.email, emailVerified: v.emailVerified === true, signInProvider: v.signInProvider };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, code: 'AUTH_INVALID' };
    throw e;
  }
}

/**
 * Before a draw: prizes whose 60-minute window passed without an order give their pool unit back NOW (a small page),
 * so an expired prize is never counted as held when the next visitor spins — the 5-minute cron does the rest. Each
 * release is one versioned commit: never twice. A failure here never blocks the spin.
 */
async function releaseLapsed(fs, cfg) {
  await Promise.all([
    expireUnclaimedPrizes(fs, cfg, { pageSize: 10, maxPages: 1 }).catch(() => null),
    releaseExpiredGuestHolds(fs, cfg, { pageSize: 10, maxPages: 1 }).catch(() => null),
  ]);
}

async function handle(request, env, ctx, cfg) {
  const url = new URL(request.url);
  const cors = corsHeaders(request, cfg);
  const reply = (body, status = 200) => json(body, status, cors);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  // Telegram order approval webhook: authenticated by its OWN secret (X-Telegram-Bot-Api-Secret-Token, see
  // src/telegram.js) — checked before the staging gate because Telegram cannot send x-staging-access.
  // 404 unless APPROVAL_MODE=telegram.
  if (url.pathname === '/telegram/webhook') return handleTelegramWebhook(request, cfg, new Firestore(cfg));

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
        auth = { uid: v.uid, signInProvider: v.signInProvider, googleLinked: v.googleLinked };
      }
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      log('auth.rejected', { code: e.code, reason: e.reason });
      if (e.code === 'AUTH_UNAVAILABLE') return reply({ ok: false, code: 'AUTH_UNAVAILABLE' }, 503);
      return reply({ ok: false, code: e.code }, 401);
    }
    // ORDER_SIGN_IN=google: no order without a VERIFIED Firebase token of an account linked to Google (signed claims:
    // sign_in_provider google.com, or identities['google.com']) — the same rule as the site (hasGoogleSession). Checked
    // before Turnstile (the single-use token is not burned) and before anything is read or written.
    if (cfg.orderSignIn === 'google') {
      if (!auth) return reply({ ok: false, code: 'SIGN_IN_REQUIRED' }, 401);
      if (!auth.googleLinked) return reply({ ok: false, code: 'GOOGLE_SIGN_IN_REQUIRED' }, 401);
    }

    // after the identity check, so a 401 (refresh + resend) never burns a single-use Turnstile token
    // turnstileVerified: TRUE only when Cloudflare verified THIS request's token (auto-approval needs it; 'log' mode
    // or a missing token = not verified = manual review)
    let turnstileVerified = false;
    if (cfg.turnstileMode !== 'off') {
      const token = body?.turnstileToken || request.headers.get('cf-turnstile-response');
      const passed = await verifyTurnstile(cfg, token, ip);
      turnstileVerified = passed === true;
      if (!passed) {
        if (cfg.turnstileMode === 'enforce') return reply({ ok: false, code: 'TURNSTILE_FAILED' }, 403);
        log('turnstile.missing_or_invalid', { mode: cfg.turnstileMode });
      }
    }

    const rawOrder = body && typeof body === 'object' ? body.order ?? body : null;
    // tracking-key HASH chosen by the customer's browser (outside the order: not part of the payload hash)
    // wheelSpinId: a prize won on the wheel (WHEEL_MODE=test); re-checked server-side against the verified account
    const r = await createOrder(fs, cfg, rawOrder, ctx, auth, { trackingKeyHash: body?.trackingKeyHash, wheelSpinId: body?.wheelSpinId ?? null, turnstileVerified });
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

  // ---------------- link a guest order to the signed-in account (tracking key = proof) ----------------
  const cm = url.pathname.match(CLAIM_PATH);
  if (cm) {
    if (request.method !== 'POST') return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    if (!(await allowRequest(env, cfg, 'status', ip))) return reply({ ok: false, code: 'RATE_LIMITED' }, 429);
    let id;
    try {
      id = decodeURIComponent(cm[1]);
    } catch {
      return reply({ ok: false, code: 'NOT_FOUND' }, 404);
    }
    const who = await signedInUid(request, cfg);
    if (!who.ok) return reply({ ok: false, code: who.code }, 401);
    const { body, error } = await readJsonBody(request, 1024);
    if (error === 413) return reply({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    const phoneLast4 = !error && body && typeof body === 'object' ? body.phoneLast4 : null;
    const r = await claimOrder(fs, { id, key: request.headers.get('x-tracking-key'), phoneLast4, uid: who.uid });
    return reply(r.body, r.status);
  }

  // ---------------- product ratings, computed from the published reviews (browsers cannot write them) ----------------
  const rm = url.pathname.match(RATINGS_PATH);
  if (rm) {
    if (request.method !== 'POST') return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    if (!(await allowRequest(env, cfg, 'status', ip))) return reply({ ok: false, code: 'RATE_LIMITED' }, 429);
    let id;
    try {
      id = decodeURIComponent(rm[1]);
    } catch {
      return reply({ ok: false, code: 'INVALID_ID' }, 400);
    }
    const who = await signedInUid(request, cfg);
    if (!who.ok) return reply({ ok: false, code: who.code }, 401);
    const r = await recomputeProductRating(fs, id);
    return reply(r.body, r.status);
  }

  // ---------------- prize wheel (TEST ONLY; WHEEL_MODE=off -> 404 before anything is read) ----------------
  // what a visitor sees (segments, terms) — no account needed, no weight / quantity / cost ever leaves the Worker
  if (url.pathname === '/wheel/public') {
    if (cfg.wheelMode === 'off') return reply({ ok: false, code: 'NOT_FOUND' }, 404);
    if (request.method !== 'GET') return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    if (!(await allowRequest(env, cfg, 'status', ip))) return reply({ ok: false, code: 'RATE_LIMITED' }, 429);
    const r = await wheelPublic(fs, cfg);
    return reply(r.body, r.status);
  }
  // admin: campaign settings + prize log (requireAdmin on EVERY call; 404 when the wheel is off)
  if (url.pathname === '/admin/wheel' || url.pathname === '/admin/wheel/campaign' || url.pathname === '/admin/wheel/spins') {
    if (cfg.wheelMode === 'off') return reply({ ok: false, code: 'NOT_FOUND' }, 404);
    const isSave = url.pathname === '/admin/wheel/campaign';
    if (request.method !== (isSave ? 'POST' : 'GET')) return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    if (!(await allowRequest(env, cfg, 'status', ip))) return reply({ ok: false, code: 'RATE_LIMITED' }, 429);
    const who = await requireAdmin(request, fs, cfg);
    if (!who.ok) return reply({ ok: false, code: who.code }, who.status);
    if (url.pathname === '/admin/wheel') { const r = await adminWheelGet(fs, cfg); return reply(r.body, r.status); }
    if (!isSave) {
      const r = await adminWheelSpins(fs, cfg, { limit: url.searchParams.get('limit'), status: url.searchParams.get('status') || '' });
      return reply(r.body, r.status);
    }
    const { body, error } = await readJsonBody(request, 32 * 1024);
    if (error === 413) return reply({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    if (error || !body || typeof body !== 'object') return reply({ ok: false, code: 'INVALID_JSON' }, 400);
    const r = await adminWheelSave(fs, cfg, body, who.uid);
    return reply(r.body, r.status);
  }
  // spin WITHOUT an account (owner's rule): the browser's random ticket names the stored result; the claim (signed in,
  // at checkout) makes it the account's welcome result. No Turnstile / no sign-in on the spin itself — see wheel-guest.js
  if (url.pathname === '/wheel/guest/spin' || url.pathname === '/wheel/guest/state' || url.pathname === '/wheel/guest/claim') {
    if (cfg.wheelMode === 'off') return reply({ ok: false, code: 'NOT_FOUND' }, 404);
    if (request.method !== 'POST') return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    const isState = url.pathname === '/wheel/guest/state';
    if (!(await allowRequest(env, cfg, isState ? 'status' : 'create', ip))) return reply({ ok: false, code: 'RATE_LIMITED' }, 429);
    const { body, error } = await readJsonBody(request, 1024);
    if (error === 413) return reply({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    if (error || !body || typeof body !== 'object') return reply({ ok: false, code: 'INVALID_JSON' }, 400);
    if (url.pathname === '/wheel/guest/spin') { await releaseLapsed(fs, cfg); const r = await guestSpin(fs, cfg, body.ticket, ip); return reply(r.body, r.status); }
    if (isState) { const r = await guestState(fs, cfg, body.ticket); return reply(r.body, r.status); }
    const who = await signedInUid(request, cfg);
    if (!who.ok) return reply({ ok: false, code: who.code }, 401);
    if (!who.emailVerified) return reply({ ok: false, code: 'WHEEL_ACCOUNT_NOT_VERIFIED' }, 403);
    const r = await claimGuest(fs, cfg, who.uid, body.ticket, { email: who.email });
    return reply(r.body, r.status);
  }
  if (url.pathname === '/wheel/state' || url.pathname === '/wheel/spin') {
    if (cfg.wheelMode === 'off') return reply({ ok: false, code: 'NOT_FOUND' }, 404);
    const isSpin = url.pathname === '/wheel/spin';
    if (request.method !== (isSpin ? 'POST' : 'GET')) return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    if (!(await allowRequest(env, cfg, isSpin ? 'create' : 'status', ip))) return reply({ ok: false, code: 'RATE_LIMITED' }, 429);
    const who = await signedInUid(request, cfg);
    if (!who.ok) return reply({ ok: false, code: who.code }, 401);
    if (!isSpin) {
      const r = await wheelState(fs, cfg, who.uid);
      return reply(r.body, r.status);
    }
    if (cfg.turnstileMode !== 'off') {
      const { body } = await readJsonBody(request, 4 * 1024);
      const passed = await verifyTurnstile(cfg, body?.turnstileToken || request.headers.get('cf-turnstile-response'), ip);
      if (!passed && cfg.turnstileMode === 'enforce') return reply({ ok: false, code: 'TURNSTILE_FAILED' }, 403);
    }
    // one obstacle to throw-away accounts (NOT proof of a unique person: one person can own several verified e-mails)
    if (!who.emailVerified) return reply({ ok: false, code: 'WHEEL_ACCOUNT_NOT_VERIFIED' }, 403);
    await releaseLapsed(fs, cfg);
    const r = await spinWheel(fs, cfg, who.uid, { email: who.email });
    return reply(r.body, r.status);
  }

  // ---------------- admin: order status (STOCK_POLICY=on_delivery orders) ----------------
  const am = url.pathname.match(ADMIN_STATUS_PATH);
  if (am) {
    if (request.method !== 'POST') return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    if (!(await allowRequest(env, cfg, 'status', ip))) return reply({ ok: false, code: 'RATE_LIMITED' }, 429);
    let id;
    try {
      id = decodeURIComponent(am[1]);
    } catch {
      return reply({ ok: false, code: 'INVALID_ID' }, 400);
    }
    if (!ORDER_ID_RE.test(id)) return reply({ ok: false, code: 'INVALID_ID' }, 400);
    // identity BEFORE the body is even read
    const who = await requireAdmin(request, fs, cfg);
    if (!who.ok) return reply({ ok: false, code: who.code }, who.status);
    const { body, error } = await readJsonBody(request, 4 * 1024);
    if (error === 413) return reply({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    if (error || !body || typeof body !== 'object') return reply({ ok: false, code: 'INVALID_JSON' }, 400);
    const r = await changeOrderStatus(fs, cfg, { orderId: id, status: String(body.status || ''), confirmReturn: body.confirmReturn === true, actor: { uid: who.uid } });
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
      // rollback safety net, off by default (SYNC_DIRECT_STATUS); a failure never blocks the notifications above
      const sync = await syncDirectStatusChanges(fs, cfg).catch((e) => ({ enabled: true, error: String(e?.message || e).slice(0, 120) }));
      // prize wheel (test only): unclaimed prizes past their validity go back to the pool (never a reserved one)
      const wheel = await expireUnclaimedPrizes(fs, cfg).catch((e) => ({ enabled: true, error: String(e?.message || e).slice(0, 120) }));
      // units held for guest tickets nobody claimed in time go back to the pool
      const guest = await releaseExpiredGuestHolds(fs, cfg).catch((e) => ({ enabled: true, error: String(e?.message || e).slice(0, 120) }));
      log('cron.done', { retried, reconcile: rec.enabled, processed: rec.processed, skipped: rec.skipped.length, sync, wheel, guest });
      return { retried, reconcile: rec, sync, wheel, guest };
    })();
    if (ctx?.waitUntil) ctx.waitUntil(job);
    return job;
  },
};
