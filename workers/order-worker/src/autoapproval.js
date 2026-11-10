// Smart auto-approval — PHASE 1: the decision rules only. PURE: no network, no Firestore, no clock (now is passed in).
// NOT wired into order creation yet (see AUTO_APPROVAL.md for the integration, recovery path and tests of phase 2+).
//
// assessOrder() answers ONE question: may this new order be accepted WITHOUT a human? It never rejects an order:
// the only outcomes are
//   'auto_accept'   — every check passed; the caller then runs the normal atomic decideOrder('accept') (src/approval.js),
//                     which re-reads the products and deducts inside ONE preconditioned commit. The stock check here is
//                     only a pre-check: the FINAL stock check is the one inside that commit (it can still refuse).
//   'manual_review' — at least one reason below; the order stays 'new' (no stock change) and goes to Telegram as usual.
//   'disabled'      — a lock is closed (server ceiling, admin switch, approval mode) or the settings are unusable.
// Auto-acceptance is NOT proof of the phone owner's identity and never moves an order beyond 'processing'.
// Free means only: server-side checks + Cloudflare Turnstile. No paid AI, OTP, SMS or WhatsApp service.

export const ASSESSMENT_VERSION = 1;

/** decided with the store owner (2026-11): 5 per line, 15 pieces, 50 JOD, CliQ never automatic, 24 h same phone */
export const DEFAULT_AUTO_SETTINGS = Object.freeze({
  enabled: false, // the dashboard switch — OFF by default
  maxLineQty: 5,
  maxTotalQty: 15,
  maxOrderTotal: 50,
  duplicateWindowHours: 24,
  allowCliq: false,
  blockedPhoneHashes: Object.freeze([]),
});

/** bounds a setting may take; anything outside (or not a number) makes the whole configuration unusable -> 'disabled' */
const BOUNDS = {
  maxLineQty: [1, 99],
  maxTotalQty: [1, 500],
  maxOrderTotal: [1, 10_000],
  duplicateWindowHours: [1, 24 * 30],
};

const PHONE_RE = /^\+9627[789]\d{7}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
/** what the current storefront writes when the customer typed no street (src/pages/Checkout.tsx) */
const STREET_PLACEHOLDERS = ['لم يتم إدخال عنوان تفصيلي'];

const STOCK_REVIEW = new Set(['STOCK_SHORTFALL', 'PRODUCT_NOT_FOUND', 'VARIANT_NOT_FOUND', 'DUPLICATE_VARIANT_ID', 'AMBIGUOUS_VARIANT', 'STOCK_UNTRACKED', 'STOCK_NOT_DEDUCTED']);
const DELIVERY_REVIEW = new Set(['SHIPPING_UNKNOWN', 'FAST_OUTSIDE_AMMAN']);
const PRICE_REVIEW = new Set(['PRICE_MISMATCH', 'PRICE_UNKNOWN']);

/** Arabic text for the Telegram message (fixed strings, no customer data) */
export const REASON_AR = Object.freeze({
  AUTO_DISABLED: 'القبول التلقائي متوقف',
  SETTINGS_INVALID: 'إعدادات القبول التلقائي غير صالحة',
  NAME_MISSING: 'اسم العميل ناقص',
  PHONE_INVALID: 'رقم الهاتف غير صالح',
  STREET_MISSING: 'عنوان التوصيل ناقص',
  AREA_MISSING: 'منطقة عمّان غير محددة',
  CITY_MISSING: 'المحافظة غير محددة',
  DELIVERY_UNKNOWN: 'منطقة التوصيل غير معروفة',
  PRICE_PROBLEM: 'اختلاف أو نقص في الأسعار',
  STOCK_PROBLEM: 'مشكلة في المخزون',
  BOT_CHECK_MISSING: 'فحص الحماية من الروبوتات لم يُثبت',
  DUPLICATE_PHONE: 'طلب آخر من نفس الهاتف خلال المدة المحددة',
  DUPLICATE_CHECK_UNAVAILABLE: 'تعذّر فحص الطلبات المكررة',
  LINE_QTY_HIGH: 'كمية كبيرة لمنتج واحد',
  TOTAL_QTY_HIGH: 'عدد قطع كبير',
  ORDER_TOTAL_HIGH: 'قيمة الطلب كبيرة',
  TOTAL_UNKNOWN: 'قيمة الطلب غير معروفة',
  CLIQ_NEEDS_VERIFICATION: 'دفع CliQ يحتاج تحققًا',
  PAYMENT_UNKNOWN: 'طريقة دفع غير معروفة',
  PHONE_BLOCKED: 'رقم في قائمة المراجعة',
  NOT_NEW: 'حالة الطلب ليست جديدة',
});

