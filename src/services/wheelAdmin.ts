// Dashboard <-> Worker for the prize wheel settings (TEST builds only). The Worker checks the admin on EVERY call
// (requireAdmin); the browser cannot write any wheel collection (Firestore rules deny them).
import { normalizeWorkerUrl, type SubmitDeps } from './orderSubmit.ts';

/** loyalty tiers (server-side count of DELIVERED orders): new 0-1 · returning 2 · loyal 3+; a spin without an account = new */
export type Tier = 'new' | 'returning' | 'loyal';
export const TIERS: Tier[] = ['new', 'returning', 'loyal'];
export const TIER_AR: Record<Tier, string> = { new: 'جديد (0–1 طلب مُسلَّم)', returning: 'راجع (طلبان)', loyal: 'دائم (3 فأكثر)' };
export const TIER_SHORT_AR: Record<Tier, string> = { new: 'جديد', returning: 'راجع', loyal: 'دائم' };
/** the weight of a slot for a tier (a missing tier weight = the slot's 'weight', like the Worker) */
export const tierW = (p: Pick<AdminSlot, 'weight' | 'weights'>, t: Tier) => (p.weights && Number.isInteger(p.weights[t]) ? (p.weights[t] as number) : p.weight);

export type AdminSlot = {
  id: string; type: 'gift' | 'discount' | 'free_delivery' | 'none'; label: string; description?: string; icon?: string; color?: string | null; imageUrl?: string;
  weight: number; weights?: Partial<Record<Tier, number>>; costConfirmed?: boolean; active?: boolean; startsAt?: string | null; endsAt?: string | null;
  quantity?: number; unitCostJod?: number; valueJod?: number; minOrderJod?: number; appliesTo?: 'this_order' | 'next_order';
  productId?: string | null; variantId?: string | null; validDays?: number | null;
};
export type AdminCampaign = {
  active: boolean; minOrderJod: number; budgetJod: number; budgetPer100Jod?: number | null; budgetStartJod?: number; noPrizeWeight?: number; startsAt: string; endsAt: string; giftOnCancel: 'return' | 'expire';
  freeFirstChance?: boolean; openGiftsPerPhone?: number; prizeValidDays?: number; terms?: string; prizes: AdminSlot[];
};
export type AdminWheel = { mode: string; campaignId: string; prizeHoldMinutes: number; exists: boolean; updateTime: string | null; campaign: AdminCampaign | null; errors: string[]; warnings: string[]; pool: Record<string, number | null>;
  budget?: { deliveredOrders: number; allowanceJod: number; capJod: number; heldJod: number; spentJod: number; availableJod: number; usedPct: number; per100Jod: number | null; startJod: number } };
export type AdminSpinRow = { spinId: string; uid: string; email: string; n: number; prizeId: string; label: string; tier?: string | null; deliveredCount?: number | null; type: string; valueJod: number | null; minOrderJod: number | null; appliesTo: string; status: string; orderId: string | null; createdAt: string | null; expiresAt: string | null };
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

/** share of each slot among the drawable weights FOR A TIER (display only; the Worker draws) */
export function slotShares(c: Pick<AdminCampaign, 'prizes' | 'noPrizeWeight'>, tier: Tier = 'new'): Record<string, number> {
  const act = c.prizes.filter((p) => p.active !== false && tierW(p, tier) > 0);
  const total = act.reduce((s, p) => s + tierW(p, tier), 0) + (c.noPrizeWeight || 0);
  return Object.fromEntries(c.prizes.map((p) => [p.id, total > 0 && p.active !== false ? tierW(p, tier) / total : 0]));
}

/**
 * A STARTING POINT for review — never applied by itself, never final (the owner decides after costs and budget):
 * cheap prizes common, costly ones rare, a measured edge for loyal customers, three "حظ أوفر" with most of the weight.
 * By the store's cost of one unit: <= 1 JOD [60, 65, 70] · <= 2 [25, 28, 32] · <= 3 [10, 12, 15] · <= 5 [3, 4, 6] ·
 * more [1, 1, 2]; each "حظ أوفر" [120, 115, 110] (new, returning, loyal).
 */
