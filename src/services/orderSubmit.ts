// Order submission to the order Worker v2 (POST /create-order, GET /orders/{id}/status).
// Pure and injectable (fetch, timers, storage, online state, Turnstile token source) — unit-tested with node --test
// and end-to-end against the LOCAL Worker + Firestore emulator (workers/order-worker/test/local-e2e). No imports.
//
// Guarantees
// 1. One order number per order CONTENT. Retries reuse the SAME number and the SAME frozen payload, so the
//    Worker's ledger turns repeats into `replay` (one order, one stock deduction, one notification).
// 2. "confirmed" ONLY when the Worker itself answers a well-formed success for this order number
//    (HTTP 200, ok === true, orderId === sent id, replay boolean): created now, or `replay` = a ledger entry
//    exists with the SAME identity hash. The status endpoint (exists:true) is never enough on its own: it only
//    triggers a verification resend of the identical payload.
// 3. Timeout / network loss / 5xx / malformed answers never become success. If a request may have reached the
//    Worker, the outcome is "not_confirmed" with the SAME number — never "rejected", never a new number.
// 4. Nothing personal is stored: the attempt record holds the order number, a SHA-256 content key, a state and
//    two timestamps — in sessionStorage (per tab). Nothing is ever sent automatically.
// 5. No Firestore fallback and no reconciliation here (decided separately).
//
// Invariant for callers (Checkout, Phase 2): while this module is used, the browser must NOT also write the order
// document directly — the Worker must be the only writer of orders/{id}.

export type OrderPayload = { id: string; [k: string]: unknown };

export type SubmitDeps = {
  fetch: (input: string, init?: Record<string, unknown>) => Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;
  sleep?: (ms: number) => Promise<void>;
  isOnline?: () => boolean;
  log?: (event: string, data: Record<string, unknown>) => void;
};

export type SubmitOptions = {
  workerUrl: string;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number[];
  maxRetryAfterMs?: number;
  statusChecks?: number;
  statusDelayMs?: number;
  /** a static token (Phase 1) … */
  turnstileToken?: string;
  /** … or a source of FRESH single-use tokens, asked before every send (Phase 2) */
  getTurnstileToken?: () => Promise<string | null>;
  /**
   * Firebase ID token of the signed-in customer (auth.currentUser.getIdToken(forceRefresh)), or null when nobody is
   * signed in. Sent as "Authorization: Bearer …"; the Worker links the order to the uid it VERIFIES from it.
   * A payload whose userId is not 'guest' is never sent without a token (no silent downgrade to guest).
   */
  getAuthToken?: (forceRefresh: boolean) => Promise<string | null>;
  /**
   * An EARLIER call with this same order number may already have been saved (attempt record 'uncertain' or a
   * possibly-processed send). Then a 400/403 in this call can never mean "nothing was saved": it is resolved via
   * the status endpoint + verification resend instead of returning 'rejected'. Set by submitPrepared().
   */
  mayHaveBeenSavedBefore?: boolean;
  /** sha-256 hash of this attempt's tracking key (trackingKeyHash()); the key itself never leaves the browser here */
  trackingKeyHash?: string;
};

export type NotConfirmedReason = 'timeout' | 'network' | 'server' | 'malformed' | 'unverified';

export type SubmitOutcome =
  | { kind: 'confirmed'; orderId: string; replay: boolean; via: 'create' | 'verify'; attempts: number }
  | { kind: 'not_confirmed'; orderId: string; reason: NotConfirmedReason; existsOnServer: boolean | null; lastCode?: string; attempts: number }
  | { kind: 'conflict'; orderId: string; code: string; existsOnServer: boolean | null; attempts: number }
  | { kind: 'rejected'; orderId: string; status: number; code: string; field?: string; attempts: number }
  | { kind: 'rate_limited'; orderId: string; retryAfterMs: number; attempts: number }
  /** signed-in order, but no valid ID token (could not be obtained, or the Worker refused it even after a refresh).
   *  THIS call was not processed; the number and the attempt record are kept for a same-number retry. */
  | { kind: 'auth_required'; orderId: string; code: string; attempts: number }
  | { kind: 'offline'; orderId: string; attempts: 0 }
  | { kind: 'misconfigured'; orderId: string; reason: string; attempts: 0 };

export const ORDER_ID_RE = /^ORD-[A-Z0-9]{4,16}-[A-Z0-9]{4,16}$/; // = Worker v2 validate.js

const DEFAULTS = { timeoutMs: 12_000, maxAttempts: 3, backoffMs: [1_000, 3_000], maxRetryAfterMs: 10_000, statusChecks: 2, statusDelayMs: 2_000 };
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** New order number in the format the Worker accepts (same shape as Checkout's makeOrderId). */
export function newOrderId(now: number = Date.now()): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  let head = '';
  if (c?.randomUUID) head = c.randomUUID().split('-')[0].toUpperCase();
  else if (c?.getRandomValues) head = [...c.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  if (!/^[A-F0-9]{8}$/.test(head)) throw new Error('secure random source unavailable');
  const tail = Math.max(0, Math.floor(now)).toString(36).toUpperCase().padStart(4, '0').slice(-16);
  return `ORD-${head}-${tail}`; // always matches ORDER_ID_RE (4–16 chars per part)
}

// ------------------------------------------------------------------------------------------------------------
// Tracking key (= Worker src/tracking.js). Generated here, BEFORE the first send, kept by this browser; only its
// sha-256 hash goes to the Worker. Never put in a URL (analytics / pixels may record URLs), never logged.
// ------------------------------------------------------------------------------------------------------------
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const TRACKING_KEY_RE = /^[0-9A-HJKMNP-TV-Z]{24}$/;

/** 120 random bits as 24 Crockford base32 characters. */
export function newTrackingKey(): string {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (!c?.getRandomValues) throw new Error('secure random source unavailable');
  const bytes = c.getRandomValues(new Uint8Array(15));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out; // 15 bytes = 120 bits = exactly 24 characters
}

/** What the customer typed -> canonical key, or null. Same rules as the Worker. */
export function normalizeTrackingKey(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 64) return null;
  const k = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return TRACKING_KEY_RE.test(k) ? k : null;
}