/**
 * Validates and normalises the stored settings (config/autoApproval). Missing fields take the defaults; a present but
 * malformed field makes the configuration invalid (fail-safe: never "guess" a looser limit).
 * @returns {{ ok: true, settings } | { ok: false, problems: string[] }}
 */
export function normaliseSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const problems = [];
  const out = { ...DEFAULT_AUTO_SETTINGS };
  if (s.enabled !== undefined) {
    if (typeof s.enabled !== 'boolean') problems.push('enabled');
    else out.enabled = s.enabled;
  }
  for (const [k, [lo, hi]] of Object.entries(BOUNDS)) {
    if (s[k] === undefined) continue;
    if (typeof s[k] !== 'number' || !Number.isFinite(s[k]) || s[k] < lo || s[k] > hi) problems.push(k);
    else out[k] = s[k];
  }
  if (s.allowCliq !== undefined) {
    if (typeof s.allowCliq !== 'boolean') problems.push('allowCliq');
    else out.allowCliq = s.allowCliq;
  }
  if (s.blockedPhoneHashes !== undefined) {
    if (!Array.isArray(s.blockedPhoneHashes) || s.blockedPhoneHashes.length > 5000 || !s.blockedPhoneHashes.every((h) => typeof h === 'string' && HASH_RE.test(h))) problems.push('blockedPhoneHashes');
    else out.blockedPhoneHashes = [...s.blockedPhoneHashes];
  }
  return problems.length ? { ok: false, problems } : { ok: true, settings: out };
}

/**
 * HMAC-SHA-256 of the normalised phone (lower-case hex). Lets the ledger / block list compare phones without storing
 * them again. The secret is a Worker secret (phase 2); without it there is no duplicate check -> manual review.
 */
export async function phoneFingerprint(phone, secret) {
  if (typeof phone !== 'string' || !PHONE_RE.test(phone)) throw new TypeError('phone must be a normalised +9627… number');
  if (typeof secret !== 'string' || secret.length < 32) throw new TypeError('secret must be at least 32 characters');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(phone));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const trimmed = (s) => (typeof s === 'string' ? s.trim() : '');

/**
 * @param input {
 *   order:         validated order (src/validate.js value): items[{quantity}], address{fullName, phone, street},
 *                  addressMeta{citySlug, ammanAreaId}, paymentMethod
 *   status:        current order status (must be 'new')
 *   warnings:      [{code}] from planInventory + computeServerPricing (+ PRICE_MISMATCH) — as built in orders.js
 *   serverTotal:   number | null — serverPricing.total
 *   turnstileVerified: boolean — true ONLY when Cloudflare Turnstile verified this request (not "log" mode)
 *   recentSamePhone:   number | null — other orders of the same phone fingerprint, pending or accepted, inside the
 *                      window (excluding this one); null = the lookup failed or was not possible
 *   phoneHash:     string | null — phoneFingerprint() of this order
 *   locks:         { serverMode: 'on' | 'off', approvalMode: 'telegram' | 'off' }
 *   settings:      raw config/autoApproval document (or undefined)
 * }
 * @returns {{ decision: 'auto_accept' | 'manual_review' | 'disabled', reasons: {code: string, [k: string]: any}[], version: number }}
 */
