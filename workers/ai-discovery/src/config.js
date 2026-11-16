// Configuration + hard guards for the AI discovery helper (STAGING / LOCAL only).
// Any violation -> the Worker answers CONFIG_ERROR to every request and calls no model.

export const SERVICE = 'ai-discovery';
const PROVIDERS = ['fake', 'workers-ai'];
const FAKE_MODES = ['ok', 'error', 'timeout', 'garbage', 'inject', 'empty'];
const PROD_SITE_HOSTS = ['dairsharaf.com', 'www.dairsharaf.com'];
// The Worker needs NO secret (the Workers AI binding carries no key). A variable that looks like a credential means
// someone is wiring a real key in: refused.
const SECRET_NAME_RE = /(API_?KEY|SECRET|TOKEN|PASSWORD|PRIVATE_?KEY|CREDENTIAL|BEARER)/i;

const str = (v) => String(v ?? '').trim();
const int = (v, d, lo, hi) => {
  if (str(v) === '') return d;
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

/** @returns {{ ok: boolean, errors: string[], environment: string, provider: string, aiEnabled: boolean, model: string,
 *   timeoutMs: number, dailyLimit: number, ratePerMin: number, allowedOrigins: string[], fakeMode: string, maxOutputTokens: number }} */
export function loadConfig(env = {}) {
  const errors = [];
  const environment = str(env.ENVIRONMENT);
  if (!['staging', 'local'].includes(environment)) errors.push('ENVIRONMENT must be staging or local (this service never runs in production)');

  const provider = str(env.AI_PROVIDER) || 'fake';
  if (!PROVIDERS.includes(provider)) errors.push(`AI_PROVIDER must be one of ${PROVIDERS.join('|')}`);
  const aiEnabled = str(env.AI_ENABLED) === 'true';
  if (provider === 'workers-ai') {
    if (environment !== 'staging') errors.push('workers-ai provider is only allowed in staging');
    if (!aiEnabled) errors.push('workers-ai provider needs AI_ENABLED=true (explicit opt-in)');
    if (!env.AI || typeof env.AI.run !== 'function') errors.push('workers-ai provider needs the AI binding');
  }
  const fakeMode = str(env.FAKE_MODE) || 'ok';
  if (!FAKE_MODES.includes(fakeMode)) errors.push(`FAKE_MODE must be one of ${FAKE_MODES.join('|')}`);
  if (provider !== 'fake' && str(env.FAKE_MODE)) errors.push('FAKE_MODE is only for the fake provider');

  const model = str(env.AI_MODEL) || '@cf/meta/llama-3.1-8b-instruct';
  if (!/^@cf\/[a-z0-9._/-]{3,80}$/i.test(model)) errors.push('AI_MODEL must be a Workers AI model id (@cf/...)');
  const timeoutMs = int(env.AI_TIMEOUT_MS, 2500, 100, 8000);
  if (timeoutMs === null) errors.push('AI_TIMEOUT_MS must be an integer 100..8000');
  const dailyLimit = int(env.DAILY_AI_LIMIT, 200, 1, 10000);
  if (dailyLimit === null) errors.push('DAILY_AI_LIMIT must be an integer 1..10000');
  const ratePerMin = int(env.RATE_LIMIT_PER_MIN, 10, 1, 120);
  if (ratePerMin === null) errors.push('RATE_LIMIT_PER_MIN must be an integer 1..120');
  // small output budget: an intent is a short JSON object (keeps Neurons per call low)
  const maxOutputTokens = int(env.AI_OUTPUT_LIMIT, 160, 32, 256);
  if (maxOutputTokens === null) errors.push('AI_OUTPUT_LIMIT must be an integer 32..256');

  const allowedOrigins = str(env.ALLOWED_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowedOrigins.length) errors.push('ALLOWED_ORIGINS is required (no wildcard)');
  for (const o of allowedOrigins) {
    let u = null;
    try { u = new URL(o); } catch { /* invalid */ }
    if (!u || u.origin !== o) { errors.push(`ALLOWED_ORIGINS entry is not an origin: ${o}`); continue; }
    if (PROD_SITE_HOSTS.includes(u.hostname)) errors.push('ALLOWED_ORIGINS must not contain the production site');
    if (u.protocol === 'http:' && u.hostname !== '127.0.0.1') errors.push('http origins are allowed for 127.0.0.1 only');
  }

  for (const k of Object.keys(env)) {
    if (SECRET_NAME_RE.test(k)) errors.push(`variable ${k} looks like a credential — this service must not hold keys`);
  }

  return {
    ok: errors.length === 0, errors, environment, provider, aiEnabled, model,
    timeoutMs: timeoutMs ?? 2500, dailyLimit: dailyLimit ?? 200, ratePerMin: ratePerMin ?? 10, allowedOrigins, fakeMode,
    maxOutputTokens: maxOutputTokens ?? 160,
  };
}