/** Display form: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX */
export const formatTrackingKey = (key: string): string => (normalizeTrackingKey(key) || '').match(/.{1,4}/g)?.join('-') || '';

/** sha256("trk1:" + key) as hex — what the Worker stores and compares. */
export async function trackingKeyHash(key: string): Promise<string> {
  const k = normalizeTrackingKey(key);
  if (!k) throw new Error('invalid tracking key');
  return sha256Hex(`trk1:${k}`);
}

export type OrderSummary = {
  id: string; status: string; date: string;
  items: { name: string; quantity: number; price: number; variant: string; image: string }[];
  subtotal: number; discountAmount: number; shippingCost: number; total: number; paymentMethod: string; shippingMethod: string; paid: boolean;
};
export type SummaryResult = { kind: 'ok'; order: OrderSummary } | { kind: 'denied' } | { kind: 'unavailable' };

/**
 * GET /orders/{id}/summary with the tracking key in a HEADER (never the URL) and/or the signed-in owner's ID token.
 * 'denied' = wrong/missing key, not the owner, unknown or old order (the Worker answers all of these the same).
 */
export async function fetchOrderSummary(
  orderId: string, access: { key?: string | null; idToken?: string | null }, opts: SubmitOptions, deps: SubmitDeps,
): Promise<SummaryResult> {
  const base = normalizeWorkerUrl(opts.workerUrl);
  if (!base || !ORDER_ID_RE.test(orderId)) return { kind: 'unavailable' };
  const headers: Record<string, string> = {};
  const key = access.key ? normalizeTrackingKey(access.key) : null;
  if (key) headers['x-tracking-key'] = key;
  if (access.idToken) headers.authorization = `Bearer ${access.idToken}`;
  if (!key && !access.idToken) return { kind: 'denied' }; // nothing to prove access with: do not even ask
  const r = await call(deps, `${base}/orders/${encodeURIComponent(orderId)}/summary`, { method: 'GET', headers }, opts.timeoutMs ?? DEFAULTS.timeoutMs);
  if ('failed' in r) return { kind: 'unavailable' };
  if (r.status === 404) return { kind: 'denied' };
  const o = r.body?.order as Record<string, unknown> | undefined;
  if (r.status !== 200 || r.body?.ok !== true || !o || o.id !== orderId) return { kind: 'unavailable' };
  return { kind: 'ok', order: o as unknown as OrderSummary };
}

/** Public order status (number only): 'new' | 'processing' | … | 'unknown', or null when not found / unreachable. */
export async function fetchOrderStatus(orderId: string, opts: SubmitOptions, deps: SubmitDeps): Promise<{ exists: boolean; status: string } | null> {
  const base = normalizeWorkerUrl(opts.workerUrl);
  if (!base || !ORDER_ID_RE.test(orderId)) return null;
  const r = await call(deps, `${base}/orders/${encodeURIComponent(orderId)}/status`, { method: 'GET' }, opts.timeoutMs ?? DEFAULTS.timeoutMs);
  if ('failed' in r) return null;
  if (r.status === 404 && r.body?.ok === true && r.body?.exists === false) return { exists: false, status: '' };
  if (r.status === 200 && r.body?.ok === true && r.body?.exists === true) return { exists: true, status: String(r.body.status || 'unknown') };
  return null;
}

