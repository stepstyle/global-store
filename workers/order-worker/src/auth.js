// Firebase Authentication ID token verification (RS256, Google's public "securetoken" keys).
//
// Follows https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
//   header : alg === "RS256" (anything else, incl. "none"/"HS256", is refused), kid names a current public key
//   payload: aud === project id, iss === https://securetoken.google.com/<project id>,
//            exp in the future, iat and auth_time in the past, sub = non-empty string of at most 128 chars
//   signature: RSASSA-PKCS1-v1_5 / SHA-256 over "<header>.<payload>", verified with WebCrypto
// The verified uid is `sub`. Nothing from the request body is ever used as identity.
//
// Keys come from cfg.urls.authJwks (JWK set). Production/staging: fixed to Google's official URL (config.js).
// Local/tests: a loopback mock serving TEST keys — no Google service is contacted.

export const GOOGLE_SECURETOKEN_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const MAX_TOKEN_CHARS = 4096;
const CLOCK_SKEW_SEC = 60; // tolerated only for "issued in the future" checks; expiry is strict
const MIN_CACHE_SEC = 60;
const MAX_CACHE_SEC = 6 * 3600;

export class AuthError extends Error {
  /** code: AUTH_EXPIRED (refreshable) | AUTH_INVALID (refreshable, then sign in again) | AUTH_UNAVAILABLE (keys could not be loaded) */
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.code = code;
    this.reason = reason;
  }
}
const invalid = (reason) => new AuthError('AUTH_INVALID', reason);

function b64urlToBytes(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw invalid('malformed');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  let bin;
  try {
    bin = atob(b64);
  } catch {
    throw invalid('malformed');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function decodeJsonPart(s) {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw invalid('malformed');
  }
}

/** "Authorization: Bearer <jwt>" -> jwt. undefined = no header at all (guest). Throws on a present but bad header. */
export function bearerToken(headerValue) {
  if (headerValue === null || headerValue === undefined) return undefined;
  const m = /^Bearer ([A-Za-z0-9_\-.]+)$/.exec(String(headerValue).trim());
  if (!m) throw invalid('authorization_header');
  return m[1];
}

// ------------------------------------------------------------------------------------------- key cache
const cache = new Map(); // url -> { keys: Map(kid -> CryptoKey), expiresAt, fetchedAt }

function maxAge(cacheControl) {
  const m = /max-age=(\d+)/i.exec(cacheControl || '');
  const v = m ? Number(m[1]) : MIN_CACHE_SEC;
  return Math.min(MAX_CACHE_SEC, Math.max(MIN_CACHE_SEC, v));
}

async function loadKeys(url, fetchImpl, nowMs) {
  let res;
  try {
    res = await fetchImpl(url, { method: 'GET' });
  } catch {
    throw new AuthError('AUTH_UNAVAILABLE', 'keys_fetch_failed');
  }
  if (!res.ok) throw new AuthError('AUTH_UNAVAILABLE', `keys_http_${res.status}`);
  let set;
  try {
    set = await res.json();
  } catch {
    throw new AuthError('AUTH_UNAVAILABLE', 'keys_malformed');
  }
  const keys = new Map();
  for (const k of Array.isArray(set?.keys) ? set.keys : []) {
    if (!k || k.kty !== 'RSA' || typeof k.kid !== 'string' || !k.n || !k.e) continue;
    if (k.alg && k.alg !== 'RS256') continue;
    if (k.use && k.use !== 'sig') continue;
    try {
      const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      keys.set(k.kid, key);
    } catch {}
  }
  if (keys.size === 0) throw new AuthError('AUTH_UNAVAILABLE', 'no_usable_keys');
  const entry = { keys, fetchedAt: nowMs, expiresAt: nowMs + maxAge(res.headers?.get?.('cache-control')) * 1000 };
  cache.set(url, entry);
  return entry;
}

async function keyFor(kid, url, fetchImpl, nowMs) {
  let entry = cache.get(url);
  if (!entry || entry.expiresAt <= nowMs) entry = await loadKeys(url, fetchImpl, nowMs);
  if (entry.keys.has(kid)) return entry.keys.get(kid);
  // unknown kid: keys may have rotated — refetch at most once a minute
  if (nowMs - entry.fetchedAt >= MIN_CACHE_SEC * 1000) {
    entry = await loadKeys(url, fetchImpl, nowMs);
    if (entry.keys.has(kid)) return entry.keys.get(kid);
  }
  throw invalid('unknown_kid');
}

/** Test hook: forget cached keys. */
export function clearKeyCache() {
  cache.clear();
}

// ------------------------------------------------------------------------------------------- verify
/**
 * Verify a Firebase ID token. Returns { uid, email, emailVerified }. Throws AuthError.
 * @param {string} token
 * @param {{ projectId: string, jwksUrl: string, fetch?: typeof fetch, nowMs?: number }} o
 */
export async function verifyFirebaseIdToken(token, o) {
  if (!o?.projectId) throw new AuthError('AUTH_UNAVAILABLE', 'no_project');
  if (!o?.jwksUrl) throw new AuthError('AUTH_UNAVAILABLE', 'no_keys_url');
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_CHARS) throw invalid('malformed');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) throw invalid('malformed');

  const header = decodeJsonPart(parts[0]);
  const payload = decodeJsonPart(parts[1]);
  if (header.alg !== 'RS256') throw invalid('alg');
  if (typeof header.kid !== 'string' || header.kid.length === 0) throw invalid('kid');
  if (header.typ !== undefined && header.typ !== 'JWT') throw invalid('typ');

  const nowMs = o.nowMs ?? Date.now();
  const now = Math.floor(nowMs / 1000);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  // claims first (cheap), signature last — but a token is accepted only if ALL pass
  if (payload.aud !== o.projectId) throw invalid('aud');
  if (payload.iss !== `https://securetoken.google.com/${o.projectId}`) throw invalid('iss');
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128) throw invalid('sub');
  if (!isNum(payload.iat) || payload.iat > now + CLOCK_SKEW_SEC) throw invalid('iat');
  if (!isNum(payload.auth_time) || payload.auth_time > now + CLOCK_SKEW_SEC) throw invalid('auth_time');
  if (!isNum(payload.exp)) throw invalid('exp');

  const key = await keyFor(header.kid, o.jwksUrl, o.fetch ?? fetch, nowMs);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw invalid('signature');
  // expiry after the signature: an "expired" answer (refresh and retry) is only given for a GENUINE token
  if (payload.exp <= now) throw new AuthError('AUTH_EXPIRED', 'exp');

  return { uid: payload.sub, email: typeof payload.email === 'string' ? payload.email : '', emailVerified: payload.email_verified === true };
}
