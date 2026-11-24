// Prize wheel. Visible only in a build with VITE_WHEEL_MODE=test (sandbox / local) or =live (the approved production
// campaign). The draw happens on the Worker; the browser only asks and shows.
//
// Nothing here is a protection: the Worker decides the result, stores it (under a ticket, then the account), re-checks the
// prize (owner, status, expiry, minimum, previous delivered order, prices) on every order. The browser only keeps a
// preference (which prize to use) and the "popup already shown" flag — both harmless if edited or cleared.
import { normalizeWorkerUrl, type SubmitDeps } from './orderSubmit.ts';

declare const __DEPLOY_ENV__: string | undefined;
// a production build never shows the TEST wheel (only an explicit VITE_WHEEL_MODE=live)
const PRODUCTION_BUILD = typeof __DEPLOY_ENV__ !== 'undefined' && __DEPLOY_ENV__ === 'production';
declare const __WHEEL_MODE__: string | undefined;
// a Vite build: the constant from vite.config.ts (folded at build time); Node tests: the variable, if any
const VITE_WHEEL = typeof __WHEEL_MODE__ !== 'undefined' ? __WHEEL_MODE__ : (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_WHEEL_MODE;
// 'test': sandbox / local builds only (a production build ignores it). 'live': the approved production campaign
// (owner's decision 2026-11-21) — the production Worker must run WHEEL_MODE=live too, otherwise every call is a 404.
export const WHEEL_ENABLED = VITE_WHEEL === 'live' || (!PRODUCTION_BUILD && VITE_WHEEL === 'test');
// the "test version" badge: a TEST build only — never shown to customers of the live campaign
export const WHEEL_TEST_BUILD = WHEEL_ENABLED && VITE_WHEEL !== 'live';
export const WHEEL_SPIN_ID_RE = /^[a-z0-9-]{1,40}_[A-Za-z0-9_-]{1,128}_\d{1,4}$/;
const PRIZE_KEY = 'anta_wheel_prize_v1';
const POPUP_KEY = 'anta_wheel_popup_seen_v1';

export type PrizeType = 'gift' | 'discount' | 'free_delivery' | 'none';
// chance: the REAL chance of this segment for this customer (0..1, from the Worker; segments are drawn the same size)
export type WheelSlot = { id: string; type: PrizeType; label: string; description: string; icon: string; color: string | null; imageUrl: string; valueJod: number; minOrderJod: number; appliesTo: 'this_order' | 'next_order'; chance: number | null };
export type WheelSpin = {
  spinId: string; n: number; prizeId: string; label: string; status: string; orderId: string | null;
  type: PrizeType; valueJod: number; minOrderJod: number | null; appliesTo: 'this_order' | 'next_order'; description: string; expiresAt: string | null;
  // second-order prize: kept until (campaign end) while waiting for the first delivery; when its 5 days started
  waitingUntil?: string | null; activatedAt?: string | null;
  // second-order prize: create the first order before this (5 days from the win); the first order it waits for
  firstOrderBy?: string | null; firstOrderId?: string | null;
  // ...the first order must be DELIVERED before this (its creation + 7 days); why an ended prize ended
  deliveryBy?: string | null; expiredReason?: string | null;
};
export type WheelPublic = { campaign: string; slots: WheelSlot[]; minOrderJod: number | null; prizeHoldMinutes: number; terms: string };
export type WheelState = { campaign: string; minOrderJod: number | null; terms: string; prizeHoldMinutes: number; chancesLeft: number; spins: WheelSpin[]; slots: WheelSlot[]; previousDelivered: boolean | null;
  // where the account stands for a second-order prize (Worker's reading): none | pending | one_delivered | past
  secondOrder: string | null; secondOrderHours: number };
/**
 * WHY a wheel call failed (shown to the customer as it is; a failed call never uses a spin):
 *   network      no answer at all (offline, DNS, blocked request)
 *   timeout      no answer within the time limit (WHEEL_TIMEOUT_MS) — the request is abandoned, never left spinning
 *   rate_limited 429 RATE_LIMITED — too many requests in a short time
 *   server       5xx (503 UNAVAILABLE: the database refused / was unreachable)
 *   security     403 TURNSTILE_FAILED — the security check (Cloudflare Turnstile) is missing or failed
 *   refused      any other answer (its status / code kept for the message)
 */
export type WheelFailure = 'network' | 'timeout' | 'rate_limited' | 'server' | 'security' | 'refused';

/** time limit of every wheel request (ms): a slow / stuck answer ends as 'timeout' instead of an endless "loading" */
export const WHEEL_TIMEOUT_MS = 15_000;
class WheelTimeout extends Error {}
/** the request, abandoned after `ms` (aborted when the fetch supports a signal; the race covers any fetch) */
async function timed<T>(start: (signal: AbortSignal | undefined) => Promise<T>, ms = WHEEL_TIMEOUT_MS): Promise<T> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => { try { ctl?.abort(); } catch { /* ignore */ } reject(new WheelTimeout('timeout')); }, ms); });
  try {
    return await Promise.race([start(ctl?.signal), limit]);
  } finally {
    clearTimeout(timer);
  }
}
export type WheelUnavailable = { kind: 'unavailable'; reason: WheelFailure; status?: number; code?: string };
export function failureOf(status: number | null, body?: any): WheelUnavailable {
  const code = typeof body?.code === 'string' ? body.code.slice(0, 60) : undefined;
  if (status === null) return { kind: 'unavailable', reason: 'network' };
  if (status === 429) return { kind: 'unavailable', reason: 'rate_limited', status, code };
  if (status >= 500) return { kind: 'unavailable', reason: 'server', status, code };
  if (status === 403 && code === 'TURNSTILE_FAILED') return { kind: 'unavailable', reason: 'security', status, code };
  return { kind: 'unavailable', reason: 'refused', status, code };
}
/** the customer's message for a failed spin (Arabic / English) */
export function failureText(f: WheelUnavailable, isAR: boolean): string {
  const L = (ar: string, en: string) => (isAR ? ar : en);
  const kept = L(' لم تُستخدم لفّتك.', ' Your spin was not used.');
  switch (f.reason) {
    case 'timeout': return L('استغرق الاتصال وقتًا أطول من المعتاد. تحقّق من الإنترنت ثم أعد المحاولة.', 'The connection took longer than usual. Check your internet and try again.') + kept;
    case 'network': return L('تعذّر الاتصال بالخادم. تحقّق من اتصالك بالإنترنت ثم حاول مجددًا.', 'Could not reach the server. Check your internet connection and try again.') + kept;
    case 'rate_limited': return L('طلبات كثيرة خلال وقت قصير. انتظر دقيقة ثم حاول مجددًا.', 'Too many requests in a short time. Wait a minute and try again.') + kept;
    case 'server': return L('الخدمة مشغولة مؤقتًا. حاول بعد قليل.', 'The service is temporarily busy. Try again shortly.') + kept;
    case 'security': return L('لم يكتمل التحقق الأمني. أكمل مربع التحقق ثم اضغط «لفّ الدولاب» مجددًا.', 'The security check did not complete. Finish the check box, then press "Spin" again.') + kept;
    default: return L(`تعذّر إتمام اللفّة الآن (${f.code || f.status || 'خطأ'}).`, `The spin could not be completed now (${f.code || f.status || 'error'}).`) + kept;
  }
}
export type WheelResult<T> = { kind: 'ok'; value: T } | { kind: 'sign_in_required' } | { kind: 'not_verified' } | { kind: 'closed'; code: string } | WheelUnavailable;

