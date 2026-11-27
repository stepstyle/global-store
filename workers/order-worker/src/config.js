// Configuration + hard guards.
//
// The deployment TARGET is fixed at BUILD time through the bundler constant __DEPLOY_TARGET__
// (wrangler [define]). Unbundled runs (Node tests) default to 'local'. ENVIRONMENT must equal the
// build target, so flipping a plain variable (e.g. ENVIRONMENT=production) on a local or staging
// build is refused. No production build configuration exists in this repository.
//
//  local      -> demo- project, emulator auth, every service URL on 127.0.0.1/localhost
//  staging    -> "<name>-staging" project, service account OF THAT PROJECT, official Google API hosts,
//                notifications ONLY to the staging sink Worker, Turnstile test secrets only,
//                production site origins forbidden
//  production -> project antastore1-82b50 only, service account of that project, official API
//                hosts only, sink forbidden, Turnstile test secrets forbidden
// Any violation => the Worker answers CONFIG_ERROR to every request and makes no outbound call.

import { GOOGLE_SECURETOKEN_JWKS_URL } from './auth.js';

export const PROD_PROJECT_ID = 'antastore1-82b50';
export const WORKER_VERSION = 'v2.3.0-delivery-auto';
export const STAGING_PROJECT_RE = /^[a-z][a-z0-9-]{2,22}-staging$/;
export const SINK_HOST_RE = /^anta-notify-sink-staging\.[a-z0-9-]+\.workers\.dev$/;
export const TURNSTILE_TEST_SECRETS = [
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
];
const OFFICIAL_HOSTS = {
  firestore: 'firestore.googleapis.com',
  oauth: 'oauth2.googleapis.com',
  telegram: 'api.telegram.org',
  sendgrid: 'api.sendgrid.com',
  turnstile: 'challenges.cloudflare.com',
};
const PROD_SITE_HOSTS = ['dairsharaf.com', 'www.dairsharaf.com'];

const LOCAL_URL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/|$)/;
const HTTPS_URL = /^https:\/\/[^/]+/;

/** Build-time target; 'local' when not bundled with a define. Read on every call (testable). */
export function buildTarget() {
  // eslint-disable-next-line no-undef
  return typeof __DEPLOY_TARGET__ !== 'undefined' ? String(__DEPLOY_TARGET__) : 'local';
}

/** Hostname of a plain https URL (no credentials, no custom port), else null. */
function httpsHost(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:' || x.username || x.password || x.port) return null;
    return x.hostname;
  } catch {
    return null;
  }
}

const originHost = (o) => {
  try {
    return new URL(o).hostname;
  } catch {
    return '';
  }
};

const str = (v) => String(v ?? '').trim();
const bool = (v, d) => (str(v) === '' ? d : str(v).toLowerCase() === 'true');
const num = (v, d) => {
  if (str(v) === '') return d;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};
const oneOf = (v, allowed, d) => (str(v) === '' ? d : allowed.includes(str(v)) ? str(v) : null);