/** http(s) base URL without trailing slash; refuses anything else. */
export function normalizeWorkerUrl(u: unknown): string | null {
  const s = typeof u === 'string' ? u.trim() : '';
  if (!s) return null;
  try {
    const x = new URL(s);
    if ((x.protocol !== 'https:' && x.protocol !== 'http:') || x.username || x.password || x.search || x.hash) return null;
    return `${x.origin}${x.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------------------
// Hashes
// ------------------------------------------------------------------------------------------------------------

type AnyRec = Record<string, unknown>;
const isRec = (v: unknown): v is AnyRec => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * EXACT port of Worker v2 orderHash(validateOrderInput(order).value) for a valid order:
 *   [id, userId, items -> [productId ?? id, selectedVariant.id || '', quantity], address.phone, paymentMethod,
 *    addressMeta.citySlug || '', addressMeta.ammanAreaId || '', shippingMethodId || 'standard', round(total*1000)]
 * Parity with the real Worker function is unit-tested.
 */
export async function identityHash(o: AnyRec): Promise<string> {
  const items = Array.isArray(o.items) ? o.items : [];
  const meta = isRec(o.addressMeta) ? o.addressMeta : {};
  const address = isRec(o.address) ? o.address : {};
  const canonical = JSON.stringify([
    o.id,
    o.userId,
    items.map((it) => {
      const i = isRec(it) ? it : {};
      const sv = isRec(i.selectedVariant) ? i.selectedVariant : null;
      const variantId = sv && sv.id !== undefined && sv.id !== null && sv.id !== '' ? sv.id : null;
      return [i.productId ?? i.id, variantId || '', i.quantity];
    }),
    address.phone,
    o.paymentMethod,
    typeof meta.citySlug === 'string' ? meta.citySlug : '',
    typeof meta.ammanAreaId === 'string' ? meta.ammanAreaId : '',
    (typeof o.shippingMethodId === 'string' ? o.shippingMethodId : '') || 'standard',
    Math.round(Number(o.total) * 1000),
  ]);
  return sha256Hex(canonical);
}

/** Keys that change on every rebuild of the same order and do not belong to its content. */
const VOLATILE_KEYS = new Set(['id', 'status', 'seenByAdmin', 'date', 'createdAt', 'createdAtMs', 'updatedAt']);

function canonicalContent(v: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (Array.isArray(v)) return v.map((x) => canonicalContent(x, depth + 1));
  if (isRec(v)) {
    const out: AnyRec = {};
    for (const k of Object.keys(v).sort()) {
      if (depth === 0 && VOLATILE_KEYS.has(k)) continue;
      if (k === 'image') continue; // display-only URLs
      const x = v[k];
      if (x === undefined || typeof x === 'function') continue;
      out[k] = canonicalContent(x, depth + 1);
    }
    return out;
  }
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return v === undefined ? null : v;
}

/**
 * Content key of an order: SHA-256 over EVERYTHING the customer entered (items, quantities, prices, name, street,
 * city, phone, e-mail, note, CliQ reference, shipping, totals, consents …) except volatile fields
 * (id, status, seenByAdmin, date, createdAt*, updatedAt) and display images. Only this hash is ever stored.
 */
export async function attemptKey(order: AnyRec): Promise<string> {
  return sha256Hex(`content-v1|${JSON.stringify(canonicalContent(order))}`);
}

// ------------------------------------------------------------------------------------------------------------
// Transport
// ------------------------------------------------------------------------------------------------------------

type Resp = { status: number; body: AnyRec | null; retryAfterMs: number | null };
type Failure = { failed: 'timeout' | 'network' };
/** not sent at all: the order belongs to a signed-in customer and no ID token could be obtained */
type NoToken = { noToken: true };
const AUTH_RETRY_CODES = new Set(['AUTH_EXPIRED', 'AUTH_INVALID']);

async function call(deps: SubmitDeps, url: string, init: AnyRec, timeoutMs: number): Promise<Resp | Failure> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Failure>((resolve) => {
    timer = setTimeout(() => {
      ctl?.abort();
      resolve({ failed: 'timeout' });
    }, timeoutMs);
  });
  const request = (async (): Promise<Resp | Failure> => {
    try {
      const r = await deps.fetch(url, { ...init, signal: ctl?.signal });
      const text = await r.text();
      let body: AnyRec | null = null;
      try {
        const parsed = JSON.parse(text);
        body = isRec(parsed) ? parsed : null;
      } catch {}
      const ra = Number(r.headers.get('retry-after'));
      return { status: r.status, body, retryAfterMs: Number.isFinite(ra) && ra >= 0 ? ra * 1000 : null };
    } catch (e) {
      return { failed: (e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network' };
    }
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** true = an order document with this number exists, false = the Worker says it does not, null = unknown. */
export async function checkOrderStatus(orderId: string, opts: SubmitOptions, deps: SubmitDeps): Promise<boolean | null> {
  const base = normalizeWorkerUrl(opts.workerUrl);
  if (!base || !ORDER_ID_RE.test(orderId)) return null;
  const r = await call(deps, `${base}/orders/${encodeURIComponent(orderId)}/status`, { method: 'GET' }, opts.timeoutMs ?? DEFAULTS.timeoutMs);
  if ('failed' in r) return null;
  if (r.status === 200 && r.body?.ok === true && r.body?.exists === true) return true;
  if (r.status === 404 && r.body?.ok === true && r.body?.exists === false) return false;
  return null;
}

/** Waits first (an attempt that timed out on our side may still be finishing on the Worker), then asks. */
async function statusAfterWait(orderId: string, opts: SubmitOptions, deps: SubmitDeps): Promise<{ exists: boolean | null; notFoundCount: number }> {
  const sleep = deps.sleep ?? realSleep;
  const checks = Math.max(1, opts.statusChecks ?? DEFAULTS.statusChecks);
  let notFound = 0;
  let last: boolean | null = null;
  for (let i = 0; i < checks; i++) {
    await sleep(opts.statusDelayMs ?? DEFAULTS.statusDelayMs);
    last = await checkOrderStatus(orderId, opts, deps);
    if (last === true) return { exists: true, notFoundCount: notFound };
    if (last === false) notFound++;
  }
  // "not found" only if EVERY check said so; any unknown answer keeps it unknown
  return { exists: notFound === checks ? false : null, notFoundCount: notFound };
}

const isWellFormedSuccess = (r: Resp, orderId: string) =>
  r.status === 200 && r.body?.ok === true && r.body?.orderId === orderId && typeof r.body?.replay === 'boolean';

// ------------------------------------------------------------------------------------------------------------
// Submission
// ------------------------------------------------------------------------------------------------------------

/** Send ONE order (fixed number, frozen payload) with retries. Never invents success, never changes the number. */
export async function submitOrder(order: OrderPayload, opts: SubmitOptions, deps: SubmitDeps): Promise<SubmitOutcome> {
  const orderId = String(order?.id ?? '');
  const log = deps.log ?? (() => {});
  const sleep = deps.sleep ?? realSleep;
  const base = normalizeWorkerUrl(opts.workerUrl);
  if (!base) return { kind: 'misconfigured', orderId, reason: 'worker URL missing or invalid', attempts: 0 };
  if (!ORDER_ID_RE.test(orderId)) return { kind: 'misconfigured', orderId, reason: 'invalid order id', attempts: 0 };
  if (deps.isOnline && !deps.isOnline()) return { kind: 'offline', orderId, attempts: 0 };

  const frozen = JSON.parse(JSON.stringify(order)); // later changes by the caller cannot leak into retries
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  // a signed-in customer's order (userId is a uid) must carry a verified identity: never sent as an anonymous request
  const needsAuth = typeof frozen.userId === 'string' && frozen.userId !== 'guest' && frozen.userId !== '';
  let refreshToken = false; // set after a 401: the next send asks Firebase for a NEW token
  const send = async (): Promise<Resp | Failure | NoToken> => {
    let idToken: string | null = null;
    if (opts.getAuthToken && needsAuth) {
      try {
        idToken = await opts.getAuthToken(refreshToken);
      } catch {
        idToken = null;
      }
    }
    if (needsAuth && !idToken) return { noToken: true };
    const token = opts.getTurnstileToken ? await opts.getTurnstileToken().catch(() => null) : opts.turnstileToken;
    // trackingKeyHash travels NEXT TO the order (not inside it): never part of the payload hash or the content key
    const tkh = typeof opts.trackingKeyHash === 'string' && /^[a-f0-9]{64}$/.test(opts.trackingKeyHash) ? opts.trackingKeyHash : null;
    const body = JSON.stringify({ order: frozen, ...(token ? { turnstileToken: token } : {}), ...(tkh ? { trackingKeyHash: tkh } : {}) });
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    // only an order that BELONGS to an account carries that account's token. A guest payload never does: if someone
    // else signed in on this device meanwhile, resending a guest order must not link it to their account.
    if (idToken && needsAuth) headers.authorization = `Bearer ${idToken}`;
    return call(deps, `${base}/create-order`, { method: 'POST', headers, body }, timeoutMs);
  };

  const maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULTS.maxAttempts);
  const backoff = opts.backoffMs ?? DEFAULTS.backoffMs;
  let maybeCommitted = opts.mayHaveBeenSavedBefore === true; // carried over from earlier calls
  let lastProblem: NotConfirmedReason = 'network';
  let lastCode: string | undefined;
  let lastRateLimit: number | null = null;
  let attempts = 0;
  let authRetried = false;
  let immediate = false; // the resend right after a token refresh does not wait

  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0 && !immediate) {
      if (deps.isOnline && !deps.isOnline()) break;
      await sleep(lastRateLimit !== null ? lastRateLimit : backoff[Math.min(i - 1, backoff.length - 1)] ?? 1_000);
    }
    immediate = false;
    lastRateLimit = null;
    const r = await send();
    if ('noToken' in r) {
      // nothing was sent in THIS call. An earlier call may have been saved -> resolve via status (below).
      lastCode = 'AUTH_TOKEN_UNAVAILABLE';
      if (!maybeCommitted) return { kind: 'auth_required', orderId, code: 'AUTH_TOKEN_UNAVAILABLE', attempts };
      break;
    }
    attempts++;

    if ('failed' in r) {
      maybeCommitted = true; // the request may have reached the Worker
      lastProblem = r.failed;
      log('submit.retryable', { orderId, attempt: attempts, problem: r.failed });
      continue;
    }
    if (isWellFormedSuccess(r, orderId)) return { kind: 'confirmed', orderId, replay: r.body!.replay as boolean, via: 'create', attempts };

    const code = typeof r.body?.code === 'string' ? (r.body.code as string) : `HTTP_${r.status}`;
    lastCode = code;
    if (r.status === 200) {
      maybeCommitted = true;
      lastProblem = 'malformed';
      continue;
    }
    if (r.status === 429) {
      // rejected by the rate limiter before any processing
      lastRateLimit = Math.min(r.retryAfterMs ?? backoff[Math.min(i, backoff.length - 1)] ?? 1_000, opts.maxRetryAfterMs ?? DEFAULTS.maxRetryAfterMs);
      continue;
    }
    if (r.status === 409) {
      // the number exists with DIFFERENT content (or an old browser-written document): never a new number here
      return { kind: 'conflict', orderId, code, existsOnServer: await checkOrderStatus(orderId, opts, deps), attempts };
    }
    if (r.status === 401 && AUTH_RETRY_CODES.has(code)) {
      // the Worker refused the ID token BEFORE any processing. Refresh it once and resend the SAME payload/number.
      refreshToken = true;
      if (!authRetried) {
        authRetried = true;
        immediate = true;
        i -= 1; // the refresh-resend does not use up a network retry
        continue;
      }
      if (!maybeCommitted) return { kind: 'auth_required', orderId, code, attempts };
      break; // an earlier call may have been saved -> status + verification below
    }
    if (r.status >= 500) {
      // 503 RETRY_LATER is not proof that nothing was saved (e.g. a commit whose answer was lost)
      maybeCommitted = true;
      lastProblem = 'server';
      continue;
    }
    // other 4xx (400 / 403 / 413): THIS request was refused before processing …
    if (!maybeCommitted) {
      const field = typeof r.body?.field === 'string' ? (r.body.field as string) : undefined;
      return { kind: 'rejected', orderId, status: r.status, code, ...(field ? { field } : {}), attempts };
    }
    // … but an EARLIER attempt may have been saved (e.g. a single-use Turnstile token already consumed)
    break;
  }

  if (!maybeCommitted || attempts === 0) {
    if (attempts === 0) return { kind: 'offline', orderId, attempts: 0 };
    if (!maybeCommitted) return { kind: 'rate_limited', orderId, retryAfterMs: lastRateLimit ?? 0, attempts };
  }

  // ---- uncertain: ask the status endpoint, then verify by resending the identical payload ----
  const st = await statusAfterWait(orderId, opts, deps);
  if (st.exists === true) {
    if (!deps.isOnline || deps.isOnline()) {
      const v = await send();
      if (!('noToken' in v)) attempts++;
      if (!('failed' in v) && !('noToken' in v)) {
        if (isWellFormedSuccess(v, orderId)) return { kind: 'confirmed', orderId, replay: v.body!.replay as boolean, via: 'verify', attempts };
        if (v.status === 409) return { kind: 'conflict', orderId, code: typeof v.body?.code === 'string' ? (v.body.code as string) : 'HTTP_409', existsOnServer: true, attempts };
        lastCode = typeof v.body?.code === 'string' ? (v.body.code as string) : `HTTP_${v.status}`;
      }
    }
    return { kind: 'not_confirmed', orderId, reason: 'unverified', existsOnServer: true, ...(lastCode ? { lastCode } : {}), attempts };
  }
  // false (twice) is NOT proof of failure: the attempt may still be in flight — keep the same number
  return { kind: 'not_confirmed', orderId, reason: lastProblem, existsOnServer: st.exists, ...(lastCode ? { lastCode } : {}), attempts };
}

// ------------------------------------------------------------------------------------------------------------
// Stable order number across retries (and reloads of the same tab), without storing personal data.
// ------------------------------------------------------------------------------------------------------------

export type AttemptState = 'pending' | 'uncertain' | 'confirmed';
export type AttemptRecord = {
  orderId: string; key: string; state: AttemptState; updatedAt: number; lastSentAt: number | null; trackingKey?: string;
  /** who placed it: 'guest' or the Firebase uid (no personal data). Absent on older records = unknown owner. */
  who?: string;
  /** saved order recovered while ANOTHER identity used this device: tell its owner ("who") once they are back */
  ownerNotice?: true;
};
/** Identity an order belongs to: its userId, or 'guest'. */
export const identityOf = (order: object | null | undefined): string => {
  const u = String((order as { userId?: unknown } | null | undefined)?.userId ?? '').trim();
  return u && u !== 'guest' ? u : 'guest';
};
const WHO_RE = /^[A-Za-z0-9_-]{1,128}$/;
/**
 * Where attempt records live. get/set/clear = the single-record API (sessionAttemptStore, kept for compatibility);
 * all/remove = several records (localAttemptStore). Records hold NO personal data: order number, content hash
 * (sha-256), state, two timestamps and the attempt's tracking key.
 */
export type AttemptStore = { get(): AttemptRecord | null; set(r: AttemptRecord): void; clear(): void; all?(): AttemptRecord[]; remove?(orderId: string): void };

type KvStorage = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

export const ATTEMPT_STORAGE_KEY = 'anta_checkout_attempt'; // v1, sessionStorage (one record, one tab)
export const ATTEMPTS_V2_KEY = 'anta_checkout_attempts_v2'; // v2, localStorage (several records, every tab, survives closing)
/** A sent attempt is treated as possibly still in flight for this long (Worker processing + commit + slack). */
export const SETTLE_MS = 120_000;
/** Confirmed records kept for the duplicate guard; unresolved records are NEVER dropped. */
export const MAX_CONFIRMED_KEPT = 5;
export const MAX_OWNER_NOTICES = 10; // recovered orders of another identity on this device, waiting for their owner

function parseRecord(r: unknown): AttemptRecord | null {
  const x = r as Record<string, unknown> | null;
  if (!x || typeof x !== 'object' || !ORDER_ID_RE.test(String(x.orderId)) || !/^[a-f0-9]{64}$/.test(String(x.key)) || !['pending', 'uncertain', 'confirmed'].includes(String(x.state))) return null;
  const lastSentAt = typeof x.lastSentAt === 'number' && Number.isFinite(x.lastSentAt) ? x.lastSentAt : null;
  const trackingKey = typeof x.trackingKey === 'string' && TRACKING_KEY_RE.test(x.trackingKey) ? x.trackingKey : undefined;
  const who = typeof x.who === 'string' && WHO_RE.test(x.who) ? x.who : undefined;
  return { orderId: String(x.orderId), key: String(x.key), state: x.state as AttemptState, updatedAt: Number(x.updatedAt) || 0, lastSentAt, ...(trackingKey ? { trackingKey } : {}), ...(who ? { who } : {}), ...(x.ownerNotice === true ? { ownerNotice: true as const } : {}) };
}
const serializeRecord = (r: AttemptRecord) => ({ orderId: r.orderId, key: r.key, state: r.state, updatedAt: r.updatedAt, lastSentAt: r.lastSentAt, ...(r.trackingKey ? { trackingKey: r.trackingKey } : {}), ...(r.who ? { who: r.who } : {}), ...(r.ownerNotice ? { ownerNotice: true } : {}) });

/** sessionStorage-backed store (v1): only { orderId, key (sha-256 hex), state, updatedAt, lastSentAt } — validated on read. */
export function sessionAttemptStore(storage: KvStorage | null | undefined = (globalThis as { sessionStorage?: KvStorage }).sessionStorage): AttemptStore {
  return {
    get() {
      try {
        return parseRecord(JSON.parse(storage?.getItem(ATTEMPT_STORAGE_KEY) || 'null'));
      } catch {
        return null;
      }
    },
    set(r) {
      try {
        storage?.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(serializeRecord(r)));
      } catch {}
    },
    clear() {
      try {
        storage?.removeItem(ATTEMPT_STORAGE_KEY);
      } catch {}
    },
  };
}

const isOpen = (r: AttemptRecord) => r.state !== 'confirmed';
const newestFirst = (a: AttemptRecord, b: AttemptRecord) => b.updatedAt - a.updatedAt;

/**
 * localStorage-backed store (v2): survives refresh, closing the tab and reopening the browser, shared by all tabs.
 * - several records; an unresolved (pending/uncertain) record is NEVER dropped — not by age, not by the size cap;
 * - only confirmed records beyond MAX_CONFIRMED_KEPT are pruned (oldest first);
 * - a corrupt entry is ignored on its own (the others survive);
 * - migration: a v1 sessionStorage record of this tab is moved in (same number, same tracking key) and only then
 *   removed from sessionStorage; a v1 record and a different v2 record are BOTH kept.
 * Personal data is never stored here.
 */
export function localAttemptStore(
  local: KvStorage | null | undefined = (globalThis as { localStorage?: KvStorage }).localStorage,
  legacySession: KvStorage | null | undefined = (globalThis as { sessionStorage?: KvStorage }).sessionStorage,
): AttemptStore & { all(): AttemptRecord[]; remove(orderId: string): void } {
  const readRaw = (): AttemptRecord[] => {
    try {
      const v = JSON.parse(local?.getItem(ATTEMPTS_V2_KEY) || 'null');
      const list = Array.isArray(v?.attempts) ? v.attempts : [];
      const out: AttemptRecord[] = [];
      for (const x of list) {
        const r = parseRecord(x);
        if (r && !out.some((o) => o.orderId === r.orderId)) out.push(r);
      }
      return out;
    } catch {
      return [];
    }
  };
  const write = (list: AttemptRecord[]): boolean => {
    const open = list.filter(isOpen);
    // owner notices are kept apart (not pushed out by another account's later orders), bounded
    const notices = list.filter((r) => !isOpen(r) && r.ownerNotice).sort(newestFirst).slice(0, MAX_OWNER_NOTICES);
    const done = [...list.filter((r) => !isOpen(r) && !r.ownerNotice).sort(newestFirst).slice(0, MAX_CONFIRMED_KEPT), ...notices];
    try {
      local?.setItem(ATTEMPTS_V2_KEY, JSON.stringify({ v: 2, attempts: [...open, ...done].map(serializeRecord) }));
      return true;
    } catch {
      return false;
    }
  };
  const read = (): AttemptRecord[] => {
    const list = readRaw();
    // migrate this tab's v1 record (if any) — keep its number and tracking key; never overwrite a v2 record
    try {
      const raw = legacySession?.getItem(ATTEMPT_STORAGE_KEY);
      if (raw) {
        const legacy = parseRecord(JSON.parse(raw));
        if (legacy) {
          if (!list.some((r) => r.orderId === legacy.orderId)) list.push(legacy);
          if (write(list)) legacySession?.removeItem(ATTEMPT_STORAGE_KEY);
        } else {
          legacySession?.removeItem(ATTEMPT_STORAGE_KEY); // unreadable v1 record: nothing to keep
        }
      }
    } catch {}
    return list;
  };
  const all = () => read();
  return {
    all,
    get() {
      const list = all();
      return [...list.filter(isOpen)].sort(newestFirst)[0] ?? [...list].sort(newestFirst)[0] ?? null;
    },
    set(r) {
      const list = all().filter((x) => x.orderId !== r.orderId);
      write([...list, r]);
    },
    remove(orderId) {
      write(all().filter((x) => x.orderId !== orderId));
    },
    clear() {
      const cur = this.get();
      if (cur) this.remove(cur.orderId);
    },
  };
}

const recordsOf = (s: AttemptStore): AttemptRecord[] => {
  if (s.all) return s.all();
  const one = s.get();
  return one ? [one] : [];
};
/** The record of ONE order number (multi-record stores), or the single record when it has that number. */
export const recordFor = (s: AttemptStore, orderId: string): AttemptRecord | null => recordsOf(s).find((r) => r.orderId === orderId) ?? null;
const dropRecord = (s: AttemptStore, orderId: string) => {
  if (s.remove) s.remove(orderId);
  else if (s.get()?.orderId === orderId) s.clear();
};
/**
 * Remove an attempt ONLY if it is open and was NEVER sent (lastSentAt null): it cannot exist on the Worker. Used when
 * this tab lost the cross-tab lock right after preparing (nothing may be sent). Anything possibly sent is kept.
 */
export function dropOpenUnsent(s: AttemptStore, orderId: string): boolean {
  const r = recordFor(s, orderId);
  if (!r || !isOpen(r) || r.lastSentAt !== null) return false;
  dropRecord(s, orderId);
  return true;
}
/** Saved orders recovered while another identity used this device, waiting to be shown to their owner. */
export const ownerNoticesFor = (s: AttemptStore, who: string): AttemptRecord[] =>
  recordsOf(s).filter((r) => r.state === 'confirmed' && r.ownerNotice === true && r.who === who && !!r.trackingKey);
/** Unresolved (pending/uncertain) attempts, newest first. */
export const openAttempts = (s: AttemptStore): AttemptRecord[] => recordsOf(s).filter(isOpen).sort(newestFirst);

export type PreparedAttempt =
  | { ok: true; orderId: string; reused: boolean; key: string; trackingKey: string }
  | { ok: false; reason: 'previous_unresolved'; previousOrderId: string; openOrderIds: string[] }
  | { ok: false; reason: 'confirmed_while_open'; previousOrderId: string };

/**
 * Order number for this checkout:
 * - same CONTENT as an unfinished attempt -> same number (safe replay);
 * - different content (incl. name, street, e-mail, note, CliQ reference) while an earlier attempt is unfinished
 *   -> refused: that earlier order may exist. Call resolvePreviousAttempt() first;
 * - a confirmed attempt never blocks a new order — EXCEPT the same content confirmed after this checkout page was
 *   opened (`openedAt`): another tab finished it while this one waited, or it was just recovered. No time window:
 *   a page opened after the confirmation can always place a deliberate identical order.
 */
export async function prepareAttempt(order: AnyRec, store: AttemptStore, now: () => number = Date.now, openedAt?: number): Promise<PreparedAttempt> {
  const key = await attemptKey(order);
  const records = recordsOf(store);
  const open = records.filter(isOpen).sort(newestFirst);
  // same content: prefer an attempt that MAY have been sent (it may exist) over a never-sent one
  const same = open.find((r) => r.key === key && r.lastSentAt !== null) ?? open.find((r) => r.key === key);
  if (same) {
    // the SAME tracking key for every resend of this attempt (a record from before tracking keys gets one now)
    let trackingKey = same.trackingKey;
    if (!trackingKey) {
      trackingKey = newTrackingKey();
      store.set({ ...same, trackingKey });
    }
    return { ok: true, orderId: same.orderId, reused: true, key, trackingKey };
  }
  // ANY unresolved attempt with other content blocks a new number (it may exist; 404 is never proof)
  if (open.length) return { ok: false, reason: 'previous_unresolved', previousOrderId: open[0].orderId, openOrderIds: open.map((r) => r.orderId) };
  // the same content was confirmed AFTER this page was opened (another tab, or recovery): not a second order
  if (typeof openedAt === 'number') {
    const meanwhile = records.find((r) => !isOpen(r) && r.key === key && r.updatedAt >= openedAt);
    if (meanwhile) return { ok: false, reason: 'confirmed_while_open', previousOrderId: meanwhile.orderId };
  }
  const orderId = newOrderId(now());
  // generated HERE, before anything is sent: a lost create response can never lose it
  const trackingKey = newTrackingKey();
  store.set({ orderId, key, state: 'pending', updatedAt: now(), lastSentAt: null, trackingKey, who: identityOf(order) });
  return { ok: true, orderId, reused: false, key, trackingKey };
}

/** True if ANY earlier call with this number may have been saved by the Worker (across calls and reloads). */
export function mayHaveBeenSaved(rec: AttemptRecord | null, orderId: string): boolean {
  return !!rec && rec.orderId === orderId && (rec.state === 'uncertain' || rec.state === 'confirmed' || rec.lastSentAt !== null);
}

/**
 * Record what happened so a retry or a reload behaves safely. Nothing is ever resent automatically.
 * `lastSentAt` only moves on sends that may have been PROCESSED (not on offline / rate-limited calls).
 * A record that may have been saved is never cleared or downgraded by a later rejected/misconfigured call.
 */
export function recordOutcome(
  store: AttemptStore, prepared: { orderId: string; key: string; trackingKey?: string }, outcome: SubmitOutcome, now: () => number = Date.now,
  /** lastSentAt BEFORE the write-ahead mark of submitPrepared (restored when this call was not processed) */
  sentBefore?: number | null,
): void {
  const stored = recordFor(store, prepared.orderId);
  const same = stored && sentBefore !== undefined ? { ...stored, lastSentAt: sentBefore } : stored;
  const keepSent = same ? same.lastSentAt : null;
  const trackingKey = same?.trackingKey || prepared.trackingKey; // never lost while the attempt lives
  const put = (state: AttemptState, lastSentAt: number | null) =>
    store.set({ orderId: prepared.orderId, key: prepared.key, state, updatedAt: now(), lastSentAt, ...(trackingKey ? { trackingKey } : {}), ...(same?.who ? { who: same.who } : {}) });
  switch (outcome.kind) {
    case 'confirmed':
      return put('confirmed', now());
    case 'not_confirmed':
    case 'conflict':
      return put('uncertain', now());
    case 'auth_required':
      // THIS call was not processed (no/refused ID token): keep number, state and lastSentAt for a same-number retry
      return put(same?.state === 'uncertain' ? 'uncertain' : same?.state === 'confirmed' ? 'confirmed' : 'pending', keepSent);
    case 'rejected':
    case 'misconfigured':
      // THIS call was refused before processing. Clear only if NO call with this number could have been saved;
      // otherwise keep the number and the 'uncertain' state (a Turnstile token may have expired, the Worker URL
      // may have changed, … — none of that proves the earlier attempt was not saved).
      if (mayHaveBeenSaved(same, prepared.orderId)) return put(same!.state === 'confirmed' ? 'confirmed' : 'uncertain', keepSent);
      return dropRecord(store, prepared.orderId);
    default:
      // offline / rate_limited: nothing reached the Worker's processing -> keep number, state and lastSentAt
      return put(same?.state === 'uncertain' ? 'uncertain' : same?.state === 'confirmed' ? 'confirmed' : 'pending', keepSent);
  }
}

/**
 * The safe way to (re)send a prepared attempt: carries "an earlier call may have been saved" from the attempt
 * record into submitOrder (so a later 400/403 is never taken as "nothing saved"), then records the outcome.
 */
export async function submitPrepared(
  order: OrderPayload, prepared: { orderId: string; key: string; trackingKey?: string }, store: AttemptStore, opts: SubmitOptions, deps: SubmitDeps, now: () => number = Date.now,
): Promise<SubmitOutcome> {
  if (order.id !== prepared.orderId) throw new Error('order.id must be the prepared order number');
  const rec = recordFor(store, prepared.orderId);
  const before = mayHaveBeenSaved(rec, prepared.orderId);
  const sentBefore = rec ? rec.lastSentAt : null;
  // WRITE-AHEAD: mark "may have been sent" BEFORE sending. If the tab is closed while the request is in flight, the
  // record already says so after reopening (a later different order is then refused, not given a new number).
  store.set({
    orderId: prepared.orderId, key: prepared.key, state: rec?.state ?? 'pending', updatedAt: now(), lastSentAt: now(),
    ...(rec?.trackingKey || prepared.trackingKey ? { trackingKey: rec?.trackingKey || prepared.trackingKey } : {}),
    ...(rec?.who ? { who: rec.who } : {}),
  });
  const outcome = await submitOrder(order, { ...opts, mayHaveBeenSavedBefore: before || opts.mayHaveBeenSavedBefore === true }, deps);
  recordOutcome(store, prepared, outcome, now, sentBefore);
  return outcome;
}

export type PreviousResolution =
  | { state: 'none' }
  | { state: 'confirmed'; orderId: string }
  | { state: 'exists_unverified'; orderId: string }
  | { state: 'not_found'; orderId: string; settled: boolean; retryAfterMs: number }
  | { state: 'unknown'; orderId: string };

/**
 * Before starting a DIFFERENT order while an earlier attempt is unfinished (its payload is no longer in memory).
 * READ-ONLY: it never clears the record. The client cannot prove that an old request is no longer in flight
 * (Worker processing cannot be cancelled from here), so "404 twice + time" is only reported, never acted upon:
 * - exists      -> 'exists_unverified': show that number, do NOT create another, do NOT call it confirmed;
 * - not found   -> 'not_found' (settled = every check said 404 AND the last possibly-processed send is older than
 *                  SETTLE_MS) — still kept; starting over needs an explicit, user-confirmed abandonPreviousAttempt();
 * - otherwise   -> 'unknown'.
 * The ONLY retry that can never duplicate is resending the same content with the same number (submitPrepared).
 */
export async function resolvePreviousAttempt(store: AttemptStore, opts: SubmitOptions, deps: SubmitDeps, now: () => number = Date.now): Promise<PreviousResolution> {
  const prev = store.get();
  if (!prev) return { state: 'none' };
  if (prev.state === 'confirmed') return { state: 'confirmed', orderId: prev.orderId };
  const st = await statusAfterWait(prev.orderId, { ...opts, statusChecks: Math.max(2, opts.statusChecks ?? DEFAULTS.statusChecks) }, deps);
  if (st.exists === true) return { state: 'exists_unverified', orderId: prev.orderId };
  if (st.exists === false) {
    const since = now() - (prev.lastSentAt ?? prev.updatedAt);
    return { state: 'not_found', orderId: prev.orderId, settled: since >= SETTLE_MS, retryAfterMs: Math.max(0, SETTLE_MS - since) };
  }
  return { state: 'unknown', orderId: prev.orderId };
}

export type PendingRecovery =
  | { orderId: string; state: 'recovered'; trackingKey: string } // saved AND provably ours (summary opened with OUR key)
  | { orderId: string; state: 'exists_unverified' } // an order with this number exists, not provable by this device
  | { orderId: string; state: 'not_found_yet' } // 404 now — NOT proof it never will exist (may still be in flight)
  | { orderId: string; state: 'unknown' }; // Worker unreachable

/**
 * After a refresh / reopening the browser: check every UNRESOLVED attempt once (no waiting, nothing sent).
 * - The order summary opens with this attempt's tracking key -> the Worker stored OUR key hash in the ledger, i.e. the
 *   order was saved from this attempt: the record becomes 'confirmed' ('recovered').
 * - Otherwise the public status is only REPORTED. Nothing is ever removed or downgraded here; a 404 keeps the
 *   attempt unresolved (it blocks a new number; the same content can still be resent with the same number).
 */
export async function resolvePendingAttempts(store: AttemptStore, opts: SubmitOptions, deps: SubmitDeps, now: () => number = Date.now): Promise<PendingRecovery[]> {
  const out: PendingRecovery[] = [];
  for (const rec of openAttempts(store)) {
    if (rec.trackingKey) {
      const s = await fetchOrderSummary(rec.orderId, { key: rec.trackingKey }, opts, deps);
      if (s.kind === 'ok') {
        const cur = recordFor(store, rec.orderId) ?? rec; // re-read: another tab may have changed it meanwhile
        if (cur.state !== 'confirmed') store.set({ ...cur, state: 'confirmed', updatedAt: now() });
        out.push({ orderId: rec.orderId, state: 'recovered', trackingKey: rec.trackingKey });
        continue;
      }
    }
    const st = await checkOrderStatus(rec.orderId, opts, deps);
    out.push(st === true ? { orderId: rec.orderId, state: 'exists_unverified' } : st === false ? { orderId: rec.orderId, state: 'not_found_yet' } : { orderId: rec.orderId, state: 'unknown' });
  }
  return out;
}

/**
 * Explicit, user-confirmed abandonment of an unresolved attempt (UI decision, never automatic). It cannot stop an
 * old request that is still in flight; a guaranteed cancel needs a Worker-side tombstone on orderLedger/{id}
 * (proposed separately, not implemented — the Worker is out of scope here).
 */
export function abandonPreviousAttempt(store: AttemptStore): void {
  store.clear();
}
