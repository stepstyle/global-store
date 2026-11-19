// Prize wheel — TEST ONLY. Visible only in a build with VITE_WHEEL_MODE=test (never set for production: the
// production Worker also refuses WHEEL_MODE != off). The draw happens on the Worker; the browser only asks and shows.
//
// The chosen prize (a spin id) is kept for this browser tab only (sessionStorage) and sent next to a SIGNED-IN order;
// the Worker re-checks it against the verified account, its status and the campaign.
import { normalizeWorkerUrl, type SubmitDeps } from './orderSubmit.ts';

declare const __DEPLOY_ENV__: string | undefined;
// never in a production build, whatever the variable says (the production Worker refuses the wheel as well)
const PRODUCTION_BUILD = typeof __DEPLOY_ENV__ !== 'undefined' && __DEPLOY_ENV__ === 'production';
export const WHEEL_ENABLED = !PRODUCTION_BUILD && (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_WHEEL_MODE === 'test';
export const WHEEL_SPIN_ID_RE = /^[a-z0-9-]{1,40}_[A-Za-z0-9_-]{1,128}_\d{1,4}$/;
const PRIZE_KEY = 'anta_wheel_prize_v1';

export type WheelSpin = { spinId: string; n: number; prizeId: string; label: string; status: string; orderId: string | null };
export type WheelState = { campaign: string; minOrderJod: number | null; terms: string; chancesLeft: number; spins: WheelSpin[] };
export type WheelResult<T> = { kind: 'ok'; value: T } | { kind: 'sign_in_required' } | { kind: 'not_verified' } | { kind: 'closed'; code: string } | { kind: 'unavailable' };

async function call<T>(path: string, method: 'GET' | 'POST', idToken: string | null, workerUrl: string, deps: SubmitDeps, pick: (b: any) => T | null): Promise<WheelResult<T>> {
  const base = normalizeWorkerUrl(workerUrl);
  if (!WHEEL_ENABLED || !base) return { kind: 'unavailable' };
  if (!idToken) return { kind: 'sign_in_required' };
  try {
    const r = await deps.fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${idToken}`, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    let body: any = null;
    try { body = JSON.parse(await r.text()); } catch { body = null; }
    if (r.status === 401) return { kind: 'sign_in_required' };
    if (r.status === 403 && body?.code === 'WHEEL_ACCOUNT_NOT_VERIFIED') return { kind: 'not_verified' };
    if (r.status === 409 && typeof body?.code === 'string' && body.code.startsWith('CAMPAIGN_')) return { kind: 'closed', code: body.code };
    const v = r.status === 200 && body?.ok ? pick(body) : null;
    return v ? { kind: 'ok', value: v } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

const spinOf = (s: any): WheelSpin | null =>
  s && typeof s.spinId === 'string' && WHEEL_SPIN_ID_RE.test(s.spinId) && typeof s.label === 'string'
    ? { spinId: s.spinId, n: Number(s.n) || 0, prizeId: String(s.prizeId || ''), label: s.label, status: String(s.status || ''), orderId: s.orderId ?? null }
    : null;

export const fetchWheelState = (idToken: string | null, workerUrl: string, deps: SubmitDeps) =>
  call<WheelState>('/wheel/state', 'GET', idToken, workerUrl, deps, (b) => ({
    campaign: String(b.campaign || ''), minOrderJod: typeof b.minOrderJod === 'number' ? b.minOrderJod : null,
    terms: typeof b.terms === 'string' ? b.terms : '', chancesLeft: Math.max(0, Number(b.chancesLeft) || 0),
    spins: (Array.isArray(b.spins) ? b.spins : []).map(spinOf).filter(Boolean) as WheelSpin[],
  }));

export const spinWheel = (idToken: string | null, workerUrl: string, deps: SubmitDeps) =>
  call<{ result: WheelSpin; repeated: boolean; chancesLeft: number }>('/wheel/spin', 'POST', idToken, workerUrl, deps, (b) => {
    const result = spinOf(b.result);
    return result ? { result, repeated: b.repeated === true, chancesLeft: Math.max(0, Number(b.chancesLeft) || 0) } : null;
  });

/** The prize the customer chose to receive with the next order (this tab only). */
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