export function loadConfig(env = {}) {
  const errors = [];
  const target = buildTarget();
  const environment = str(env.ENVIRONMENT);
  const isProd = environment === 'production';
  const isStaging = environment === 'staging';
  const remote = isProd || isStaging;
  const projectId = str(env.FIREBASE_PROJECT_ID);
  const firestoreAuth = str(env.FIRESTORE_AUTH);
  const saEmail = str(env.FIREBASE_CLIENT_EMAIL);
  const saKey = String(env.FIREBASE_PRIVATE_KEY || '');
  const turnstileSecret = str(env.TURNSTILE_SECRET);

  const urls = {
    firestore: str(env.FIRESTORE_BASE_URL) || (remote ? 'https://firestore.googleapis.com/v1' : ''),
    oauth: str(env.OAUTH_TOKEN_URL) || (remote ? 'https://oauth2.googleapis.com/token' : ''),
    telegram: str(env.TELEGRAM_API_BASE) || (isProd ? 'https://api.telegram.org' : ''),
    sendgrid: str(env.SENDGRID_API_BASE) || (isProd ? 'https://api.sendgrid.com' : ''),
    turnstile: str(env.TURNSTILE_VERIFY_URL) || (remote ? 'https://challenges.cloudflare.com/turnstile/v0/siteverify' : ''),
  };

  // Firebase ID token keys (src/auth.js). staging/production: ONLY Google's official URL (cannot be redirected).
  // local: a loopback test-key server, or empty (then a request that carries a token gets 503 AUTH_UNAVAILABLE).
  const authJwksRaw = str(env.AUTH_JWKS_URL);
  const authJwksUrl = remote ? authJwksRaw || GOOGLE_SECURETOKEN_JWKS_URL : authJwksRaw;
  if (remote && authJwksUrl !== GOOGLE_SECURETOKEN_JWKS_URL) errors.push(`${environment} AUTH_JWKS_URL must be ${GOOGLE_SECURETOKEN_JWKS_URL}`);
  if (environment === 'local' && authJwksUrl && !LOCAL_URL.test(authJwksUrl)) errors.push('local requires AUTH_JWKS_URL on 127.0.0.1/localhost');

  if (!['local', 'staging', 'production'].includes(target)) errors.push(`unknown build target "${target}"`);
  if (!['local', 'staging', 'production'].includes(environment)) errors.push('ENVIRONMENT must be local|staging|production');
  if (environment !== target) errors.push(`ENVIRONMENT "${environment || 'unset'}" does not match build target "${target}"`);
  if (!projectId) errors.push('FIREBASE_PROJECT_ID missing');

  const allowedOrigins = str(env.ALLOWED_ORIGINS || 'https://dairsharaf.com,https://www.dairsharaf.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const turnstileModeRaw = oneOf(env.TURNSTILE_MODE, ['off', 'log', 'enforce'], 'log');

  if (environment === 'local') {
    if (!projectId.startsWith('demo-') || projectId === PROD_PROJECT_ID) errors.push('local requires a demo- project id');
    if (firestoreAuth !== 'emulator') errors.push('local requires FIRESTORE_AUTH=emulator');
    for (const [k, u] of Object.entries(urls)) {
      if (!LOCAL_URL.test(u)) errors.push(`local requires ${k} URL on 127.0.0.1/localhost`);
    }
  }

  if (remote) {
    if (firestoreAuth !== 'service-account') errors.push(`${environment} requires FIRESTORE_AUTH=service-account`);
    if (!saKey.includes('BEGIN PRIVATE KEY')) errors.push(`${environment} requires FIREBASE_PRIVATE_KEY`);
    // The service account must belong to the target project (a staging key can never act on prod and vice versa).
    if (!projectId || !saEmail.endsWith(`@${projectId}.iam.gserviceaccount.com`)) {
      errors.push(`${environment} service account must belong to project "${projectId}"`);
    }
    for (const k of ['firestore', 'oauth', 'turnstile']) {
      if (httpsHost(urls[k]) !== OFFICIAL_HOSTS[k]) errors.push(`${environment} ${k} URL must be https://${OFFICIAL_HOSTS[k]}`);
    }
  }

  if (isStaging) {
    if (projectId === PROD_PROJECT_ID || projectId.startsWith('demo-') || !STAGING_PROJECT_RE.test(projectId)) {
      errors.push('staging requires a "<name>-staging" project id (never production, never demo-)');
    }
    for (const k of ['telegram', 'sendgrid']) {
      if (!SINK_HOST_RE.test(httpsHost(urls[k]) || '')) errors.push(`staging ${k} must point to the staging sink Worker`);
    }
    if (turnstileModeRaw !== 'off' && !TURNSTILE_TEST_SECRETS.includes(turnstileSecret)) {
      errors.push('staging may only use Cloudflare Turnstile test secrets');
    }
    if (allowedOrigins.some((o) => PROD_SITE_HOSTS.includes(originHost(o)))) {
      errors.push('staging must not accept production site origins');
    }
  }

  if (isProd) {
    if (projectId !== PROD_PROJECT_ID) errors.push(`production only serves project ${PROD_PROJECT_ID}`);
    for (const k of ['telegram', 'sendgrid']) {
      if (httpsHost(urls[k]) !== OFFICIAL_HOSTS[k]) errors.push(`production ${k} URL must be https://${OFFICIAL_HOSTS[k]}`);
    }
    if (turnstileModeRaw !== 'off' && TURNSTILE_TEST_SECRETS.includes(turnstileSecret)) {
      errors.push('production must not use a Turnstile test secret');
    }
    if (allowedOrigins.some((o) => !HTTPS_URL.test(o))) errors.push('production ALLOWED_ORIGINS must be https');
    // launch requirement: production never runs the transitional modes (log = a wrong price / a missing Turnstile
    // token is only recorded). The production v2 config must set both explicitly to enforce.
    // an unfilled draft value (wrangler.production.toml) never runs
    const unfilled = Object.entries(env || {}).filter(([, v]) => typeof v === 'string' && v.includes('REPLACE_WITH_')).map(([k]) => k);
    if (unfilled.length) errors.push(`production has unfilled placeholder value(s): ${unfilled.join(', ')}`);
    if (str(env.PRICE_CHECK_MODE) !== 'enforce') errors.push('production requires PRICE_CHECK_MODE=enforce');
    if (str(env.TURNSTILE_MODE) !== 'enforce') errors.push('production requires TURNSTILE_MODE=enforce');
    // launch requirement (owner's decision): orders are accepted automatically, the stock is RESERVED at creation and
    // deducted only when the admin marks the order delivered (src/fulfilment.js). A production Worker without it
    // (unset, typo, old on_creation) refuses to run instead of silently deducting stock at creation. Telegram only
    // notifies: the approval-button flow is not allowed in production.
    // owner's decision (Telegram / automatic ACCEPTANCE, stock deducted on acceptance) adds ONE more allowed
    // combination: STOCK_POLICY=on_acceptance WITH APPROVAL_MODE=telegram. Anything else refuses to run.
    const prodPolicy = str(env.STOCK_POLICY);
    const prodApproval = str(env.APPROVAL_MODE) || 'off';
    const prodOk = (prodPolicy === 'on_delivery' && prodApproval === 'off') || (prodPolicy === 'on_acceptance' && prodApproval === 'telegram');
    if (!prodOk) errors.push('production requires STOCK_POLICY=on_delivery with APPROVAL_MODE=off, or STOCK_POLICY=on_acceptance with APPROVAL_MODE=telegram');
    // prize wheel: owner's decision (2026-11-21, opening campaign 50 JOD / 30 days) — production runs it ONLY as
    // WHEEL_MODE=live (same server rules as 'test': campaign id, random phone secret, reservation-based stock policy);
    // 'test' stays local / staging only, so a staging config copied to production refuses to run
    if (!['', 'off', 'live'].includes(str(env.WHEEL_MODE))) errors.push('production requires WHEEL_MODE=off or WHEEL_MODE=live (test is staging-only)');
    // the staging access gate (src/http.js) has no meaning in production: a production Worker that carries the
    // variable is refused outright instead of silently ignoring it
    if (str(env.STAGING_ACCESS_TOKEN)) errors.push('production must not set STAGING_ACCESS_TOKEN (staging-only gate)');
  }

  const stockMode = oneOf(env.STOCK_MODE, ['off', 'log', 'apply'], 'log');
  // log (default, unchanged): a price difference is recorded (PRICE_MISMATCH) and the order is saved as before.
  // enforce: an order whose numbers differ from the server's is refused (422 PRICE_CHANGED) before ANY write.
  const priceCheckMode = oneOf(env.PRICE_CHECK_MODE, ['log', 'enforce'], 'log');
  const turnstileMode = turnstileModeRaw;
  if (!stockMode) errors.push('STOCK_MODE must be off|log|apply');
  if (!priceCheckMode) errors.push('PRICE_CHECK_MODE must be log|enforce');
  if (!turnstileMode) errors.push('TURNSTILE_MODE must be off|log|enforce');

  // ---- Telegram order approval (src/approval.js) ------------------------------------------------------------
  // off (default, unchanged): stock is deducted when the order is created (STOCK_MODE).
  // telegram: the order is saved as 'new' WITHOUT any stock change; an authorised admin accepts (atomic deduction)
  // or rejects it from Telegram. Requires the webhook secret, the chat id and the allowed Telegram user ids.
  const approvalMode = oneOf(env.APPROVAL_MODE, ['off', 'telegram'], 'off');
  if (!approvalMode) errors.push('APPROVAL_MODE must be off|telegram');
  const webhookSecret = str(env.TELEGRAM_WEBHOOK_SECRET);
  const adminUserIdsRaw = str(env.TELEGRAM_ADMIN_USER_IDS).split(',').map((s) => s.trim()).filter(Boolean);
  const adminUserIds = adminUserIdsRaw.filter((s) => /^[1-9]\d{0,19}$/.test(s));
  if (approvalMode === 'telegram') {
    if (!str(env.TELEGRAM_BOT_TOKEN)) errors.push('APPROVAL_MODE=telegram requires TELEGRAM_BOT_TOKEN');
    if (!/^-?\d{1,20}$/.test(str(env.TELEGRAM_CHAT_ID))) errors.push('APPROVAL_MODE=telegram requires a numeric TELEGRAM_CHAT_ID');
    // Telegram allows 1-256 chars of A-Z a-z 0-9 _ - for secret_token; we require a strong one
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret)) errors.push('APPROVAL_MODE=telegram requires TELEGRAM_WEBHOOK_SECRET (32-256 chars of A-Z a-z 0-9 _ -)');
    if (adminUserIds.length === 0 || adminUserIds.length !== adminUserIdsRaw.length) errors.push('APPROVAL_MODE=telegram requires TELEGRAM_ADMIN_USER_IDS (comma-separated numeric Telegram user ids)');
    if (stockMode !== 'apply') errors.push('APPROVAL_MODE=telegram requires STOCK_MODE=apply (stock is deducted on acceptance)');
  }
  // ---- when the physical stock moves -----------------------------------------------------------------------
  // on_creation (default, unchanged): deducted when the order is created (STOCK_MODE), or on Telegram acceptance.
  // on_delivery: reserved at creation (stockReservations, src/reservations.js; an order that needs more than
  //              stock - reserved is refused), deducted ONCE when the admin marks it delivered (src/fulfilment.js).
  // prize wheel (src/wheel.js): 'off' (default) | 'test' (local / staging only) | 'live' (production; same rules)
  const wheelMode = oneOf(env.WHEEL_MODE, ['off', 'test', 'live'], 'off');
  if (!wheelMode) errors.push('WHEEL_MODE must be off|test|live');
  const wheelCampaignId = str(env.WHEEL_CAMPAIGN);
  if (wheelMode !== 'off' && !/^[a-z0-9-]{3,40}$/.test(wheelCampaignId)) errors.push('WHEEL_MODE=test requires WHEEL_CAMPAIGN (a campaign id: a-z 0-9 -)');
  // server-only HMAC key for delivery numbers (src/wheel.js phoneKey); never in a browser bundle, never logged
  const wheelPhoneSecret = str(env.WHEEL_PHONE_SECRET);
  // a RANDOM value (e.g. `openssl rand -base64 48`) set with `wrangler secret put` — never in wrangler.toml or the repo.
  // Length + variety check refuses placeholders like 'xxxx…' or '1234…' (the value itself is never logged).
  if (wheelMode !== 'off' && (wheelPhoneSecret.length < 32 || new Set(wheelPhoneSecret).size < 12)) errors.push('WHEEL_MODE=test requires a random WHEEL_PHONE_SECRET (at least 32 characters, not a placeholder)');
  if (wheelMode !== 'off' && !['on_delivery', 'on_acceptance'].includes(str(env.STOCK_POLICY))) errors.push('WHEEL_MODE=test requires STOCK_POLICY=on_delivery or on_acceptance (prizes go through the reservation)');
  // on_acceptance: RESERVED at creation (like on_delivery), DEDUCTED once when the order is accepted (Telegram button or
  // automatic acceptance, src/approval.js), returned once on a cancellation after acceptance; every later status goes
  // through the Worker (src/fulfilment.js) so the prize wheel follows the order. Requires APPROVAL_MODE=telegram.
  const stockPolicy = oneOf(env.STOCK_POLICY, ['on_creation', 'on_delivery', 'on_acceptance'], 'on_creation');
  if (!stockPolicy) errors.push('STOCK_POLICY must be on_creation|on_delivery|on_acceptance');
  if (stockPolicy === 'on_acceptance') {
    if (stockMode !== 'apply') errors.push('STOCK_POLICY=on_acceptance requires STOCK_MODE=apply');
    if (approvalMode !== 'telegram') errors.push('STOCK_POLICY=on_acceptance requires APPROVAL_MODE=telegram');
  }
  if (stockPolicy === 'on_delivery') {
    if (stockMode !== 'apply') errors.push('STOCK_POLICY=on_delivery requires STOCK_MODE=apply');
    if (approvalMode === 'telegram') errors.push('STOCK_POLICY=on_delivery cannot be combined with APPROVAL_MODE=telegram (use STOCK_POLICY=on_acceptance)');
  }
  // who may place an order: 'off' (default, unchanged: guests allowed, a token is optional) | 'google' (every new order
  // needs a VERIFIED Firebase ID token signed in with Google — checked here, on the server, before Turnstile and before
  // anything is read or written). Turn it on only AFTER the site that signs customers in at checkout is live.
  const orderSignIn = oneOf(env.ORDER_SIGN_IN, ['off', 'google'], 'off');
  if (!orderSignIn) errors.push('ORDER_SIGN_IN must be off|google');
  const currency = str(env.CURRENCY) || 'JOD';
  if (!/^[A-Z]{3}$/.test(currency)) errors.push('CURRENCY must be an ISO 4217 code (e.g. JOD)');

  // Smart auto-approval (src/autoapproval.js, src/autoreview.js). The SERVER CEILING: 'off' (default) = no order is
  // ever assessed, whatever the dashboard switch says. 'on' only works on top of Telegram approval.
  const autoApprovalMode = oneOf(env.AUTO_APPROVAL_MODE, ['off', 'on'], 'off');
  if (!autoApprovalMode) errors.push('AUTO_APPROVAL_MODE must be off|on');
  if (autoApprovalMode === 'on' && approvalMode !== 'telegram') errors.push('AUTO_APPROVAL_MODE=on requires APPROVAL_MODE=telegram');
  // HMAC key for the phone fingerprint (same-phone check). Missing = that check is "unavailable" = manual review.
  const autoHashSecret = str(env.AUTO_APPROVAL_HASH_SECRET);
  if (autoHashSecret && autoHashSecret.length < 32) errors.push('AUTO_APPROVAL_HASH_SECRET must be at least 32 characters');

  return {
    ok: errors.length === 0,
    errors,
    buildTarget: target,
    environment,
    isProd,
    isStaging,
    projectId,
    firestoreAuth,
    urls,
    authJwksUrl,
    stockMode,
    priceCheckMode,
    turnstileMode,
    allowedOrigins,
    reconcileEnabled: bool(env.RECONCILE_ENABLED, false),
    // rollback safety net (src/fulfilment.js syncDirectStatusChanges): ON only while the OLD admin dashboard is back
    syncDirectStatus: bool(env.SYNC_DIRECT_STATUS, false),
    syncBatch: Math.max(1, Math.min(300, num(env.SYNC_BATCH, 300))),
    syncPages: Math.max(1, Math.min(10, num(env.SYNC_PAGES, 5))),
    syncApplyPerRun: Math.max(1, Math.min(10, num(env.SYNC_APPLY_PER_RUN, 4))),
    adoptWindowMs: num(env.ADOPT_WINDOW_MS, 15 * 60 * 1000),
    createWaitMs: num(env.CREATE_WAIT_MS, 1500),
    reconcileWindowMs: num(env.RECONCILE_WINDOW_MS, 2 * 60 * 60 * 1000),
    reconcileGraceMs: num(env.RECONCILE_GRACE_MS, 2 * 60 * 1000),
    reconcileBatch: num(env.RECONCILE_BATCH, 20),
    leaseMs: num(env.NOTIFY_LEASE_MS, 60 * 1000),
    notifyMaxAttempts: num(env.NOTIFY_MAX_ATTEMPTS, 5),
    // one Telegram / SendGrid call may not outlive its claim (a lease that expires mid-send could cause a duplicate)
    notifySendTimeoutMs: num(env.NOTIFY_SEND_TIMEOUT_MS, 15 * 1000),
    // extra wait before an order whose notification failed is due again (0 = next cron run, behind every other due order)
    notifyRetryBaseMs: num(env.NOTIFY_RETRY_BASE_MS, 0),
    // a Telegram message of an order still awaiting a decision is never given up: after notifyMaxAttempts it is
    // retried every this often (the admin must always get the buttons)
    notifyExhaustedRetryMs: num(env.NOTIFY_EXHAUSTED_RETRY_MS, 30 * 60 * 1000),
    // cron: several due orders per run, inside a per-invocation subrequest budget (Workers Free: 50 -> 45 by default;
    // raise CRON_SUBREQUEST_BUDGET only on a paid plan)
    cronMaxOrders: Math.max(1, Math.min(num(env.CRON_MAX_ORDERS, 10), 50)),
    cronSubrequestBudget: Math.max(25, Math.min(num(env.CRON_SUBREQUEST_BUDGET, 45), 950)),
    maxBodyBytes: num(env.MAX_BODY_BYTES, 32 * 1024),
    rateLimitCreatePerMin: num(env.RATE_LIMIT_CREATE_PER_MIN, 10),
    rateLimitStatusPerMin: num(env.RATE_LIMIT_STATUS_PER_MIN, 60),
    workerAuthToken: str(env.WORKER_AUTH_TOKEN),
    // staging only (read nowhere else): secret for the x-staging-access gate; empty = every gated route refused
    stagingAccessToken: isStaging ? str(env.STAGING_ACCESS_TOKEN) : '',
    telegram: { token: str(env.TELEGRAM_BOT_TOKEN), chatId: str(env.TELEGRAM_CHAT_ID), webhookSecret, adminUserIds: new Set(adminUserIds) },
    approvalMode,
    stockPolicy,
    orderSignIn,
    wheelMode,
    wheelCampaignId,
    wheelPhoneSecret,
    // spin BEFORE signing in (src/wheel-guest.js): guest spins per IP per day (0 = no guest spin; a shared mobile IP can
    // serve several homes, so not too low), and how long a won unit is held for an unclaimed ticket
    wheelGuestPerIpDay: Math.max(0, Math.min(1000, num(env.WHEEL_GUEST_PER_IP_DAY, 10))),
    // a won, unused prize is valid this long from the spin (owner's rule: 60 minutes); see src/wheel.js prizeHoldMs
    wheelPrizeHoldMinutes: Math.max(5, Math.min(1440, num(env.WHEEL_PRIZE_HOLD_MINUTES, 60))),
    // GET /wheel/public (what every new visitor asks first): the answer is kept this long in the Worker's memory
    // (0..60 s, default 15) instead of 3 Firestore reads per visitor (1-3 s measured live). Display only: a spin always
    // re-reads the campaign, pool and budget. An admin save clears it at once (in that isolate); 0 = off (local tests
    // that rewrite the campaign straight in the emulator).
    wheelPublicCacheMs: Math.max(0, Math.min(60, num(env.WHEEL_PUBLIC_CACHE_SECONDS, 15))) * 1000,
    // owner's exception: a 'second order' discount is usable this long after the account's FIRST delivery (5 days)
    wheelSecondOrderHours: Math.max(1, Math.min(2160, num(env.WHEEL_SECOND_ORDER_HOURS, 120))),
    // ...and its FIRST order (created in time) must be delivered within this many hours of its creation (7 days)
    wheelFirstDeliveryHours: Math.max(1, Math.min(2160, num(env.WHEEL_FIRST_DELIVERY_HOURS, 168))),
    currency,
    autoApprovalMode,
    autoApproval: {
      hashSecret: autoHashSecret,
      // dashboard switch / limits are re-read at most this often (a switch-off applies within this time)
      settingsCacheMs: Math.min(Math.max(num(env.AUTO_APPROVAL_CACHE_MS, 30 * 1000), 0), 5 * 60 * 1000),
      // a review still 'queued' after this is finished by the cron (the request that started it stopped)
      recoverAfterMs: num(env.AUTO_APPROVAL_RECOVER_AFTER_MS, 60 * 1000),
      // a review that cannot be finished for this long is closed as manual review (the order is never stuck)
      giveUpAfterMs: num(env.AUTO_APPROVAL_GIVE_UP_AFTER_MS, 30 * 60 * 1000),
    },
    email: {
      apiKey: str(env.SENDGRID_API_KEY),
      to: str(env.ADMIN_EMAIL),
      from: str(env.EMAIL_FROM),
      fromName: str(env.EMAIL_FROM_NAME) || 'Store Admin',
    },
    adminBaseUrl: str(env.ADMIN_BASE_URL),
    turnstileSecret: str(env.TURNSTILE_SECRET),
    serviceAccount: { clientEmail: str(env.FIREBASE_CLIENT_EMAIL), privateKey: env.FIREBASE_PRIVATE_KEY || '' },
  };
}