const TYPES: PrizeType[] = ['gift', 'discount', 'free_delivery', 'none'];
const n0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const nOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const typeOf = (v: unknown): PrizeType => (TYPES.includes(v as PrizeType) ? (v as PrizeType) : 'gift');
const appliesOf = (v: unknown) => (v === 'next_order' ? 'next_order' as const : 'this_order' as const);

async function call<T>(path: string, method: 'GET' | 'POST', idToken: string | null, workerUrl: string, deps: SubmitDeps, pick: (b: any) => T | null, { anonymous = false, payload = {} as Record<string, unknown> } = {}): Promise<WheelResult<T>> {
  const base = normalizeWorkerUrl(workerUrl);
  if (!WHEEL_ENABLED || !base) return { kind: 'unavailable', reason: 'refused', code: 'WHEEL_NOT_CONFIGURED' };
  if (!idToken && !anonymous) return { kind: 'sign_in_required' };
  try {
    const { r, body } = await timed(async (signal) => {
      const res = await deps.fetch(`${base}${path}`, {
        method,
        headers: { ...(idToken ? { authorization: `Bearer ${idToken}` } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
        ...(signal ? { signal } : {}),
      } as any);
      let b: any = null;
      try { b = JSON.parse(await res.text()); } catch { b = null; }
      return { r: res, body: b };
    });
    if (r.status === 401) return { kind: 'sign_in_required' };
    if (r.status === 403 && body?.code === 'WHEEL_ACCOUNT_NOT_VERIFIED') return { kind: 'not_verified' };
    if (r.status === 409 && typeof body?.code === 'string' && body.code.startsWith('CAMPAIGN_')) return { kind: 'closed', code: body.code };
    const v = r.status === 200 && body?.ok ? pick(body) : null;
    return v ? { kind: 'ok', value: v } : failureOf(r.status, body);
  } catch (e) {
    return e instanceof WheelTimeout ? { kind: 'unavailable', reason: 'timeout' } : failureOf(null);
  }
}

export const slotOf = (s: any): WheelSlot | null =>
  s && typeof s.id === 'string' && /^[a-z0-9-]{1,40}$/.test(s.id) && typeof s.label === 'string'
    ? {
        id: s.id, type: typeOf(s.type), label: s.label.slice(0, 40), description: typeof s.description === 'string' ? s.description.slice(0, 200) : '',
        icon: typeof s.icon === 'string' ? s.icon.slice(0, 8) : '', color: typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : null,
        imageUrl: typeof s.imageUrl === 'string' && /^https:\/\//.test(s.imageUrl) ? s.imageUrl : '',
        valueJod: n0(s.valueJod), minOrderJod: n0(s.minOrderJod), appliesTo: appliesOf(s.appliesTo),
        chance: typeof s.chance === 'number' && s.chance >= 0 && s.chance <= 1 ? s.chance : null,
      }
    : null;

export const spinOf = (s: any): WheelSpin | null =>
  s && typeof s.spinId === 'string' && WHEEL_SPIN_ID_RE.test(s.spinId) && typeof s.label === 'string'
    ? {
        spinId: s.spinId, n: Number(s.n) || 0, prizeId: String(s.prizeId || ''), label: s.label, status: String(s.status || ''), orderId: s.orderId ?? null,
        type: s.status === 'none' ? 'none' : typeOf(s.type), valueJod: n0(s.valueJod), minOrderJod: nOrNull(s.minOrderJod), appliesTo: appliesOf(s.appliesTo),
        description: typeof s.description === 'string' ? s.description : '', expiresAt: typeof s.expiresAt === 'string' ? s.expiresAt : null,
        waitingUntil: typeof s.waitingUntil === 'string' ? s.waitingUntil : null, activatedAt: typeof s.activatedAt === 'string' ? s.activatedAt : null,
        firstOrderBy: typeof s.firstOrderBy === 'string' ? s.firstOrderBy : null, firstOrderId: typeof s.firstOrderId === 'string' ? s.firstOrderId : null,
        deliveryBy: typeof s.deliveryBy === 'string' ? s.deliveryBy : null, expiredReason: typeof s.expiredReason === 'string' ? s.expiredReason : null,
      }
    : null;

const slotsOf = (v: unknown) => (Array.isArray(v) ? v.map(slotOf).filter(Boolean) as WheelSlot[] : []);

export const fetchWheelPublic = (workerUrl: string, deps: SubmitDeps) =>
  call<WheelPublic>('/wheel/public', 'GET', null, workerUrl, deps, (b) => ({
    campaign: String(b.campaign || ''), slots: slotsOf(b.slots), minOrderJod: nOrNull(b.minOrderJod), prizeHoldMinutes: nOrNull(b.prizeHoldMinutes) || DEFAULT_HOLD_MINUTES, terms: typeof b.terms === 'string' ? b.terms : '',
  }), { anonymous: true });

export const fetchWheelState = (idToken: string | null, workerUrl: string, deps: SubmitDeps) =>
  call<WheelState>('/wheel/state', 'GET', idToken, workerUrl, deps, (b) => ({
    campaign: String(b.campaign || ''), minOrderJod: typeof b.minOrderJod === 'number' ? b.minOrderJod : null,
    terms: typeof b.terms === 'string' ? b.terms : '', prizeHoldMinutes: nOrNull(b.prizeHoldMinutes) || DEFAULT_HOLD_MINUTES, chancesLeft: Math.max(0, Number(b.chancesLeft) || 0),
    spins: (Array.isArray(b.spins) ? b.spins : []).map(spinOf).filter(Boolean) as WheelSpin[],
    slots: slotsOf(b.slots), previousDelivered: typeof b.previousDelivered === 'boolean' ? b.previousDelivered : null,
    secondOrder: typeof b.secondOrder === 'string' ? b.secondOrder : null, secondOrderHours: nOrNull(b.secondOrderHours) || SECOND_ORDER_HOURS,
  }));

// the signed-in spin carries a FRESH single-use Turnstile token (production: TURNSTILE_MODE=enforce refuses it without)
export const spinWheel = (idToken: string | null, workerUrl: string, deps: SubmitDeps, turnstileToken: string | null = null) =>
  call<{ result: WheelSpin; repeated: boolean; chancesLeft: number }>('/wheel/spin', 'POST', idToken, workerUrl, deps, (b) => {
    const result = spinOf(b.result);
    return result ? { result, repeated: b.repeated === true, chancesLeft: Math.max(0, Number(b.chancesLeft) || 0) } : null;
  }, { payload: turnstileToken ? { turnstileToken } : {} });

// ------------------------------------------------------------------ the spin WITHOUT an account (owner's rule)
// The Worker draws and stores the result under a random TICKET made here (32 bytes from the browser's CSPRNG) and kept
// in localStorage BEFORE asking: a retry after a lost answer sends the same ticket and gets the same stored result.
// At "confirm order", after the Google sign-in, the ticket is CLAIMED: the result becomes the account's welcome result
// (once; an account that already spun keeps its own). Clearing the storage loses the ticket (and its prize) and does
// give a new spin — the Worker's per-IP limit only slows that down. Nothing here decides a prize.
const GUEST_KEY = 'anta_wheel_guest_v1';
export const GUEST_TICKET_RE = /^[A-Za-z0-9_-]{43}$/;
export type GuestResult = Omit<WheelSpin, 'spinId' | 'n' | 'orderId'> & { holdUntil: string | null };

export function guestTicket(): string | null {
  try {
    const t = localStorage.getItem(GUEST_KEY);
    return t && GUEST_TICKET_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}
export function clearGuestTicket(): void {
  try { localStorage.removeItem(GUEST_KEY); } catch { /* ignore */ }
}
function newGuestTicket(): string | null {
  try {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    const t = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    localStorage.setItem(GUEST_KEY, t);
    // storage refused (private mode, full): no ticket -> no guest spin (the result could never be found again)
    return localStorage.getItem(GUEST_KEY) === t ? t : null;
  } catch {
    return null;
  }
}

export const guestOf = (g: any): GuestResult | null =>
  g && typeof g.prizeId === 'string' && typeof g.label === 'string'
    ? {
        prizeId: g.prizeId, label: g.label.slice(0, 40), status: String(g.status || ''),
        type: g.status === 'none' ? 'none' : typeOf(g.type), valueJod: n0(g.valueJod), minOrderJod: nOrNull(g.minOrderJod), appliesTo: appliesOf(g.appliesTo),
        description: typeof g.description === 'string' ? g.description.slice(0, 200) : '', expiresAt: typeof g.expiresAt === 'string' ? g.expiresAt : null,
        holdUntil: typeof g.holdUntil === 'string' ? g.holdUntil : null,
      }
    : null;

/** a guest result shown like an account prize ('held' = won, waiting for the sign-in at checkout); never sent with an order */
export const guestAsSpin = (g: GuestResult): WheelSpin => (isSecondOrder(g) && g.status === 'held'
  // a second-order prize is KEPT (never the 60 minutes): its 5 days start at the first delivery, after signing in
  ? { spinId: '', n: 0, prizeId: g.prizeId, label: g.label, status: 'waiting', orderId: null, type: g.type, valueJod: g.valueJod, minOrderJod: g.minOrderJod, appliesTo: g.appliesTo, description: g.description, expiresAt: null, waitingUntil: g.holdUntil, firstOrderBy: g.holdUntil, firstOrderId: null }
  : {
  spinId: '', n: 0, prizeId: g.prizeId, label: g.label, status: g.status === 'held' ? 'issued' : g.status, orderId: null,
  type: g.type, valueJod: g.valueJod, minOrderJod: g.minOrderJod, appliesTo: g.appliesTo, description: g.description,
  // the hold ends before the validity: past it the prize may be gone, so the shorter date is the one shown
  expiresAt: g.holdUntil && (!g.expiresAt || Date.parse(g.holdUntil) < Date.parse(g.expiresAt)) ? g.holdUntil : g.expiresAt,
});

// null = no answer (network); timedOut = no answer within WHEEL_TIMEOUT_MS (status 0, never a 200)
async function post(path: string, body: unknown, idToken: string | null, workerUrl: string, deps: SubmitDeps): Promise<{ status: number; body: any; timedOut?: true } | null> {
  const base = normalizeWorkerUrl(workerUrl);
  if (!WHEEL_ENABLED || !base) return null;
  try {
    return await timed(async (signal) => {
      const r = await deps.fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      } as any);
      let b: any = null;
      try { b = JSON.parse(await r.text()); } catch { b = null; }
      return { status: r.status, body: b };
    });
  } catch (e) {
    return e instanceof WheelTimeout ? { status: 0, body: null, timedOut: true } : null;
  }
}

export type GuestSpinOutcome =
  | { kind: 'ok'; result: GuestResult; repeated: boolean }
  | { kind: 'closed'; code: string } | { kind: 'limit' } | { kind: 'no_storage' } | WheelUnavailable;

/** spins (or, with a kept ticket, returns the stored result) — no account, no sign-in window */
export async function spinAsGuest(workerUrl: string, deps: SubmitDeps): Promise<GuestSpinOutcome> {
  const ticket = guestTicket() ?? newGuestTicket();
  if (!ticket) return { kind: 'no_storage' };
  const r = await post('/wheel/guest/spin', { ticket }, null, workerUrl, deps);
  if (!r) return failureOf(null);
  if (r.timedOut) return { kind: 'unavailable', reason: 'timeout' };
  const g = r.status === 200 && r.body?.ok ? guestOf(r.body.result) : null;
  if (g) return { kind: 'ok', result: g, repeated: r.body.repeated === true };
  if (r.status === 429 && r.body?.code === 'WHEEL_GUEST_LIMIT') return { kind: 'limit' };
  // closed campaign (CAMPAIGN_*) or no welcome spin in it; a 409 BUSY (contention) is a temporary server state
  if (r.status === 409 && typeof r.body?.code === 'string' && (r.body.code.startsWith('CAMPAIGN_') || r.body.code === 'WHEEL_NO_WELCOME_SPIN')) return { kind: 'closed', code: r.body.code };
  if (r.status === 409 && r.body?.code === 'BUSY') return { kind: 'unavailable', reason: 'server', status: 409, code: 'BUSY' };
  return failureOf(r.status, r.body);
}

/** the stored result of this browser's ticket (null = no ticket / nothing stored for it) */
export async function fetchGuestResult(workerUrl: string, deps: SubmitDeps): Promise<GuestResult | null | 'unavailable'> {
  const ticket = guestTicket();
  if (!ticket) return null;
  const r = await post('/wheel/guest/state', { ticket }, null, workerUrl, deps);
  if (!r) return 'unavailable';
  // unknown ticket: nothing stored YET (a spin with it may still be on its way — a page reload during the spin would
  // otherwise wipe the ticket of a result that is being saved) or any more. The ticket is KEPT: harmless (the next spin
  // with it creates its result; the claim at checkout forgets an unknown ticket).
  if (r.status === 404 || r.status === 400) return null;
  return r.status === 200 && r.body?.ok ? guestOf(r.body.result) : 'unavailable';
}

export type ClaimOutcome =
  | { kind: 'none' } // no ticket in this browser
  | { kind: 'claimed'; spinId: string; result: GuestResult | null }
  | { kind: 'account_has_spin' } | { kind: 'expired' } | { kind: 'claimed_by_other' } | { kind: 'not_second_order' }
  | { kind: 'sign_in_required' } | { kind: 'unavailable' };

/**
 * After the Google sign-in: this browser's guest result becomes the account's welcome result (the Worker decides,
 * once). The ticket is forgotten on every FINAL answer; kept on a network failure (the claim can be retried).
 */
export async function claimGuestResult(idToken: string | null, workerUrl: string, deps: SubmitDeps): Promise<ClaimOutcome> {
  const ticket = guestTicket();
  if (!ticket) return { kind: 'none' };
  if (!idToken) return { kind: 'sign_in_required' };
  const r = await post('/wheel/guest/claim', { ticket }, idToken, workerUrl, deps);
  if (!r) return { kind: 'unavailable' };
  if (r.status === 401) return { kind: 'sign_in_required' };
  const code = r.body?.code;
  let out: ClaimOutcome | null = null;
  if (r.status === 200 && r.body?.ok && typeof r.body.spinId === 'string' && WHEEL_SPIN_ID_RE.test(r.body.spinId)) out = { kind: 'claimed', spinId: r.body.spinId, result: guestOf(r.body.result) };
  else if (code === 'WHEEL_ACCOUNT_HAS_SPIN') out = { kind: 'account_has_spin' };
  else if (code === 'WHEEL_GUEST_EXPIRED') out = { kind: 'expired' };
  else if (code === 'WHEEL_GUEST_CLAIMED') out = { kind: 'claimed_by_other' };
  else if (code === 'WHEEL_NOT_SECOND_ORDER') out = { kind: 'not_second_order' };
  // unknown ticket (another campaign, data reset): nothing to link — forgotten without a message
  else if (code === 'WHEEL_GUEST_NOT_FOUND' || code === 'WHEEL_TICKET_INVALID') out = { kind: 'none' };
  if (!out) return { kind: 'unavailable' };
  clearGuestTicket();
  return out;
}

// ------------------------------------------------------------------ the owner's exception: 4 JOD off the SECOND order
export const SECOND_ORDER_HOURS = 120;
export const isSecondOrder = (p: Pick<WheelSpin, 'type' | 'appliesTo'>) => p.type === 'discount' && p.appliesTo === 'next_order';
/** a second-order prize kept for this account until its first delivery (not usable yet, never "expired" by the clock) */
export const prizeWaiting = (s: Pick<WheelSpin, 'status' | 'type' | 'appliesTo'>) => s.status === 'waiting' && isSecondOrder(s);

// ------------------------------------------------------------------ the 60-minute window (owner's rule)
/** default shown when the Worker did not say (WHEEL_PRIZE_HOLD_MINUTES) */
export const DEFAULT_HOLD_MINUTES = 60;
/** milliseconds left before `expiresAt` (0 when past), or null when there is no end time */
export function remainingMs(expiresAt: string | null | undefined, now = Date.now()): number | null {
  const t = Date.parse(expiresAt || '');
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}
/** "mm:ss" (or "h:mm:ss"), rounded UP so it never shows 00:00 while still valid */
export function fmtRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}
/** a won prize whose window passed while it was still unused (shown as expired, never applied) */
export const prizeExpired = (s: Pick<WheelSpin, 'status' | 'type' | 'expiresAt'>, now = Date.now()) =>
  (s.status === 'issued' || s.status === 'held') && s.type !== 'none' && !!s.expiresAt && Date.parse(s.expiresAt) <= now;