// ------------------------------------------------------------------ budget (owner: 12 JOD per 100 delivered orders)
export type BudgetAssumptions = { mix: Record<Tier, number>; spinsPerOrder: number };
/** planning assumptions (editable in the dashboard, never stored): customer mix and spins per delivered order */
export const DEFAULT_ASSUMPTIONS: BudgetAssumptions = { mix: { new: 0.6, returning: 0.25, loyal: 0.15 }, spinsPerOrder: 1.3 };
const drawableNow = (p: AdminSlot) => p.active !== false && (p.type === 'none' || (p.quantity ?? 0) > 0);
const costOf = (p: AdminSlot) => (p.type === 'none' ? 0 : Math.max(0, Number(p.unitCostJod ?? 0)));
/**
 * Expected prize cost per spin for each tier (what the Worker would draw with these weights, prizes with stock only),
 * then per 100 delivered orders = 100 x spinsPerOrder x the mix-weighted cost per spin. A PROJECTION, not a guarantee.
 */
export function projectBudget(c: Pick<AdminCampaign, 'prizes' | 'noPrizeWeight'>, a: BudgetAssumptions = DEFAULT_ASSUMPTIONS) {
  const perSpin = {} as Record<Tier, number>;
  for (const t of TIERS) {
    const ps = c.prizes.filter((p) => drawableNow(p) && tierW(p, t) > 0);
    const total = ps.reduce((s, p) => s + tierW(p, t), 0) + (c.noPrizeWeight || 0);
    perSpin[t] = total > 0 ? ps.reduce((s, p) => s + tierW(p, t) * costOf(p), 0) / total : 0;
  }
  const mixTotal = TIERS.reduce((s, t) => s + Math.max(0, a.mix[t]), 0) || 1;
  const perSpinMix = TIERS.reduce((s, t) => s + (Math.max(0, a.mix[t]) / mixTotal) * perSpin[t], 0);
  return { perSpin, perSpinMix, per100: 100 * a.spinsPerOrder * perSpinMix };
}
/**
 * CONSERVATIVE weights for a per-100 target (a starting point, never applied or saved by itself):
 *   - only prizes whose real cost is CONFIRMED get a weight (an unconfirmed cost -> 0, cannot be planned)
 *   - cheaper = more common (by cost class), costly = rare; loyal customers a measured edge (x1.15 returning, x1.4 loyal)
 *   - each "حظ أوفر" 10000; prize weights scaled per tier so the projection lands at `margin` (85%) of the target
 *     (target per spin split new 0.85 : returning 1.0 : loyal 1.3, normalised to the mix)
 */
export function suggestForBudget(c: AdminCampaign, a: BudgetAssumptions = DEFAULT_ASSUMPTIONS, margin = 0.85): AdminSlot[] {
  const per100 = c.budgetPer100Jod ?? 12;
  const B = (per100 * margin) / (100 * a.spinsPerOrder);
  const f: Record<Tier, number> = { new: 0.85, returning: 1, loyal: 1.3 };
  const mixTotal = TIERS.reduce((s, t) => s + Math.max(0, a.mix[t]), 0) || 1;
  const norm = TIERS.reduce((s, t) => s + (Math.max(0, a.mix[t]) / mixTotal) * f[t], 0) || 1;
  const edge: Record<Tier, number> = { new: 1, returning: 1.15, loyal: 1.4 };
  const base = (p: AdminSlot) => { const k = costOf(p); return k <= 1 ? 60 : k <= 2 ? 25 : k <= 3 ? 10 : k <= 5 ? 3 : 1; };
  const NONE_W = 10_000;
  const nones = c.prizes.filter((p) => p.type === 'none' && p.active !== false).length;
  const plannable = (p: AdminSlot) => p.type !== 'none' && p.costConfirmed === true && costOf(p) > 0;
  const scale = {} as Record<Tier, number>;
  for (const t of TIERS) {
    const target = (B * f[t]) / norm;
    const ps = c.prizes.filter(plannable);
    const R = ps.reduce((s, p) => s + base(p) * edge[t], 0);
    const C = ps.reduce((s, p) => s + base(p) * edge[t] * costOf(p), 0);
    // cost per spin = s*C / (N + s*R) = target  ->  s = target*N / (C - target*R)
    scale[t] = C - target * R > 0 ? (target * NONE_W * nones) / (C - target * R) : 0;
  }
  return c.prizes.map((p) => {
    if (p.type === 'none') return { ...p, weights: { new: NONE_W, returning: NONE_W, loyal: NONE_W }, weight: NONE_W };
    if (!plannable(p)) return { ...p, weights: { new: 0, returning: 0, loyal: 0 }, weight: 0 };
    const w = Object.fromEntries(TIERS.map((t) => [t, Math.floor(scale[t] * base(p) * edge[t])])) as Record<Tier, number>;
    return { ...p, weights: w, weight: w.new };
  });
}

