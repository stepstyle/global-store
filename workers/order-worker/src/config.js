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
export const WORKER_VERSION = 'v2.0.0-phase1';
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
  const telegramAdminUserId = str(env.TELEGRAM_ADMIN_USER_ID);
  const telegramWebhookSecret = str(env.TELEGRAM_WEBHOOK_SECRET);
  if (telegramWebhookSecret && !/^[A-Za-z0-9_-]{1,256}$/.test(telegramWebhookSecret)) {
    errors.push('TELEGRAM_WEBHOOK_SECRET must match Telegram secret_token format');
  }
  if (telegramAdminUserId && !/^[1-9][0-9]{0,18}$/.test(telegramAdminUserId)) {
    errors.push('TELEGRAM_ADMIN_USER_ID must be a numeric Telegram user ID');
  }
  if ((telegramAdminUserId && !telegramWebhookSecret) || (!telegramAdminUserId && telegramWebhookSecret)) {
    errors.push('Telegram webhook secret and admin user ID must be configured together');
  }

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
    maxBodyBytes: num(env.MAX_BODY_BYTES, 32 * 1024),
    rateLimitCreatePerMin: num(env.RATE_LIMIT_CREATE_PER_MIN, 10),
    rateLimitStatusPerMin: num(env.RATE_LIMIT_STATUS_PER_MIN, 60),
    workerAuthToken: str(env.WORKER_AUTH_TOKEN),
    // staging only (read nowhere else): secret for the x-staging-access gate; empty = every gated route refused
    stagingAccessToken: isStaging ? str(env.STAGING_ACCESS_TOKEN) : '',
    telegram: { token: str(env.TELEGRAM_BOT_TOKEN), chatId: str(env.TELEGRAM_CHAT_ID), adminUserId: telegramAdminUserId, webhookSecret: telegramWebhookSecret },
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