/** a won prize the customer can still use (issued, not expired at `now`) */
export const usablePrize = (s: WheelSpin, now = Date.now()) =>
  s.status === 'issued' && s.type !== 'none' && !(s.expiresAt && Date.parse(s.expiresAt) <= now);

export type PrizeEffect =
  | { state: 'applies'; discountJod: number; shippingWaivedJod: number }
  | { state: 'below_min'; minOrderJod: number; missingJod: number }
  | { state: 'needs_previous_order'; minOrderJod: number }
  | { state: 'unavailable' };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/**
 * What a prize would do to THIS cart — the same rule as the Worker (src/wheel.js + pricing.js), for display and for
 * the numbers the browser sends (the Worker recomputes them and refuses any difference).
 *   minimum: the products' prices before the prize, without delivery
 *   discount: never more than what the products still cost after the volume discount
 *   free delivery: the delivery fee, up to the prize's cap
 */
export function prizeEffect(p: Pick<WheelSpin, 'type' | 'valueJod' | 'minOrderJod' | 'appliesTo' | 'status' | 'expiresAt'>, cart: { subtotal: number; volumeDiscount: number; shippingCost: number; previousDelivered: boolean | null }, now = Date.now()): PrizeEffect {
  if (p.type === 'none' || p.status !== 'issued' || (p.expiresAt && Date.parse(p.expiresAt) <= now)) return { state: 'unavailable' };
  const min = p.minOrderJod ?? 0;
  if (p.appliesTo === 'next_order' && cart.previousDelivered !== true) return { state: 'needs_previous_order', minOrderJod: min };
  if (r3(cart.subtotal) < min) return { state: 'below_min', minOrderJod: min, missingJod: r3(min - cart.subtotal) };
  if (p.type === 'discount') return { state: 'applies', discountJod: Math.min(r3(p.valueJod), Math.max(0, r3(cart.subtotal - cart.volumeDiscount))), shippingWaivedJod: 0 };
  if (p.type === 'free_delivery') return { state: 'applies', discountJod: 0, shippingWaivedJod: Math.min(r3(p.valueJod), Math.max(0, cart.shippingCost)) };
  return { state: 'applies', discountJod: 0, shippingWaivedJod: 0 };
}