export function suggestedWeights(p: AdminSlot): Record<Tier, number> {
  const row = (a: number, b: number, c: number) => ({ new: a, returning: b, loyal: c });
  if (p.type === 'none') return row(120, 115, 110);
  const cost = Number(p.unitCostJod ?? p.valueJod ?? 0);
  if (cost <= 1) return row(60, 65, 70);
  if (cost <= 2) return row(25, 28, 32);
  if (cost <= 3) return row(10, 12, 15);
  if (cost <= 5) return row(3, 4, 6);
  return row(1, 1, 2);
}

/** a fresh, unused slot id (a-z 0-9 -) */
/** the prizes agreed with the owner — ALL inactive with weight 0 and quantity 0: the owner sets chances and stock */
export function agreedTemplate(): AdminCampaign {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 86_400_000);
  const s = (o: Partial<AdminSlot> & Pick<AdminSlot, 'id' | 'type' | 'label'>): AdminSlot => ({ weight: 0, quantity: 0, active: false, minOrderJod: 5, appliesTo: 'this_order', ...o });
  return {
    active: false, minOrderJod: 5, budgetJod: 0, budgetPer100Jod: 12, budgetStartJod: 0, startsAt: now.toISOString(), endsAt: end.toISOString(), giftOnCancel: 'return',
    freeFirstChance: true, openGiftsPerPhone: 1, prizeValidDays: 7, terms: '',
    prizes: [
      s({ id: 'ship-1', type: 'free_delivery', label: 'توصيل مجاني', icon: '🚚', valueJod: 3, unitCostJod: 3 }),
      s({ id: 'disc-1', type: 'discount', label: 'خصم دينار', icon: '💸', valueJod: 1, unitCostJod: 1 }),
      { id: 'none-1', type: 'none', label: 'حظ أوفر', weight: 0, active: true },
      s({ id: 'gift-2', type: 'gift', label: 'هدية بقيمة 2 د.أ', icon: '🎁', valueJod: 2, unitCostJod: 2 }),
      s({ id: 'gift-3', type: 'gift', label: 'هدية بقيمة 3 د.أ', icon: '🎁', valueJod: 3, unitCostJod: 3 }),
      s({ id: 'watch-1', type: 'gift', label: 'هدية ساعة', icon: '⌚', valueJod: 0, unitCostJod: 0, minOrderJod: 15 }),
      { id: 'none-2', type: 'none', label: 'حظ أوفر', weight: 0, active: true },
      s({ id: 'gift-4', type: 'gift', label: 'هدية بقيمة 4 د.أ', icon: '🎁', valueJod: 4, unitCostJod: 4 }),
      s({ id: 'toy-1', type: 'gift', label: 'هدية لعبة', icon: '🧸', valueJod: 0, unitCostJod: 0 }),
      s({ id: 'second-4', type: 'discount', label: 'خصم 4 د.أ على الطلب الثاني', icon: '🔁', valueJod: 4, unitCostJod: 4, minOrderJod: 15, appliesTo: 'next_order' }),
      { id: 'none-3', type: 'none', label: 'حظ أوفر', weight: 0, active: true },
      s({ id: 'gift-5', type: 'gift', label: 'هدية بقيمة 5 د.أ', icon: '🎁', valueJod: 5, unitCostJod: 5 }),
      s({ id: 'acc-1', type: 'gift', label: 'نثريات وإكسسوارات', icon: '✏️', valueJod: 0, unitCostJod: 0 }),
      s({ id: 'disc-4', type: 'discount', label: 'خصم 4 د.أ', icon: '💰', valueJod: 4, unitCostJod: 4, minOrderJod: 15 }),
      s({ id: 'disc-5', type: 'discount', label: 'خصم 5 د.أ', icon: '💰', valueJod: 5, unitCostJod: 5, minOrderJod: 15 }),
    ],
  };
}

