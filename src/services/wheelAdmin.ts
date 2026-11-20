// Dashboard <-> Worker for the prize wheel settings (TEST builds only). The Worker checks the admin on EVERY call
// (requireAdmin); the browser cannot write any wheel collection (Firestore rules deny them).
import { normalizeWorkerUrl, type SubmitDeps } from './orderSubmit.ts';

export type AdminSlot = {
  id: string; type: 'gift' | 'discount' | 'free_delivery' | 'none'; label: string; description?: string; icon?: string; color?: string | null; imageUrl?: string;
  weight: number; active?: boolean; startsAt?: string | null; endsAt?: string | null;
  quantity?: number; unitCostJod?: number; valueJod?: number; minOrderJod?: number; appliesTo?: 'this_order' | 'next_order';
  productId?: string | null; variantId?: string | null; validDays?: number | null;
};
export type AdminCampaign = {
  active: boolean; minOrderJod: number; budgetJod: number; noPrizeWeight?: number; startsAt: string; endsAt: string; giftOnCancel: 'return' | 'expire';
  freeFirstChance?: boolean; openGiftsPerPhone?: number; prizeValidDays?: number; terms?: string; prizes: AdminSlot[];
};
export type AdminWheel = { mode: string; campaignId: string; exists: boolean; updateTime: string | null; campaign: AdminCampaign | null; errors: string[]; warnings: string[]; pool: Record<string, number | null> };
export type AdminSpinRow = { spinId: string; uid: string; email: string; n: number; prizeId: string; label: string; type: string; valueJod: number | null; minOrderJod: number | null; appliesTo: string; status: string; orderId: string | null; createdAt: string | null; expiresAt: string | null };
export type AdminFailure = { ok: false; status: number; code: string; errors?: string[]; warnings?: string[] };
export type AdminResult<T> = { ok: true; value: T } | AdminFailure;

async function call<T>(workerUrl: string, path: string, method: 'GET' | 'POST', idToken: string | null, deps: SubmitDeps, body?: unknown): Promise<AdminResult<T>> {
  const base = normalizeWorkerUrl(workerUrl);
  if (!base) return { ok: false, status: 0, code: 'NO_WORKER' };
  if (!idToken) return { ok: false, status: 401, code: 'AUTH_REQUIRED' };
  try {
    const r = await deps.fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${idToken}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let b: any = null;
    try { b = JSON.parse(await r.text()); } catch { b = null; }
    if (r.status === 200 && b?.ok) return { ok: true, value: b as T };
    return { ok: false, status: r.status, code: typeof b?.code === 'string' ? b.code : `HTTP_${r.status}`, ...(Array.isArray(b?.errors) ? { errors: b.errors } : {}), ...(Array.isArray(b?.warnings) ? { warnings: b.warnings } : {}) };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK' };
  }
}

export const getWheelAdmin = (u: string, t: string | null, d: SubmitDeps) => call<AdminWheel>(u, '/admin/wheel', 'GET', t, d);
export const saveWheelCampaign = (u: string, t: string | null, d: SubmitDeps, campaign: AdminCampaign, baseUpdateTime: string | null) =>
  call<AdminWheel>(u, '/admin/wheel/campaign', 'POST', t, d, { campaign, baseUpdateTime });
export const getWheelSpins = (u: string, t: string | null, d: SubmitDeps, status = '') =>
  call<{ spins: AdminSpinRow[]; counts: Record<string, number> }>(u, `/admin/wheel/spins?limit=200${status ? `&status=${encodeURIComponent(status)}` : ''}`, 'GET', t, d);

/** share of each slot among the drawable weights (display only; the Worker draws) */
export function slotShares(c: Pick<AdminCampaign, 'prizes' | 'noPrizeWeight'>): Record<string, number> {
  const act = c.prizes.filter((p) => p.active !== false && p.weight > 0);
  const total = act.reduce((s, p) => s + p.weight, 0) + (c.noPrizeWeight || 0);
  return Object.fromEntries(c.prizes.map((p) => [p.id, total > 0 && p.active !== false ? p.weight / total : 0]));
}

/** a fresh, unused slot id (a-z 0-9 -) */
export function newSlotId(existing: string[], type: AdminSlot['type']): string {
  const base = type === 'none' ? 'none' : type === 'free_delivery' ? 'ship' : type === 'discount' ? 'disc' : 'gift';
  for (let i = 1; i < 1000; i++) if (!existing.includes(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}