/** Arabic / English one-line description of a prize */
export function prizeText(p: Pick<WheelSpin, 'type' | 'label' | 'valueJod' | 'minOrderJod' | 'appliesTo'>, isAR: boolean): string {
  const jd = (v: number) => (isAR ? `${v} د.أ` : `${v} JOD`);
  const min = p.minOrderJod ? (isAR ? ` لطلب منتجاته ${jd(p.minOrderJod)} فأكثر` : ` on products of ${jd(p.minOrderJod)} or more`) : '';
  if (p.type === 'discount') return p.appliesTo === 'next_order'
    ? (isAR ? `خصم ${jd(p.valueJod)} على طلبك الثاني${min} (بعد استلام طلب سابق)` : `${jd(p.valueJod)} off your second order${min} (after a delivered order)`)
    : (isAR ? `خصم ${jd(p.valueJod)} على هذا الطلب${min}` : `${jd(p.valueJod)} off this order${min}`);
  if (p.type === 'free_delivery') return isAR ? `توصيل مجاني حتى ${jd(p.valueJod)}${min}` : `Free delivery up to ${jd(p.valueJod)}${min}`;
  if (p.type === 'gift') return isAR ? `هدية مجانية: ${p.label}${min}` : `Free gift: ${p.label}${min}`;
  return isAR ? 'حظ أوفر' : 'Better luck next time';
}

