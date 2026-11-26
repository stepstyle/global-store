// The checkout draft: what the customer typed, kept while they look at another page (a suggested product, the cart…)
// or reload, and restored when checkout opens again.
//   - sessionStorage (this tab only, gone when it closes) + an in-memory copy (used when storage is blocked: private
//     mode, some in-app browsers — it survives moving between pages of the app, not a reload)
//   - expires after DRAFT_TTL_MS; cleared when an order is placed
//   - ONLY delivery details and choices: no agreement / consent, no security check (Turnstile), no sign-in token, no
//     CliQ transfer reference. Prices, delivery cost and prizes are never stored: always computed from the current cart.
//   - the order id / attempt key used for retries live elsewhere (checkoutFlow) and are not touched
export const DRAFT_KEY = 'anta_checkout_draft_v1';
export const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

export type CheckoutDraft = {
  fullName: string;
  phoneLocal: string;
  dialCode: string;
  email: string;
  citySlug: string;
  ammanAreaId: string;
  streetAddress: string;
  postalCode: string;
  shippingMethodId: 'standard' | 'fast';
  paymentMethod: 'cod' | 'cliq';
  step: 1 | 2 | 3;
  /** who typed it: 'guest' or the account's uid — restored ONLY for the same identity (a shared device / tab: another
   *  person signing in never sees it) */
  owner: string;
};
type Stored = CheckoutDraft & { v: 1; savedAt: number };
type Kv = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

let memory: Stored | null = null;
const session = (): Kv | null => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; } };
const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** keeps only the known fields, with their types and sizes (a draft is never trusted as is) */
export function cleanDraft(v: unknown): CheckoutDraft | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const d: CheckoutDraft = {
    fullName: s(o.fullName, 120),
    phoneLocal: s(o.phoneLocal, 20).replace(/[^\d]/g, ''),
    dialCode: /^\+\d{1,4}$/.test(String(o.dialCode)) ? String(o.dialCode) : '+962',
    email: s(o.email, 254),
    citySlug: s(o.citySlug, 20),
    ammanAreaId: s(o.ammanAreaId, 10),
    streetAddress: s(o.streetAddress, 300),
    postalCode: s(o.postalCode, 12),
    shippingMethodId: o.shippingMethodId === 'fast' ? 'fast' : 'standard',
    paymentMethod: o.paymentMethod === 'cliq' ? 'cliq' : 'cod',
    step: o.step === 3 ? 3 : o.step === 2 ? 2 : 1,
    owner: typeof o.owner === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(o.owner) ? o.owner : 'guest',
  };
  return d;
}

/** anything worth keeping? (an untouched form is not saved) */
export const draftHasContent = (d: CheckoutDraft) => !!(d.fullName.trim() || d.phoneLocal || d.streetAddress.trim() || d.citySlug || d.email.trim());

export function saveCheckoutDraft(d: CheckoutDraft, store: Kv | null = session(), now = Date.now()): void {
  const c = cleanDraft(d);
  if (!c) return;
  if (!draftHasContent(c)) { clearCheckoutDraft(store); return; }
  const rec: Stored = { ...c, v: 1, savedAt: now };
  memory = rec;
  try { store?.setItem(DRAFT_KEY, JSON.stringify(rec)); } catch { /* full / blocked: the memory copy is kept */ }
}

export function readCheckoutDraft(store: Kv | null = session(), now = Date.now()): CheckoutDraft | null {
  let rec: unknown = null;
  try { const raw = store?.getItem(DRAFT_KEY); if (raw) rec = JSON.parse(raw); } catch { rec = null; }
  if (!rec) rec = memory;
  if (!rec || typeof rec !== 'object') return null;
  const savedAt = Number((rec as Stored).savedAt);
  if (!Number.isFinite(savedAt) || now - savedAt > DRAFT_TTL_MS || savedAt - now > 60_000) { clearCheckoutDraft(store); return null; }
  const d = cleanDraft(rec);
  return d && draftHasContent(d) ? d : null;
}

export function clearCheckoutDraft(store: Kv | null = session()): void {
  memory = null;
  try { store?.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

/** for tests only */
export function __resetDraftMemory() { memory = null; }
