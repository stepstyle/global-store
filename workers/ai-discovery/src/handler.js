// AI discovery helper (implementation; entry point: index.js) — STAGING ONLY.  POST /ai/intent  { query }  ->  { ok, intent, cached, provider }
//
// The model (fake by default) only UNDERSTANDS the request. Its answer is validated with the shared discovery
// contract (src/services/discovery/provider.ts sanitizeProviderIntent): products, prices, stock and text are dropped.
// The site always ranks real store products locally and falls back to local search on any error status below.
//
// Order of checks: config -> route/method -> origin -> body size/JSON -> query -> personal data removed -> rate limit
// -> cache -> daily cap -> provider (timeout) -> contract. Logs carry event codes and lengths only, never the text.
import { loadConfig, SERVICE } from './config.js';
import { redactPersonalData } from './privacy.js';
import { fakeProvider, workersAiProvider } from './providers.js';
import { sanitizeProviderIntent, INTENT_PATCH_FIELDS } from '../../../src/services/discovery/provider.ts';
import { validateQuery, DiscoveryInputError } from '../../../src/services/discovery/intent.ts';
import { normalizeArabic } from '../../../src/services/discovery/arabicText.ts';

export const MAX_BODY_BYTES = 2048;
export const CACHE_TTL_SECONDS = 7 * 24 * 3600;

// Per-isolate fallbacks when no KV / rate-limit binding exists (local tests). Staging uses the bindings.
const memory = { cache: new Map(), daily: new Map(), rate: new Map() };
export function _resetMemory() { memory.cache.clear(); memory.daily.clear(); memory.rate.clear(); }

const log = (event, fields = {}) => console.log(JSON.stringify({ svc: SERVICE, event, ...fields }));

function json(data, status, origin) {
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (origin) { h['access-control-allow-origin'] = origin; h.vary = 'Origin'; }
  return new Response(JSON.stringify(data), { status, headers: h });
}

async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function rateLimited(env, cfg, key, now) {
  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === 'function') {
    const { success } = await env.RATE_LIMITER.limit({ key });
    return !success;
  }
  const minute = Math.floor(now / 60000);
  const k = `${key}:${minute}`;
  const n = (memory.rate.get(k) ?? 0) + 1;
  memory.rate.set(k, n);
  return n > cfg.ratePerMin;
}

/** Soft daily cap on MODEL calls (cache hits are free). KV is eventually consistent: a few calls over the cap are possible. */
async function dailyCount(env, day, increment) {
  const key = `daily:${day}`;
  if (env.AI_KV) {
    const n = Number((await env.AI_KV.get(key)) ?? 0);
    if (increment) await env.AI_KV.put(key, String(n + 1), { expirationTtl: 2 * 24 * 3600 });
    return n;
  }
  const n = memory.daily.get(key) ?? 0;
  if (increment) memory.daily.set(key, n + 1);
  return n;
}

async function cacheGet(env, key) {
  if (env.AI_KV) { const v = await env.AI_KV.get(key); return v ? JSON.parse(v) : null; }
  const e = memory.cache.get(key);
  return e && e.exp > Date.now() ? e.v : null;
}
async function cachePut(env, key, value) {
  if (env.AI_KV) return env.AI_KV.put(key, JSON.stringify(value), { expirationTtl: CACHE_TTL_SECONDS });
  memory.cache.set(key, { v: value, exp: Date.now() + CACHE_TTL_SECONDS * 1000 });
}

export function providerFor(cfg, env) {
  return cfg.provider === 'workers-ai' ? workersAiProvider(env.AI, cfg.model, { maxOutputTokens: cfg.maxOutputTokens }) : fakeProvider(cfg.fakeMode);
}