/** The prize the customer chose to use with the next order (a preference; the Worker re-checks everything). */
export function chosenPrize(): { spinId: string; label: string } | null {
  if (!WHEEL_ENABLED) return null;
  try {
    const v = JSON.parse(sessionStorage.getItem(PRIZE_KEY) || 'null');
    return v && typeof v.spinId === 'string' && WHEEL_SPIN_ID_RE.test(v.spinId) && typeof v.label === 'string' ? { spinId: v.spinId, label: v.label } : null;
  } catch {
    return null;
  }
}
export function choosePrize(p: { spinId: string; label: string } | null): void {
  if (!WHEEL_ENABLED) return;
  try {
    if (p) sessionStorage.setItem(PRIZE_KEY, JSON.stringify({ spinId: p.spinId, label: p.label }));
    else sessionStorage.removeItem(PRIZE_KEY);
  } catch { /* private mode: the prize simply is not attached */ }
}

/** "popup already shown" — UX only (never a limit: the number of spins is decided by the Worker) */
// ------------------------------------------------------------------ the first-visit popup, per CAMPAIGN
// The popup opens by itself once per campaign (not once per browser for ever): the browser keeps the fingerprint of the
// campaign it was shown for. A new / changed campaign (other segments, terms or minimum) opens it again, once.
const POPUP_CAMPAIGN_KEY = 'anta_wheel_popup_campaign_v2';
export function campaignFingerprint(p: Pick<WheelPublic, 'slots' | 'terms' | 'minOrderJod'>): string {
  const src = JSON.stringify([p.slots.map((s) => [s.id, s.label, s.type]), p.terms || '', p.minOrderJod ?? null]);
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
  return `c${h.toString(36)}${src.length.toString(36)}`;
}
export function popupSeenFor(fp: string): boolean {
  try { return localStorage.getItem(POPUP_CAMPAIGN_KEY) === fp; } catch { return true; }
}
export function markPopupSeenFor(fp: string): void {
  try { localStorage.setItem(POPUP_CAMPAIGN_KEY, fp); } catch { /* ignore */ }
}
export function popupSeen(): boolean {
  try { return !!localStorage.getItem(POPUP_KEY); } catch { return true; }
}
export function markPopupSeen(): void {
  try { localStorage.setItem(POPUP_KEY, String(Date.now())); } catch { /* ignore */ }
}

/**
 * Rotation (degrees, clockwise) that brings the CENTRE of segment `index` (of `count`, drawn clockwise from the top)
 * under the pointer at the top, after `turns` full turns from `current`. `jitter` in [-0.35, 0.35] of a segment keeps
 * it inside the segment (the wheel always stops on the segment the Worker drew).
 */
export function targetRotation(current: number, index: number, count: number, turns = 5, jitter = 0): number {
  const seg = 360 / count;
  const want = (360 - ((index + 0.5 + Math.max(-0.35, Math.min(0.35, jitter))) * seg)) % 360;
  const now = ((current % 360) + 360) % 360;
  let delta = (want - now + 360) % 360;
  if (delta < 1e-9) delta = 360;
  return current + turns * 360 + delta;
}

/** which segment is under the top pointer for a rotation (inverse of targetRotation; used by the tests) */
export function segmentAt(rotation: number, count: number): number {
  const seg = 360 / count;
  const r = ((rotation % 360) + 360) % 360;
  return Math.floor((((360 - r) % 360) / seg)) % count;
}