export function assessOrder(input) {
  const result = (decision, reasons) => ({ decision, reasons, version: ASSESSMENT_VERSION });
  const { order, locks } = input || {};

  // ---- locks: every one must be open (server ceiling AND approval mode AND the dashboard switch)
  if (!locks || locks.serverMode !== 'on') return result('disabled', [{ code: 'AUTO_DISABLED', lock: 'server' }]);
  if (locks.approvalMode !== 'telegram') return result('disabled', [{ code: 'AUTO_DISABLED', lock: 'approval_mode' }]);
  const ns = normaliseSettings(input.settings);
  if (!ns.ok) return result('disabled', [{ code: 'SETTINGS_INVALID', fields: ns.problems }]);
  const s = ns.settings;
  if (!s.enabled) return result('disabled', [{ code: 'AUTO_DISABLED', lock: 'dashboard' }]);

  const reasons = [];
  const add = (code, extra = {}) => { if (!reasons.some((r) => r.code === code)) reasons.push({ code, ...extra }); };
  const warn = new Set((Array.isArray(input.warnings) ? input.warnings : []).map((w) => w?.code));

  if (input.status !== 'new') add('NOT_NEW');

  // ---- data
  const a = order?.address || {};
  const meta = order?.addressMeta || {};
  const name = trimmed(a.fullName);
  if (name.length < 2 || /^guest$/i.test(name)) add('NAME_MISSING');
  if (!PHONE_RE.test(trimmed(a.phone))) add('PHONE_INVALID');
  const street = trimmed(a.street);
  if (street.length < 4 || STREET_PLACEHOLDERS.includes(street)) add('STREET_MISSING');
  if (!trimmed(meta.citySlug)) add('CITY_MISSING');
  else if (meta.citySlug === 'amman' && !trimmed(meta.ammanAreaId)) add('AREA_MISSING');

  // ---- delivery / price / stock (from the server's own pricing + inventory plan)
  if ([...warn].some((c) => DELIVERY_REVIEW.has(c))) add('DELIVERY_UNKNOWN');
  if ([...warn].some((c) => PRICE_REVIEW.has(c))) add('PRICE_PROBLEM');
  const stockCodes = [...warn].filter((c) => STOCK_REVIEW.has(c));
  if (stockCodes.length) add('STOCK_PROBLEM', { codes: stockCodes });

  // ---- bots
  if (input.turnstileVerified !== true) add('BOT_CHECK_MISSING');

  // ---- duplicates (same phone, other pending/accepted orders in the window) — unknown counts as "maybe"
  if (input.recentSamePhone === null || input.recentSamePhone === undefined || !Number.isInteger(input.recentSamePhone) || input.recentSamePhone < 0) add('DUPLICATE_CHECK_UNAVAILABLE');
  else if (input.recentSamePhone > 0) add('DUPLICATE_PHONE', { count: input.recentSamePhone, windowHours: s.duplicateWindowHours });

  // ---- unusual quantities / value
  const items = Array.isArray(order?.items) ? order.items : [];
  const qtys = items.map((it) => (Number.isInteger(it?.quantity) ? it.quantity : Infinity));
  if (!items.length || qtys.some((q) => q > s.maxLineQty)) add('LINE_QTY_HIGH', { max: s.maxLineQty });
  const totalQty = qtys.reduce((x, y) => x + y, 0);
  if (totalQty > s.maxTotalQty) add('TOTAL_QTY_HIGH', { max: s.maxTotalQty });
  const total = input.serverTotal;
  if (typeof total !== 'number' || !Number.isFinite(total)) add('TOTAL_UNKNOWN');
  else if (total > s.maxOrderTotal) add('ORDER_TOTAL_HIGH', { max: s.maxOrderTotal });

  // ---- payment: CliQ is not verified by the Worker -> a human checks the transfer first
  if (order?.paymentMethod === 'cliq') {
    if (!s.allowCliq) add('CLIQ_NEEDS_VERIFICATION');
  } else if (order?.paymentMethod !== 'cod') add('PAYMENT_UNKNOWN');

  // ---- review list (fingerprints only)
  if (input.phoneHash && s.blockedPhoneHashes.includes(input.phoneHash)) add('PHONE_BLOCKED');

  return reasons.length ? result('manual_review', reasons) : result('auto_accept', []);
}

/** short Arabic summary for Telegram: "يحتاج مراجعة: …" */
export function reasonsText(reasons) {
  return (Array.isArray(reasons) ? reasons : []).map((r) => REASON_AR[r.code] || r.code).join('، ');
}