export default {
  async fetch(request, env, ctx, deps = {}) {
    const t0 = Date.now();
    const now = deps.now ?? Date.now();
    const cfg = loadConfig(env);
    if (!cfg.ok) {
      log('config_error', { problems: cfg.errors.length });
      return json({ ok: false, code: 'CONFIG_ERROR' }, 500);
    }
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    const allowed = cfg.allowedOrigins.includes(origin) ? origin : null;

    if (url.pathname === '/' && request.method === 'GET') {
      return json({ ok: true, service: SERVICE, environment: cfg.environment, provider: cfg.provider }, 200, allowed);
    }
    if (url.pathname !== '/ai/intent') return json({ ok: false, code: 'NOT_FOUND' }, 404, allowed);
    if (request.method === 'OPTIONS') {
      if (!allowed) return json({ ok: false, code: 'ORIGIN_NOT_ALLOWED' }, 403);
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': allowed, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'Origin' } });
    }
    if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405, allowed);
    // browser-only endpoint of the staging site: the Origin header is required and must be allow-listed
    if (!allowed) { log('origin_refused'); return json({ ok: false, code: 'ORIGIN_NOT_ALLOWED' }, 403); }
    if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return json({ ok: false, code: 'JSON_REQUIRED' }, 415, allowed);
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_BODY_BYTES) return json({ ok: false, code: 'BODY_TOO_LARGE' }, 413, allowed);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ ok: false, code: 'BODY_TOO_LARGE' }, 413, allowed);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ ok: false, code: 'BAD_JSON' }, 400, allowed); }

    let query;
    try { query = validateQuery(body?.query); } catch (e) {
      if (e instanceof DiscoveryInputError) return json({ ok: false, code: 'INVALID_QUERY', reason: e.code }, 400, allowed);
      throw e;
    }
    const { text, redactions } = redactPersonalData(query);

    const ip = request.headers.get('cf-connecting-ip') || 'local';
    if (await rateLimited(env, cfg, `ip:${await sha256Hex(ip)}`, now)) {
      log('rate_limited', { len: text.length });
      return json({ ok: false, code: 'RATE_LIMITED' }, 429, allowed);
    }

    const cacheKey = `intent:v1:${cfg.provider}:${await sha256Hex(normalizeArabic(text))}`;
    const hit = await cacheGet(env, cacheKey);
    if (hit) {
      log('ok', { len: text.length, redactions, cached: true, provider: cfg.provider, ms: Date.now() - t0 });
      return json({ ok: true, intent: hit, cached: true, provider: cfg.provider }, 200, allowed);
    }

    const day = new Date(now).toISOString().slice(0, 10);
    if ((await dailyCount(env, day, false)) >= cfg.dailyLimit) {
      log('daily_limit', { limit: cfg.dailyLimit });
      return json({ ok: false, code: 'DAILY_LIMIT' }, 429, allowed);
    }
    await dailyCount(env, day, true);

    const provider = deps.provider ?? providerFor(cfg, env);
    const ac = new AbortController();
    let timer;
    let answer;
    try {
      answer = await Promise.race([
        provider.extractIntent(text, { signal: ac.signal }),
        new Promise((_, reject) => { timer = setTimeout(() => { ac.abort(); reject(new Error('timeout')); }, cfg.timeoutMs); }),
      ]);
    } catch (e) {
      const timeout = e instanceof Error && e.message === 'timeout';
      log(timeout ? 'ai_timeout' : 'ai_error', { len: text.length, provider: provider.id, ms: Date.now() - t0 });
      return json({ ok: false, code: timeout ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE' }, timeout ? 504 : 503, allowed);
    } finally {
      clearTimeout(timer);
    }

    const intent = sanitizeProviderIntent(answer);
    if (!intent || Object.keys(intent).some((k) => !INTENT_PATCH_FIELDS.includes(k))) {
      log('ai_empty', { len: text.length, provider: provider.id, ms: Date.now() - t0 });
      return json({ ok: false, code: 'AI_EMPTY' }, 502, allowed);
    }
    await cachePut(env, cacheKey, intent);
    log('ok', { len: text.length, redactions, cached: false, provider: provider.id, fields: Object.keys(intent).length, ms: Date.now() - t0 });
    return json({ ok: true, intent, cached: false, provider: cfg.provider }, 200, allowed);
  },
};
