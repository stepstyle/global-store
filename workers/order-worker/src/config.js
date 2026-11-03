// Configuration + hard guards that keep non-production runs away from production.
//
// ENVIRONMENT=local      -> demo- project, emulator auth, every service URL on localhost
// ENVIRONMENT=production -> real project, service-account auth, https URLs
// Anything else (or any violated guard) => the Worker refuses every request (CONFIG_ERROR)
// and makes no outbound call.

export const PROD_PROJECT_ID = 'antastore1-82b50';
export const WORKER_VERSION = 'v2.0.0-phase1';

const LOCAL_URL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/|$)/;
const HTTPS_URL = /^https:\/\/[^/]+/;

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
  const environment = str(env.ENVIRONMENT);
  const isProd = environment === 'production';
  const projectId = str(env.FIREBASE_PROJECT_ID);
  const firestoreAuth = str(env.FIRESTORE_AUTH);

  const urls = {
    firestore: str(env.FIRESTORE_BASE_URL) || (isProd ? 'https://firestore.googleapis.com/v1' : ''),
    oauth: str(env.OAUTH_TOKEN_URL) || (isProd ? 'https://oauth2.googleapis.com/token' : ''),
    telegram: str(env.TELEGRAM_API_BASE) || (isProd ? 'https://api.telegram.org' : ''),
    sendgrid: str(env.SENDGRID_API_BASE) || (isProd ? 'https://api.sendgrid.com' : ''),
    turnstile: str(env.TURNSTILE_VERIFY_URL) || (isProd ? 'https://challenges.cloudflare.com/turnstile/v0/siteverify' : ''),
  };

  if (!['local', 'production'].includes(environment)) errors.push('ENVIRONMENT must be "local" or "production"');
  if (!projectId) errors.push('FIREBASE_PROJECT_ID missing');

  if (!isProd) {
    if (!projectId.startsWith('demo-') || projectId === PROD_PROJECT_ID) errors.push('local requires a demo- project id');
    if (firestoreAuth !== 'emulator') errors.push('local requires FIRESTORE_AUTH=emulator');
    for (const [k, u] of Object.entries(urls)) {
      if (!LOCAL_URL.test(u)) errors.push(`local requires ${k} URL on 127.0.0.1/localhost`);
    }
  } else {
    if (projectId.startsWith('demo-')) errors.push('production cannot use a demo- project');
    if (firestoreAuth !== 'service-account') errors.push('production requires FIRESTORE_AUTH=service-account');
    for (const [k, u] of Object.entries(urls)) {
      if (!HTTPS_URL.test(u)) errors.push(`production requires https ${k} URL`);
    }
  }

  const stockMode = oneOf(env.STOCK_MODE, ['off', 'log', 'apply'], 'log');
  const priceCheckMode = oneOf(env.PRICE_CHECK_MODE, ['log'], 'log'); // 'enforce' arrives in Phase 2
  const turnstileMode = oneOf(env.TURNSTILE_MODE, ['off', 'log', 'enforce'], 'log');
  if (!stockMode) errors.push('STOCK_MODE must be off|log|apply');
  if (!priceCheckMode) errors.push('PRICE_CHECK_MODE must be log (enforce not available in phase 1)');
  if (!turnstileMode) errors.push('TURNSTILE_MODE must be off|log|enforce');

  const allowedOrigins = str(env.ALLOWED_ORIGINS || 'https://dairsharaf.com,https://www.dairsharaf.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (isProd && allowedOrigins.some((o) => !HTTPS_URL.test(o))) errors.push('production ALLOWED_ORIGINS must be https');

  return {
    ok: errors.length === 0,
    errors,
    environment,
    isProd,
    projectId,
    firestoreAuth,
    urls,
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
    maxBodyBytes: num(env.MAX_BODY_BYTES, 32 * 1024),
    rateLimitCreatePerMin: num(env.RATE_LIMIT_CREATE_PER_MIN, 10),
    rateLimitStatusPerMin: num(env.RATE_LIMIT_STATUS_PER_MIN, 60),
    workerAuthToken: str(env.WORKER_AUTH_TOKEN),
    telegram: { token: str(env.TELEGRAM_BOT_TOKEN), chatId: str(env.TELEGRAM_CHAT_ID) },
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