// ------------------------------------------------------------------ OPENING CAMPAIGN (owner's decision 2026-11-21)
/**
 * 50 JOD for the first 30 days from activation, available from the start (no 12-per-100 growth, no renewal):
 * budgetJod = budgetStartJod = 50, budgetPer100Jod = 0. The quantities below add up to EXACTLY 50 JOD at their cost,
 * so the Worker's own rule (sum of quantity x cost <= budget) makes an overspend impossible, on top of the held / spent
 * check of every spin. Conservative chances (per 1000 spins, new / returning / loyal): mostly the 1 JOD discount, big
 * prizes rare, a better chance for loyal customers (3+ delivered orders) on every prize, three "حظ أوفر".
 * Prizes with an unknown cost (watch, toy, accessories) stay in the list, INACTIVE with weight 0 and quantity 0.
 * Gifts "worth X JOD" are budgeted at their full value X (what the store spends on them can only be lower).
 * A draft to review in the dashboard: nothing is saved until the owner presses save.
 */
export const LAUNCH_BUDGET_JOD = 50;
export const LAUNCH_DAYS = 30;
export const LAUNCH_PLAN: Record<string, { quantity: number; weights: [number, number, number]; active: boolean }> = {
  'disc-1': { quantity: 10, weights: [100, 110, 130], active: true },
  'ship-1': { quantity: 3, weights: [30, 40, 55], active: true },
  'gift-2': { quantity: 3, weights: [30, 40, 55], active: true },
  'gift-3': { quantity: 1, weights: [10, 15, 25], active: true },
  'second-4': { quantity: 1, weights: [15, 20, 25], active: true },
  'disc-4': { quantity: 1, weights: [5, 8, 15], active: true },
  'gift-4': { quantity: 1, weights: [3, 5, 10], active: true },
  'gift-5': { quantity: 1, weights: [2, 3, 8], active: true },
  'disc-5': { quantity: 1, weights: [2, 3, 7], active: true },
  'none-1': { quantity: 0, weights: [268, 252, 224], active: true },
  'none-2': { quantity: 0, weights: [268, 252, 223], active: true },
  'none-3': { quantity: 0, weights: [267, 252, 223], active: true },
};
/** the agreed prizes with the opening plan applied (unknown-cost prizes: kept, inactive, weight 0, quantity 0) */
export function launchCampaign(now: Date = new Date()): AdminCampaign {
  const t = agreedTemplate();
  const prizes = t.prizes.map((p): AdminSlot => {
    const plan = LAUNCH_PLAN[p.id];
    if (!plan) return { ...p, active: false, weight: 0, weights: { new: 0, returning: 0, loyal: 0 }, quantity: 0, costConfirmed: false };
    const [n, r, l] = plan.weights;
    const out: AdminSlot = { ...p, active: plan.active, weight: n, weights: { new: n, returning: r, loyal: l } };
    return p.type === 'none' ? out : { ...out, quantity: plan.quantity, costConfirmed: true };
  });
  return {
    ...t, active: true, budgetJod: LAUNCH_BUDGET_JOD, budgetStartJod: LAUNCH_BUDGET_JOD, budgetPer100Jod: 0,
    startsAt: now.toISOString(), endsAt: new Date(now.getTime() + LAUNCH_DAYS * 86_400_000).toISOString(), prizes,
  };
}

export function newSlotId(existing: string[], type: AdminSlot['type']): string {
  const base = type === 'none' ? 'none' : type === 'free_delivery' ? 'ship' : type === 'discount' ? 'disc' : 'gift';
  for (let i = 1; i < 1000; i++) if (!existing.includes(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}
