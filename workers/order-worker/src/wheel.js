// Prize wheel — TEST ONLY (WHEEL_MODE=test; production refuses any mode but 'off', see config.js).
//
// Identity: a VERIFIED Firebase account (Google or e-mail). Never an IP, never an unverified phone number.
// The draw happens HERE with a CSPRNG; the browser only asks and shows. Every result (a prize or "no prize") is stored.
//
// Firestore (written by the Worker's service account only — the rules have NO match for these: browsers are denied):
//   wheelCampaigns/{cid}              campaign settings (dates, minimum, prizes, weights, quantities, costs, budget)
//   wheelPool/{cid}_{prizeId}         { remaining } — decremented in the SAME commit as the spin (never over-awarded)
//   wheelEntitlements/{cid}_{uid}     { granted, used } — 1 first chance + 1 per qualifying DELIVERED order
//   wheelSpins/{cid}_{uid}_{n}        the n-th result: created with exists:false -> one result per chance, ever
//   wheelGrants/{orderId}             created with exists:false when an order earns a chance -> at most once per order
//
// A spin is idempotent: the n-th spin document is created once; a retry after a lost answer, a second tab or a
// refresh finds `used == granted` and gets the STORED result back (never a new draw).
// A prize goes into an order through the normal order flow (orders.js): the gift line is reserved with the order,
// deducted once on delivery and released on cancellation by the same reservation code as any other line.

import { encodeFields, decodeFields, isConflict } from './firestore.js';
import { log } from './http.js';

export const NO_PRIZE = 'none';
const DAY_MS = 86_400_000;

/**
 * Per-campaign key of a delivery phone number: HMAC-SHA256 with a SERVER-ONLY secret (WHEEL_PHONE_SECRET, never sent
 * to a browser, never logged). A plain hash of a 9-digit Jordanian number could be reversed by trying every number;
 * without the secret the key reveals nothing. The phone is NOT proof of identity (unverified, can be shared): it only
 * limits how many gifts can be open at the same time for one delivery number.
 */
export async function phoneKey(secret, campaignId, phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-9);
  if (!secret || digits.length < 7) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`wph1:${campaignId}:${digits}`));
  return `${campaignId}_${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
export const SPIN_ATTEMPTS = 5;
/**
 * Owner's EXCEPTION for "discount on the SECOND order" prizes (appliesTo 'next_order'): never the 60-minute window.
 *   1. from the WIN, the account has WHEEL_SECOND_ORDER_HOURS (120 h = 5 days) to CREATE its first order
 *      ('waiting', firstOrderBy). No first order by then -> expired, its pool unit back (once).
 *   2. a first order created in time keeps the prize 'waiting' until that order is DELIVERED (linked: firstOrderId).
 *      That order cancelled / refused -> re-evaluated (another order created in time, or the 5 days still running,
 *      or expired) — never granted on an order that does not qualify.
 *   3. the first delivery starts a NEW 120 h to use it, on the account's ACTUAL second order only (exactly one
 *      non-cancelled order, delivered), products >= its minimum (15 JOD), once. The order count and the use of the
 *      discount are committed ATOMICALLY with the account's order sequence (wheelAccountOrders/{uid}, below).
 */
export const secondOrderWindowMs = (cfg) => (Number.isFinite(cfg?.wheelSecondOrderHours) && cfg.wheelSecondOrderHours > 0 ? cfg.wheelSecondOrderHours : 120) * 3_600_000;
/** owner's rule: a first order created in time must be DELIVERED within this many hours of its creation (168 = 7 days) */
export const firstDeliveryMs = (cfg) => (Number.isFinite(cfg?.wheelFirstDeliveryHours) && cfg.wheelFirstDeliveryHours > 0 ? cfg.wheelFirstDeliveryHours : 168) * 3_600_000;
export const isSecondOrderPrize = (p) => !!p && p.type === 'discount' && p.appliesTo === 'next_order';

/**
 * Per-account ORDER SEQUENCE (Worker only; browsers are denied): bumped in the SAME commit as every order the account
 * creates and every status change of its orders. An order that uses a second-order discount reads it BEFORE reading
 * the account's orders and commits only if it is still that version: any other order of the account created / changed
 * in between makes the commit fail -> re-read -> the discount is refused if this is no longer the actual second order.
 */
export const accountSeqPath = (uid) => `wheelAccountOrders/${uid}`;
/** a bump without a precondition (orders that do not carry a second-order discount: they never wait for each other) */
export const accountSeqBump = (fs, uid) => ({ update: { name: fs.name(accountSeqPath(uid)), fields: encodeFields({ uid }) }, updateMask: { fieldPaths: ['uid'] }, updateTransforms: [{ fieldPath: 'seq', increment: { integerValue: '1' } }] });
/** the bump of an order that uses the discount: only on the version read before the account's orders were counted */
export const accountSeqGuardedBump = (fs, uid, doc) => ({ ...accountSeqBump(fs, uid), currentDocument: doc.exists ? { updateTime: doc.updateTime } : { exists: false } });

const live = (docs, excludeOrderId) => docs.map((d) => ({ id: d.name.split('/').pop(), ...decodeFields(d.fields) })).filter((o) => o.status !== 'cancelled' && o.id !== excludeOrderId);
async function accountOrders(fs, uid) {
  return fs.runQuery({
    from: [{ collectionId: 'orders' }],
    where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: uid } } },
    limit: 50,
  });
}
const createdMs = (o) => (o.createdAt instanceof Date ? o.createdAt.getTime() : Number.isFinite(o.createdAtMs) ? o.createdAtMs : Infinity);

/**
 * Where the account stands for a second-order prize, read by the Worker from Firestore (never from the browser).
 * Cancelled orders do not count. 'one_delivered' = exactly one order, delivered: the NEXT order is the actual second.
 *   none | pending (one order, not delivered yet) | one_delivered { deliveredAt } | past (two or more orders)
 */
export async function secondOrderState(fs, uid, { excludeOrderId = null } = {}) {
  if (!uid) return { state: 'none' };
  const orders = live(await accountOrders(fs, uid), excludeOrderId);
  if (orders.length === 0) return { state: 'none' };
  if (orders.length > 1) return { state: 'past', count: orders.length };
  const o = orders[0];
  if (o.status !== 'delivered') return { state: 'pending', orderId: o.id, createdAtMs: createdMs(o) };
  const L = await fs.get(`orderLedger/${o.id}`);
  const at = L.exists ? decodeFields(L.fields).deliveredAt : null;
  return { state: 'one_delivered', orderId: o.id, deliveredAt: at instanceof Date ? at : null };
}

/** the account's earliest live order created by `byMs` (the first-order deadline): { id, createdAtMs } or null */
export async function firstOrderWithin(fs, uid, byMs, { excludeOrderId = null } = {}) {
  if (!uid) return null;
  const ok = live(await accountOrders(fs, uid), excludeOrderId).filter((o) => createdMs(o) <= byMs).sort((a, b) => createdMs(a) - createdMs(b));
  return ok[0] ? { id: ok[0].id, createdAtMs: createdMs(ok[0]) } : null;
}
/**
 * Linking a waiting prize to its first order: kept until that order is DELIVERED, at most 168 h after the order was
 * created (deliveryBy) and never past the campaign end. Returns the stored fields, or null when that time is already
 * over (the prize must expire instead). Nothing about the ORDER changes: only the prize document.
 */
export function linkFirstOrder(cfg, order, waitingUntilMs, now) {
  const deliveryBy = order.createdAtMs + firstDeliveryMs(cfg);
  if (!Number.isFinite(deliveryBy) || deliveryBy <= now) return null;
  return { firstOrderId: order.id, deliveryBy: new Date(deliveryBy), issuedExpiry: new Date(Math.min(deliveryBy, waitingUntilMs || deliveryBy)) };
}

/**
 * The stored terms of a second-order prize won at `winAt` by an account in `st`, at `now`:
 *   waiting  { firstOrderBy } no order yet: create one before winAt + 120 h (the cron expires it after)
 *   waiting  { firstOrderId } one order exists, not delivered: kept until it is delivered (campaign end at most)
 *   issued   { expiresAt }    first delivery + 120 h, still ahead
 *   null                      the account can never use it (actual second order behind it / its 5 days over)
 */
export function secondOrderTerms(cfg, campaign, st, now, winAt = now) {
  const until = new Date(campaign.endsAt);
  const by = new Date(winAt + secondOrderWindowMs(cfg));
  if (st.state === 'none') {
    if (by.getTime() <= now) return null;
    return { status: 'waiting', expiresAt: null, firstOrderBy: by, issuedExpiry: new Date(Math.min(by.getTime(), until.getTime())), waitingUntil: until };
  }
  if (st.state === 'pending') {
    // an order is already open: it is the first order — delivered within 168 h of ITS creation, or the prize ends
    const link = linkFirstOrder(cfg, { id: st.orderId, createdAtMs: st.createdAtMs }, until.getTime(), now);
    return link ? { status: 'waiting', expiresAt: null, firstOrderBy: by, waitingUntil: until, ...link } : null;
  }
  if (st.state === 'one_delivered' && st.deliveredAt) {
    const end = st.deliveredAt.getTime() + secondOrderWindowMs(cfg);
    if (end > now) return { status: 'issued', expiresAt: new Date(end), issuedExpiry: new Date(end), activatedAt: st.deliveredAt, firstOrderId: st.orderId };
  }
  return null;
}
/** the stored fields of those terms (a spin document) */
export const secondOrderFields = (t) => ({
  status: t.status, expiresAt: t.expiresAt, issuedExpiry: t.issuedExpiry,
  ...(t.waitingUntil ? { waitingUntil: t.waitingUntil } : {}), ...(t.firstOrderBy ? { firstOrderBy: t.firstOrderBy } : {}),
  ...(t.firstOrderId ? { firstOrderId: t.firstOrderId } : {}), ...(t.activatedAt ? { activatedAt: t.activatedAt } : {}),
  ...(t.deliveryBy ? { deliveryBy: t.deliveryBy } : {}),
});
/** the campaign as this account can win it: second-order prizes it can never use are not drawn (nor shown) */
export const campaignFor = (campaign, sst, cfg, now) => (!campaign || !campaign.prizes.some(isSecondOrderPrize) || !sst || secondOrderTerms(cfg, campaign, sst, now)
  ? campaign
  : { ...campaign, prizes: campaign.prizes.map((p) => (isSecondOrderPrize(p) ? { ...p, active: false } : p)) });

/**
 * How long a won, not-yet-used prize stays valid: WHEEL_PRIZE_HOLD_MINUTES (owner's rule: 60 minutes from the spin).
 * Past it the prize can no longer be attached to an order and its pool unit goes back (expireUnclaimedPrizes, also run
 * before every spin). A prize attached to an order in time follows that order (delivered / cancelled), not the clock.
 */
export const prizeHoldMs = (cfg) => (Number.isFinite(cfg?.wheelPrizeHoldMinutes) && cfg.wheelPrizeHoldMinutes > 0 ? cfg.wheelPrizeHoldMinutes : 60) * 60_000;
const ID_RE = /^[a-z0-9-]{1,40}$/;
export const PRIZE_TYPES = Object.freeze(['gift', 'discount', 'free_delivery', 'none']);
export const MAX_SLOTS = 24;
/** a gift without a catalogue product (the store picks it at packing): its order line carries this product id */
export const GENERIC_GIFT_PRODUCT = 'wheel-gift';
// threshold the owner set for the "big" prizes (watch, 4 / 5 JOD discounts) — used only for WARNINGS, never applied
export const BIG_PRIZE_SUGGESTED_MIN_JOD = 15;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const ms = (v) => (v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN);
const optMs = (v) => (v === undefined || v === null || v === '' ? null : ms(v));
const round3 = (n) => Math.round(n * 1000) / 1000;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Full check of a campaign: { campaign, errors, warnings }. `campaign` is null as soon as there is ONE error (never a
 * partial guess). Warnings never block: they tell the owner about settings that may lose money or contradict a rule.
 *
 * A slot ("prize") is one segment of the wheel, shown in array order:
 *   type 'gift'          a present; productId = a catalogue product (reserved with the order, deducted on delivery)
 *                        or none (a "gift worth valueJod" the store picks when packing; pool quantity only)
 *   type 'discount'      valueJod off the order's products (never below 0); appliesTo 'this_order' | 'next_order'
 *                        ('next_order': only on an order of an account that already has a DELIVERED order)
 *   type 'free_delivery' the delivery fee is waived up to valueJod
 *   type 'none'          "حظ أوفر": a visible segment that wins nothing (its own weight)
 * minOrderJod (per slot, default the campaign's) is measured on the PRODUCTS' prices before the wheel prize, without
 * delivery. weight = relative chance (server-side draw). quantity = units for the whole campaign (pool).
 */
export function checkCampaign(raw) {
  const errors = [];
  const warnings = [];
  const fail = (m) => { errors.push(m); };
  if (!raw || typeof raw !== 'object') return { campaign: null, errors: ['الحملة غير موجودة'], warnings };
  const minOrderJod = num(raw.minOrderJod);
  const budgetJod = num(raw.budgetJod);
  const noPrizeWeight = raw.noPrizeWeight === undefined ? 0 : int(raw.noPrizeWeight);
  const startsAt = ms(raw.startsAt);
  const endsAt = ms(raw.endsAt);
  if (minOrderJod === null || minOrderJod < 0) fail('الحد الأدنى العام للطلب غير صالح');
  if (budgetJod === null || budgetJod < 0) fail('ميزانية الحملة غير صالحة');
  if (noPrizeWeight === null) fail('وزن «بدون جائزة» غير صالح');
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) fail('تاريخ البداية والنهاية غير صالحين');
  if (!['return', 'expire'].includes(raw.giftOnCancel)) fail('سياسة الجائزة عند الإلغاء غير صالحة');
  if (!Array.isArray(raw.prizes) || raw.prizes.length > MAX_SLOTS) fail(`عدد الخانات يجب ألا يتجاوز ${MAX_SLOTS}`);
  // freeFirstChance (default TRUE = the welcome spin of every new account; false only with the owner's approval)
  // openGiftsPerPhone: prizes attached to not-yet-delivered orders at the same time for one delivery number (default 1).
  // prizeValidDays: an unclaimed prize expires (default 30); the cron returns it to the pool ONLY while unclaimed.
  const openGiftsPerPhone = raw.openGiftsPerPhone === undefined ? 1 : int(raw.openGiftsPerPhone);
  const prizeValidDays = raw.prizeValidDays === undefined ? 30 : int(raw.prizeValidDays);
  if (openGiftsPerPhone === null || openGiftsPerPhone < 1) fail('حد الجوائز المفتوحة لكل رقم هاتف غير صالح');
  if (prizeValidDays === null || prizeValidDays < 1 || prizeValidDays > 365) fail('مدة صلاحية الجائزة يجب أن تكون بين 1 و365 يومًا');
  const prizes = [];
  let worstCaseCost = 0;
  for (const [i, p] of (Array.isArray(raw.prizes) ? raw.prizes : []).entries()) {
    const at = `الخانة ${i + 1}`;
    if (!p || typeof p !== 'object') { fail(`${at}: بيانات غير صالحة`); continue; }
    const type = p.type === undefined ? 'gift' : p.type;
    if (!PRIZE_TYPES.includes(type)) { fail(`${at}: نوع غير معروف`); continue; }
    if (!ID_RE.test(String(p.id || '')) || p.id === NO_PRIZE) { fail(`${at}: المعرّف يجب أن يكون أحرفًا إنجليزية صغيرة وأرقامًا وشرطات`); continue; }
    const label = typeof p.label === 'string' ? p.label.trim() : '';
    if (!label || label.length > 40) { fail(`${at}: الاسم مطلوب (40 حرفًا كحد أقصى)`); continue; }
    const weight = int(p.weight);
    if (weight === null || weight > 1_000_000) { fail(`${at}: الوزن الاحتمالي يجب أن يكون عددًا صحيحًا ≥ 0`); continue; }
    const color = p.color === undefined || p.color === null || p.color === '' ? null : String(p.color);
    if (color !== null && !HEX_COLOR.test(color)) { fail(`${at}: اللون يجب أن يكون بصيغة #RRGGBB`); continue; }
    const icon = typeof p.icon === 'string' ? p.icon.trim().slice(0, 8) : '';
    const description = typeof p.description === 'string' ? p.description.trim().slice(0, 200) : '';
    const imageUrl = typeof p.imageUrl === 'string' && /^https:\/\/[^\s"'<>]{1,300}$/.test(p.imageUrl.trim()) ? p.imageUrl.trim() : '';
    const active = p.active !== false;
    const pStarts = optMs(p.startsAt);
    const pEnds = optMs(p.endsAt);
    if ((pStarts !== null && !Number.isFinite(pStarts)) || (pEnds !== null && !Number.isFinite(pEnds)) || (pStarts !== null && pEnds !== null && pEnds <= pStarts)) { fail(`${at}: تاريخ الخانة غير صالح`); continue; }
    const display = { id: p.id, type, label, description, icon, color, imageUrl, weight, active, startsAt: pStarts, endsAt: pEnds };
    if (type === 'none') { prizes.push({ ...display, quantity: null, unitCostJod: 0, valueJod: 0, minOrderJod: 0, appliesTo: 'this_order', productId: null, variantId: null, validDays: null }); continue; }
    const quantity = int(p.quantity);
    if (quantity === null) { fail(`${at}: الكمية المتاحة يجب أن تكون عددًا صحيحًا ≥ 0`); continue; }
    const valueJod = p.valueJod === undefined || p.valueJod === null ? null : num(p.valueJod);
    if (valueJod !== null && (valueJod < 0 || valueJod > 1000)) { fail(`${at}: القيمة غير صالحة`); continue; }
    if ((type === 'discount' || type === 'free_delivery') && !(valueJod > 0)) { fail(`${at}: قيمة الخصم / سقف التوصيل مطلوبة وأكبر من صفر`); continue; }
    const pMin = p.minOrderJod === undefined || p.minOrderJod === null ? minOrderJod : num(p.minOrderJod);
    if (pMin === null || pMin < 0) { fail(`${at}: الحد الأدنى للطلب غير صالح`); continue; }
    const appliesTo = p.appliesTo === undefined ? 'this_order' : p.appliesTo;
    if (!['this_order', 'next_order'].includes(appliesTo)) { fail(`${at}: مجال التطبيق غير صالح`); continue; }
    if (appliesTo === 'next_order' && type !== 'discount') { fail(`${at}: «الطلب الثاني» متاح لجوائز الخصم فقط`); continue; }
    const productId = type === 'gift' && p.productId ? String(p.productId) : null;
    if (productId !== null && (!/^[A-Za-z0-9_-]{1,120}$/.test(productId) || productId === GENERIC_GIFT_PRODUCT)) { fail(`${at}: معرّف المنتج غير صالح`); continue; }
    const variantId = productId && p.variantId ? String(p.variantId).slice(0, 120) : null;
    // cost to the store of ONE unit (budget): a discount / waived delivery costs its value; a gift its declared cost
    const unitCostJod = p.unitCostJod === undefined || p.unitCostJod === null ? (type === 'gift' ? valueJod : valueJod) : num(p.unitCostJod);
    if (unitCostJod === null || unitCostJod < 0) { fail(`${at}: تكلفة الوحدة مطلوبة (للهدية: تكلفتها على المكتبة)`); continue; }
    const validDays = p.validDays === undefined || p.validDays === null ? null : int(p.validDays);
    if (validDays !== null && (validDays < 1 || validDays > 365)) { fail(`${at}: صلاحية الجائزة بين 1 و365 يومًا`); continue; }
    if (type === 'discount' && pMin !== null && valueJod >= pMin) fail(`${at}: الخصم (${valueJod} د.أ) يجب أن يكون أقل من الحد الأدنى للطلب (${pMin} د.أ)`);
    worstCaseCost += quantity * unitCostJod;
    prizes.push({ ...display, quantity, unitCostJod, valueJod: valueJod ?? 0, minOrderJod: pMin, appliesTo, productId, variantId, validDays });
    // ---- warnings (never block) ----
    const value = type === 'gift' ? (valueJod ?? unitCostJod) : valueJod;
    if (value >= 4 && pMin < BIG_PRIZE_SUGGESTED_MIN_JOD) warnings.push(`${at} «${label}»: قيمتها ${value} د.أ وحدّها الأدنى ${pMin} د.أ فقط — قد تسبب خسارة؛ يُقترح ${BIG_PRIZE_SUGGESTED_MIN_JOD} د.أ`);
    if (type === 'free_delivery' && valueJod > 3) warnings.push(`${at} «${label}»: سقف التوصيل المجاني ${valueJod} د.أ أعلى من أغلى توصيل حالي (3 د.أ)`);
    if (pMin > 0 && value / pMin > 0.4) warnings.push(`${at} «${label}»: قيمة الجائزة ${Math.round((value / pMin) * 100)}% من الحد الأدنى للطلب`);
    if (quantity === 0 && active && weight > 0) warnings.push(`${at} «${label}»: الكمية 0 — لن تظهر على الدولاب`);
    if (pEnds !== null && Number.isFinite(endsAt) && pEnds > endsAt) warnings.push(`${at} «${label}»: تاريخ انتهائها بعد نهاية الحملة`);
    // owner's rule: the second-order discount only on products of 15 JOD or more
    if (appliesTo === 'next_order' && pMin < BIG_PRIZE_SUGGESTED_MIN_JOD) fail(`${at} «${label}»: خصم الطلب الثاني يتطلب حدًا أدنى ${BIG_PRIZE_SUGGESTED_MIN_JOD} د.أ على الأقل`);
  }
  if (new Set(prizes.map((p) => p.id)).size !== prizes.length) fail('معرّفات الخانات مكررة');
  // the budget can never be exceeded: every prize quantity at its cost must fit in it
  if (budgetJod !== null && worstCaseCost > budgetJod + 1e-9) fail(`مجموع تكلفة كل الجوائز (${round3(worstCaseCost)} د.أ) يتجاوز الميزانية (${budgetJod} د.أ)`);
  const noneSlots = prizes.filter((p) => p.type === 'none');
  if (raw.active === true && noneSlots.length < 3 && prizes.length) warnings.push(`عدد خانات «حظ أوفر» ${noneSlots.length} (المتفق عليه 3)`);
  const totalWeight = prizes.reduce((s, p) => s + (p.active ? p.weight : 0), 0) + (noPrizeWeight || 0);
  if (raw.active === true && totalWeight <= 0) fail('لا توجد أي خانة بوزن احتمالي أكبر من صفر');
  if (totalWeight > 0) {
    const costPerSpin = prizes.reduce((s, p) => s + (p.active && p.type !== 'none' ? p.weight * p.unitCostJod : 0), 0) / totalWeight;
    warnings.push(`متوسط التكلفة المتوقعة لكل لفة ≈ ${round3(costPerSpin)} د.أ (قبل نفاد الكميات)`);
    for (const p of prizes) {
      const share = p.active ? p.weight / totalWeight : 0;
      if (p.type !== 'none' && p.unitCostJod >= 4 && share > 0.05) warnings.push(`«${p.label}»: احتمالها ${Math.round(share * 1000) / 10}% مرتفع لجائزة تكلفتها ${p.unitCostJod} د.أ`);
    }
  }
  if (errors.length) return { campaign: null, errors, warnings };
  return {
    campaign: { freeFirstChance: raw.freeFirstChance !== false, openGiftsPerPhone, prizeValidDays, active: raw.active === true, minOrderJod, budgetJod, noPrizeWeight, startsAt, endsAt, giftOnCancel: raw.giftOnCancel, prizes, terms: typeof raw.terms === 'string' ? raw.terms.slice(0, 2000) : '' },
    errors,
    warnings,
  };
}

/** Normalised campaign or null (any invalid part makes the whole campaign unusable — never a partial guess). */
export function validCampaign(raw) {
  return checkCampaign(raw).campaign;
}

export function campaignOpen(c, now) {
  if (!c) return { ok: false, code: 'CAMPAIGN_INVALID' };
  if (!c.active) return { ok: false, code: 'CAMPAIGN_CLOSED' };
  if (now < c.startsAt) return { ok: false, code: 'CAMPAIGN_NOT_STARTED' };
  if (now >= c.endsAt) return { ok: false, code: 'CAMPAIGN_ENDED' };
  return { ok: true };
}

/** a slot can be drawn now: active, inside its own dates, weight > 0 and (prizes) still in the pool */
export function slotDrawable(p, remainingById, now) {
  if (!p.active || p.weight <= 0) return false;
  if (p.startsAt !== null && now < p.startsAt) return false;
  if (p.endsAt !== null && now >= p.endsAt) return false;
  return p.type === 'none' || (remainingById.get(p.id) ?? 0) > 0;
}

/**
 * Weighted draw among the slots that can be drawn now (see slotDrawable), plus the legacy "no prize" weight.
 * Returns the slot id ("none" slots return THEIR id, so the wheel stops on the segment actually drawn), or NO_PRIZE.
 * `rand(n)` -> integer in [0, n).
 */
export function drawPrize(campaign, remainingById, rand, now = Date.now()) {
  const options = campaign.prizes.filter((p) => slotDrawable(p, remainingById, now)).map((p) => ({ id: p.id, w: p.weight }));
  if (campaign.noPrizeWeight > 0) options.push({ id: NO_PRIZE, w: campaign.noPrizeWeight });
  const total = options.reduce((s, o) => s + o.w, 0);
  if (total <= 0) return NO_PRIZE;
  let r = rand(total);
  for (const o of options) { if (r < o.w) return o.id; r -= o.w; }
  return NO_PRIZE;
}

/** what a visitor sees on the wheel: ONLY segments that can be drawn now (never a prize that cannot be won) */
export function displaySlots(campaign, remainingById, now = Date.now()) {
  if (!campaign) return [];
  return campaign.prizes.filter((p) => slotDrawable(p, remainingById, now)).map((p) => ({
    id: p.id, type: p.type, label: p.label, description: p.description, icon: p.icon, color: p.color, imageUrl: p.imageUrl,
    valueJod: p.valueJod, minOrderJod: p.minOrderJod, appliesTo: p.appliesTo,
  }));
}

/** Unbiased integer in [0, n) from the platform CSPRNG. */
export function secureRand(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

const spinPath = (cid, uid, n) => `wheelSpins/${cid}_${uid}_${n}`;
/** the prize terms stored WITH the result (fixed at spin time: a later edit by the admin never changes a won prize) */
export const spinTerms = (s) => ({
  type: s.prizeType || (s.status === NO_PRIZE ? 'none' : 'gift'),
  valueJod: typeof s.valueJod === 'number' ? s.valueJod : 0,
  minOrderJod: typeof s.minOrderJod === 'number' ? s.minOrderJod : null,
  appliesTo: s.appliesTo === 'next_order' ? 'next_order' : 'this_order',
});
const publicSpin = (s) => (s ? {
  spinId: `${s.campaignId}_${s.uid}_${s.n}`, n: s.n, prizeId: s.prizeId, label: s.label, status: s.status, orderId: s.orderId || null,
  ...spinTerms(s), description: s.description || '', expiresAt: s.expiresAt instanceof Date ? s.expiresAt.toISOString() : null,
  ...(s.waitingUntil instanceof Date ? { waitingUntil: s.waitingUntil.toISOString() } : {}),
  ...(s.activatedAt instanceof Date ? { activatedAt: s.activatedAt.toISOString() } : {}),
  ...(s.firstOrderBy instanceof Date ? { firstOrderBy: s.firstOrderBy.toISOString() } : {}),
  ...(s.status === 'waiting' && s.firstOrderId ? { firstOrderId: s.firstOrderId } : {}),
  ...(s.status === 'waiting' && s.deliveryBy instanceof Date ? { deliveryBy: s.deliveryBy.toISOString() } : {}),
  ...(s.status === 'expired' && typeof s.expiredReason === 'string' ? { expiredReason: s.expiredReason } : {}),
} : null);

/** A missing document = the welcome chance (`base` 1), or none when the campaign has freeFirstChance=false. */
export function entitlement(doc, base = 1) {
  const d = doc?.exists ? decodeFields(doc.fields) : {};
  return { granted: Number.isInteger(d.granted) ? d.granted : base, used: Number.isInteger(d.used) ? d.used : 0 };
}

async function readCampaign(fs, cfg) {
  const doc = await fs.get(`wheelCampaigns/${cfg.wheelCampaignId}`);
  return { doc, campaign: doc.exists ? validCampaign(decodeFields(doc.fields)) : null };
}

async function poolRemaining(fs, cid, campaign) {
  const prizes = (campaign?.prizes || []).filter((p) => p.type !== 'none');
  const docs = prizes.length ? await fs.batchGet(prizes.map((p) => `wheelPool/${cid}_${p.id}`)) : [];
  return new Map(prizes.map((p, i) => [p.id, docs[i].exists ? Number(decodeFields(docs[i].fields).remaining) || 0 : 0]));
}

/**
 * Has this VERIFIED account an order that was really DELIVERED (not just created, not cancelled)? Read by the Worker
 * from Firestore — never a value sent by the browser. Used by the "discount on the second order" prize.
 */
export async function hasDeliveredOrder(fs, uid) {
  if (!uid) return false;
  const docs = await fs.runQuery({
    from: [{ collectionId: 'orders' }],
    where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: uid } } },
      { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'delivered' } } },
    ] } },
    limit: 1,
  });
  return docs.length > 0;
}

/** GET /wheel/public — no account needed: the segments a visitor sees (never weights, quantities or costs). */
export async function wheelPublic(fs, cfg, { now = Date.now() } = {}) {
  if (cfg.wheelMode === 'off') return { status: 404, body: { ok: false, code: 'WHEEL_OFF' } };
  const { campaign } = await readCampaign(fs, cfg);
  const open = campaignOpen(campaign, now);
  const slots = open.ok ? displaySlots(campaign, await poolRemaining(fs, cfg.wheelCampaignId, campaign), now) : [];
  return {
    status: 200,
    body: { ok: true, campaign: open.ok ? 'open' : open.code, slots, minOrderJod: campaign?.minOrderJod ?? null, prizeHoldMinutes: prizeHoldMs(cfg) / 60_000, terms: campaign?.terms ?? '' },
  };
}

/** GET /wheel/state — what this account has: chances, stored results (labels + status), campaign open or not. */
export async function wheelState(fs, cfg, uid, { now = Date.now() } = {}) {
  if (cfg.wheelMode === 'off') return { status: 404, body: { ok: false, code: 'WHEEL_OFF' } };
  const { campaign } = await readCampaign(fs, cfg);
  const open = campaignOpen(campaign, now);
  const ent = await fs.get(`wheelEntitlements/${cfg.wheelCampaignId}_${uid}`);
  const e = entitlement(ent, campaign?.freeFirstChance === false ? 0 : 1);
  const spins = [];
  for (let n = 1; n <= Math.min(e.used, 20); n++) {
    const d = await fs.get(spinPath(cfg.wheelCampaignId, uid, n));
    if (d.exists) spins.push(publicSpin(decodeFields(d.fields)));
  }
  // second-order prize: where this account stands (shown / applied from the Worker's reading, never the browser's)
  const sst = campaign?.prizes.some(isSecondOrderPrize) || spins.some((s) => s.appliesTo === 'next_order') ? await secondOrderState(fs, uid) : null;
  const mine = campaignFor(campaign, sst, cfg, now);
  // a waiting prize whose first order exists but is not linked yet (linked when the 5 days end): show the delivery
  // deadline that order already has (created + 168 h) — display only, the cleanup / delivery decide
  if (sst?.state === 'pending' && Number.isFinite(sst.createdAtMs)) {
    for (const sp of spins) if (sp.status === 'waiting' && !sp.deliveryBy && (!sp.firstOrderBy || sst.createdAtMs <= Date.parse(sp.firstOrderBy))) { sp.deliveryBy = new Date(sst.createdAtMs + firstDeliveryMs(cfg)).toISOString(); sp.firstOrderId = sst.orderId; }
  }
  const slots = open.ok ? displaySlots(mine, await poolRemaining(fs, cfg.wheelCampaignId, mine), now) : [];
  return {
    status: 200,
    body: {
      ok: true, mode: cfg.wheelMode, campaign: open.ok ? 'open' : open.code,
      minOrderJod: campaign?.minOrderJod ?? null, terms: campaign?.terms ?? '', prizeHoldMinutes: prizeHoldMs(cfg) / 60_000,
      chancesLeft: open.ok ? Math.max(0, e.granted - e.used) : 0, spins, slots,
      // for the "second order" discount: true = the NEXT order is the account's actual second (one order, delivered)
      previousDelivered: sst ? sst.state === 'one_delivered' : null,
      secondOrder: sst ? sst.state : null,
      secondOrderHours: secondOrderWindowMs(cfg) / 3_600_000,
    },
  };
}

/** POST /wheel/spin — one draw per chance, stored; a repeated call returns the stored result. */
export async function spinWheel(fs, cfg, uid, { now = () => Date.now(), rand = secureRand, email = '' } = {}) {
  if (cfg.wheelMode === 'off') return { status: 404, body: { ok: false, code: 'WHEEL_OFF' } };
  const cid = cfg.wheelCampaignId;
  let sst; // the account's order state, read once (second-order prizes only)
  for (let attempt = 0; attempt < SPIN_ATTEMPTS; attempt++) {
    const { doc: campaignDoc, campaign } = await readCampaign(fs, cfg);
    const open = campaignOpen(campaign, now());
    if (!open.ok) return { status: 409, body: { ok: false, code: open.code } };
    if (sst === undefined) sst = campaign.prizes.some(isSecondOrderPrize) ? await secondOrderState(fs, uid) : null;
    const entPath = `wheelEntitlements/${cid}_${uid}`;
    const pooled = campaign.prizes.filter((p) => p.type !== 'none');
    const poolPaths = pooled.map((p) => `wheelPool/${cid}_${p.id}`);
    const [entDoc, ...poolDocs] = await fs.batchGet([entPath, ...poolPaths]);
    const e = entitlement(entDoc, campaign.freeFirstChance ? 1 : 0);
    if (e.used >= e.granted) {
      // no chance left: the LAST stored result again (a retry / refresh / second tab never draws twice)
      const last = e.used > 0 ? await fs.get(spinPath(cid, uid, e.used)) : { exists: false };
      return { status: 200, body: { ok: true, repeated: true, chancesLeft: 0, result: last.exists ? publicSpin(decodeFields(last.fields)) : null } };
    }
    const remaining = new Map(pooled.map((p, i) => [p.id, poolDocs[i].exists ? Number(decodeFields(poolDocs[i].fields).remaining) || 0 : 0]));
    const at = now();
    // a second-order prize this account can never use is not drawn (the wheel it is shown hides it too)
    const drawnId = drawPrize(campaignFor(campaign, sst, cfg, at), remaining, rand, at);
    const slot = campaign.prizes.find((p) => p.id === drawnId) || null;
    // a "none" slot ("حظ أوفر") is a real segment of the wheel but wins nothing
    const prize = slot && slot.type !== 'none' ? slot : null;
    const n = e.used + 1;
    const validMs = prizeHoldMs(cfg);
    // the owner's exception: a second-order prize: 5 days to create the first order, kept until it is delivered, then
    // 5 days to use it (never the 60 minutes)
    const second = isSecondOrderPrize(prize) ? secondOrderTerms(cfg, campaign, sst, at, at) : null;
    const window = second
      ? secondOrderFields(second)
      : prize ? { status: 'issued', expiresAt: new Date(at + validMs), issuedExpiry: new Date(at + validMs) } : { status: NO_PRIZE };
    const spin = {
      campaignId: cid, uid, n, prizeId: slot ? slot.id : NO_PRIZE,
      label: slot ? slot.label : 'حظ أوفر',
      productId: prize?.productId ?? null, variantId: prize?.variantId ?? null,
      // the prize terms, FIXED now (spinTerms): what the customer was shown is what is applied later
      prizeType: prize ? prize.type : 'none',
      ...(prize ? { valueJod: prize.valueJod, minOrderJod: prize.minOrderJod, appliesTo: prize.appliesTo, description: prize.description } : {}),
      // the verified account's e-mail, for the admin's prize log only (this collection is never readable by browsers)
      ...(email ? { email: String(email).slice(0, 200) } : {}),
      // issuedExpiry exists ONLY while the prize is unclaimed ('issued' / 'waiting'): the cron's query
      // (expireUnclaimedPrizes) reads exactly the expired unclaimed prizes, oldest first, and nothing else
      ...window,
      createdAt: new Date(at),
    };
    const writes = [
      entDoc.exists
        ? { update: { name: fs.name(entPath), fields: encodeFields({ used: n }) }, updateMask: { fieldPaths: ['used'] }, currentDocument: { updateTime: entDoc.updateTime } }
        : { update: { name: fs.name(entPath), fields: encodeFields({ campaignId: cid, uid, granted: 1, used: 1 }) }, currentDocument: { exists: false } },
      { update: { name: fs.name(spinPath(cid, uid, n)), fields: encodeFields(spin) }, currentDocument: { exists: false } },
      // the campaign must not change between the read and the commit (closed / edited meanwhile -> re-read)
      { verify: fs.name(`wheelCampaigns/${cid}`), currentDocument: { updateTime: campaignDoc.updateTime } },
    ];
    if (prize) {
      const i = pooled.findIndex((p) => p.id === prize.id);
      writes.push({ update: { name: fs.name(poolPaths[i]), fields: encodeFields({ remaining: remaining.get(prize.id) - 1 }) }, updateMask: { fieldPaths: ['remaining'] }, currentDocument: { updateTime: poolDocs[i].updateTime } });
    }
    const r = await fs.commit(writes);
    if (r.ok) {
      log('wheel.spin', { campaignId: cid, n, prize: slot ? slot.id : NO_PRIZE });
      return { status: 200, body: { ok: true, repeated: false, chancesLeft: e.granted - n, result: publicSpin(spin) } };
    }
    if (!isConflict(r)) return { status: 503, body: { ok: false, code: 'UNAVAILABLE' } };
  }
  return { status: 409, body: { ok: false, code: 'BUSY' } };
}

// ------------------------------------------------------------------ order integration (orders.js / fulfilment.js)

/**
 * Validates a prize the customer wants to receive with THIS order. Never trusts the browser: the spin is read from
 * Firestore; it must belong to the verified account, be 'issued', and its campaign must be open.
 * Returns { ok: true, gift } or { ok: false, code }.
 */
export async function loadGiftForOrder(fs, cfg, { spinId, uid, now = Date.now() }) {
  if (cfg.wheelMode === 'off') return { ok: false, code: 'WHEEL_OFF' };
  if (!uid) return { ok: false, code: 'WHEEL_SIGN_IN_REQUIRED' };
  if (typeof spinId !== 'string' || !/^[a-z0-9-]{1,40}_[A-Za-z0-9_-]{1,128}_\d{1,4}$/.test(spinId)) return { ok: false, code: 'WHEEL_PRIZE_INVALID' };
  const [spinDoc, campaignDoc] = await fs.batchGet([`wheelSpins/${spinId}`, `wheelCampaigns/${cfg.wheelCampaignId}`]);
  if (!spinDoc.exists) return { ok: false, code: 'WHEEL_PRIZE_INVALID' };
  const s = decodeFields(spinDoc.fields);
  if (s.uid !== uid || s.campaignId !== cfg.wheelCampaignId) return { ok: false, code: 'WHEEL_PRIZE_INVALID' };
  if (s.status === 'expired' || (s.status === 'issued' && s.expiresAt instanceof Date && s.expiresAt.getTime() <= now)) return { ok: false, code: 'WHEEL_PRIZE_EXPIRED' };
  // second-order prize still waiting for the account's FIRST delivery: kept, not usable yet
  if (s.status === 'waiting') return { ok: false, code: 'WHEEL_NEEDS_PREVIOUS_ORDER', minOrderJod: typeof s.minOrderJod === 'number' ? s.minOrderJod : undefined };
  // reserved by an order: the caller checks whether it is THIS order (a duplicate send that lost the race -> replay)
  if (s.status !== 'issued') return { ok: false, code: 'WHEEL_PRIZE_USED', reservedFor: typeof s.orderId === 'string' ? s.orderId : null };
  const campaign = campaignDoc.exists ? validCampaign(decodeFields(campaignDoc.fields)) : null;
  const open = campaignOpen(campaign, now);
  if (!open.ok) return { ok: false, code: open.code };
  const terms = spinTerms(s);
  if (terms.type === 'none') return { ok: false, code: 'WHEEL_PRIZE_INVALID' };
  // the "second order" discount: only on an order of an account that ALREADY has a delivered order (Firestore, read
  // by the Worker). The order being placed is never counted: it does not exist yet.
  // only on the account's ACTUAL second order: exactly one non-cancelled order, delivered (read now by the Worker; the
  // order being placed does not exist yet). An order placed in between (pending) makes this one the third -> refused.
  if (terms.appliesTo === 'next_order') {
    const st = await secondOrderState(fs, uid);
    if (st.state === 'none' || st.state === 'pending') return { ok: false, code: 'WHEEL_NEEDS_PREVIOUS_ORDER', minOrderJod: terms.minOrderJod };
    if (st.state !== 'one_delivered') return { ok: false, code: 'WHEEL_NOT_SECOND_ORDER' };
  }
  return {
    ok: true,
    gift: {
      spinId, spinDoc, prizeId: s.prizeId, label: s.label, ...terms,
      // minOrderJod of results stored before per-prize minimums existed: the campaign's
      minOrderJod: terms.minOrderJod ?? campaign.minOrderJod,
      productId: terms.type === 'gift' ? (s.productId || null) : null, variantId: terms.type === 'gift' ? (s.variantId ?? null) : null,
    },
    campaign,
  };
}

/**
 * What a prize does to THIS order's prices (server side; the browser must send the same numbers, else 422 PRICE_CHANGED).
 *   discount       -> discountJod = valueJod, never more than the products still cost after the volume discount
 *   free_delivery  -> shippingWaivedJod = the delivery fee, up to valueJod
 *   gift           -> nothing (a free extra line)
 */
export function prizeAdjustment(gift) {
  if (!gift) return null;
  if (gift.type === 'discount') return { discountJod: gift.valueJod };
  if (gift.type === 'free_delivery') return { shippingCapJod: gift.valueJod };
  return null;
}

/** The open campaign (for "does this order earn a new chance on delivery?"), or null. */
export async function openCampaign(fs, cfg, now = Date.now()) {
  if (cfg.wheelMode === 'off') return null;
  const { campaign } = await readCampaign(fs, cfg);
  return campaignOpen(campaign, now).ok ? campaign : null;
}

/**
 * Status change of an order that carries ledger.wheel (fulfilment.js): extra writes in the SAME commit.
 *   delivered -> the prize (if any) becomes 'consumed'; a qualifying order earns ONE new chance
 *                (wheelGrants/{orderId} exists:false + increment, so a repeated delivery never grants twice)
 *   cancelled before delivery -> the prize goes back to 'issued' (or 'expired', per campaign policy)
 *   returned (delivered -> cancelled) -> the chance earned by this order is taken back (granted - 1)
 */
async function waitingSpins(fs, uid) {
  return fs.runQuery({
    from: [{ collectionId: 'wheelSpins' }],
    where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: uid } } },
      { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'waiting' } } },
    ] } },
    limit: 20,
  });
}

export async function wheelStatusWrites(fs, L, orderId, from, to, at) {
  const w = L?.wheel;
  if (!w || !w.campaignId) return [];
  const writes = [];
  // every status change of the account's orders moves its order sequence (a second-order discount being placed at the
  // same moment re-reads: a delivery / cancellation / return changes which order is the actual second)
  if (w.uid) writes.push(accountSeqBump(fs, w.uid));
  const spin = w.spinId ? await fs.get(`wheelSpins/${w.spinId}`) : null;
  // the delivery number's open-gift slot is freed exactly once: on delivery, or on cancellation before delivery
  // (this runs inside the status-change commit, which carries the ledger's version: a transition is applied once)
  if (w.phoneKey && w.spinId && from !== 'delivered' && (to === 'delivered' || to === 'cancelled')) {
    writes.push({ update: { name: fs.name(`wheelPhoneGifts/${w.phoneKey}`), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'open', increment: { integerValue: '-1' } }], currentDocument: { exists: true } });
  }
  if (to === 'delivered') {
    // the account's FIRST delivery: its waiting second-order prizes start their 120 hours NOW (same commit as the
    // delivery, each with the version read: a repeated delivery / overlapping run never restarts the clock)
    if (w.uid && from !== 'delivered') {
      // only prizes whose first order was CREATED in time (this order created after the 5-day deadline: not a first
      // order for that prize; the cron expires it)
      const createdAt = L.createdAt instanceof Date ? L.createdAt.getTime() : Infinity;
      // ...and DELIVERED within 168 h of its creation (strictly before: at exactly 168 h the prize has ended). The
      // cleanup expiring it and this delivery both commit on the prize's version: whichever is first wins, the other
      // re-reads (a delivery retried after the expiry no longer activates it; the ORDER is delivered either way).
      const atMsD = at instanceof Date ? at.getTime() : Number(at);
      const inTime = atMsD < createdAt + firstDeliveryMs({ wheelFirstDeliveryHours: w.firstDeliveryHours });
      const waiting = !inTime ? [] : (await waitingSpins(fs, w.uid)).filter((d) => { const ws = decodeFields(d.fields); return (!(ws.firstOrderBy instanceof Date) || createdAt <= ws.firstOrderBy.getTime()) && !(ws.deliveryBy instanceof Date && atMsD >= ws.deliveryBy.getTime() && ws.firstOrderId === orderId); });
      if (waiting.length) {
        const before = await secondOrderState(fs, w.uid, { excludeOrderId: orderId });
        const first = before.state === 'none' || before.state === 'pending' || (before.state === 'past' && !(await hasDeliveredOrder(fs, w.uid)));
        if (first) {
          const atMs = at instanceof Date ? at.getTime() : Number(at);
          const end = new Date(atMs + secondOrderWindowMs({ wheelSecondOrderHours: w.secondOrderHours }));
          for (const d of waiting) {
            writes.push({ update: { name: d.name, fields: encodeFields({ status: 'issued', expiresAt: end, issuedExpiry: end, activatedAt: at, firstOrderId: orderId, waitingUntil: null, firstOrderBy: null, deliveryBy: null }) }, updateMask: { fieldPaths: ['status', 'expiresAt', 'issuedExpiry', 'activatedAt', 'firstOrderId', 'waitingUntil', 'firstOrderBy', 'deliveryBy'] }, currentDocument: { updateTime: d.updateTime } });
          }
        }
      }
    }
    if (spin?.exists && decodeFields(spin.fields).status === 'reserved') {
      writes.push({ update: { name: fs.name(`wheelSpins/${w.spinId}`), fields: encodeFields({ status: 'consumed', consumedAt: at }) }, updateMask: { fieldPaths: ['status', 'consumedAt'] }, currentDocument: { updateTime: spin.updateTime } });
    }
    if (w.chanceEligible && w.uid) {
      const grant = await fs.get(`wheelGrants/${orderId}`);
      if (!grant.exists) {
        writes.push({ update: { name: fs.name(`wheelGrants/${orderId}`), fields: encodeFields({ campaignId: w.campaignId, at }) }, currentDocument: { exists: false } });
        const entPath = `wheelEntitlements/${w.campaignId}_${w.uid}`;
        const ent = await fs.get(entPath);
        writes.push(ent.exists
          ? { update: { name: fs.name(entPath), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'granted', increment: { integerValue: '1' } }], currentDocument: { exists: true } }
          // never spun yet: the first free chance + this one (exists:false -> a concurrent first spin makes the commit retry)
          : { update: { name: fs.name(entPath), fields: encodeFields({ campaignId: w.campaignId, uid: w.uid, granted: (w.freeFirstChance === false ? 0 : 1) + 1, used: 0 }) }, currentDocument: { exists: false } });
      }
    }
  } else if (to === 'cancelled') {
    // the account's FIRST order cancelled / refused before delivery: its waiting second-order prizes linked to it are
    // re-evaluated in THIS commit — another order created in time takes its place, or (no such order) the 5 days to
    // create one still run, or they are over: expired, unit back. Never granted on an order that does not qualify.
    if (w.uid && from !== 'delivered') {
      const atMs = at instanceof Date ? at.getTime() : Number(at);
      for (const d of await waitingSpins(fs, w.uid)) {
        const ws = decodeFields(d.fields);
        if (ws.firstOrderId !== orderId) continue;
        const byMs = ws.firstOrderBy instanceof Date ? ws.firstOrderBy.getTime() : 0;
        const other = byMs ? await firstOrderWithin(fs, w.uid, byMs, { excludeOrderId: orderId }) : null;
        // the other order takes its place only if IT can still be delivered within 168 h of its own creation
        const link = other ? linkFirstOrder({ wheelFirstDeliveryHours: w.firstDeliveryHours }, other, ws.waitingUntil instanceof Date ? ws.waitingUntil.getTime() : 0, atMs) : null;
        const guard = { currentDocument: { updateTime: d.updateTime } };
        if (link) {
          writes.push({ update: { name: d.name, fields: encodeFields(link) }, updateMask: { fieldPaths: Object.keys(link) }, ...guard });
        } else if (byMs > atMs) {
          const until = ws.waitingUntil instanceof Date ? ws.waitingUntil.getTime() : byMs;
          writes.push({ update: { name: d.name, fields: encodeFields({ firstOrderId: null, deliveryBy: null, issuedExpiry: new Date(Math.min(byMs, until)) }) }, updateMask: { fieldPaths: ['firstOrderId', 'deliveryBy', 'issuedExpiry'] }, ...guard });
        } else {
          writes.push({ update: { name: d.name, fields: encodeFields({ status: 'expired', expiredAt: at, expiredReason: 'first_order_cancelled', issuedExpiry: null, firstOrderId: null }) }, updateMask: { fieldPaths: ['status', 'expiredAt', 'expiredReason', 'issuedExpiry', 'firstOrderId'] }, ...guard });
          writes.push({ update: { name: fs.name(`wheelPool/${ws.campaignId || w.campaignId}_${ws.prizeId}`), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'remaining', increment: { integerValue: '1' } }], currentDocument: { exists: true } });
        }
      }
    }
    if (from !== 'delivered' && spin?.exists && decodeFields(spin.fields).status === 'reserved') {
      const sp = decodeFields(spin.fields);
      const atMs = at instanceof Date ? at.getTime() : Number(at);
      // 'return' gives the prize back ONLY while its window is still open; past it (or with policy 'expire') the prize
      // ends here and its pool unit goes back IN THIS COMMIT — the commit carries the ledger's and the spin's versions,
      // so a repeated cancellation / overlapping run cannot return it twice (and the cron never sees it: no marker)
      const stillValid = sp.expiresAt instanceof Date && sp.expiresAt.getTime() > atMs;
      const back = w.giftOnCancel === 'return' && stillValid ? 'issued' : 'expired';
      const issuedExpiry = back === 'issued' ? sp.expiresAt : null;
      writes.push({ update: { name: fs.name(`wheelSpins/${w.spinId}`), fields: encodeFields({ status: back, orderId: null, releasedAt: at, issuedExpiry, ...(back === 'expired' ? { expiredAt: at } : {}) }) }, updateMask: { fieldPaths: ['status', 'orderId', 'releasedAt', 'issuedExpiry', ...(back === 'expired' ? ['expiredAt'] : [])] }, currentDocument: { updateTime: spin.updateTime } });
      if (back === 'expired' && sp.prizeId && sp.prizeId !== NO_PRIZE) {
        writes.push({ update: { name: fs.name(`wheelPool/${sp.campaignId || w.campaignId}_${sp.prizeId}`), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'remaining', increment: { integerValue: '1' } }], currentDocument: { exists: true } });
      }
    }
    if (from === 'delivered' && w.chanceEligible && w.uid) {
      const grant = await fs.get(`wheelGrants/${orderId}`);
      if (grant.exists && !decodeFields(grant.fields).revoked) {
        writes.push({ update: { name: fs.name(`wheelGrants/${orderId}`), fields: encodeFields({ revoked: true, revokedAt: at }) }, updateMask: { fieldPaths: ['revoked', 'revokedAt'] }, currentDocument: { updateTime: grant.updateTime } });
        writes.push({ update: { name: fs.name(`wheelEntitlements/${w.campaignId}_${w.uid}`), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'granted', increment: { integerValue: '-1' } }], currentDocument: { exists: true } });
      }
    }
  }
  return writes;
}

/**
 * Cron (WHEEL_MODE=test only): unclaimed prizes past their date -> 'expired', and their pool unit is returned.
 * The query reads ONLY expired unclaimed prizes (issuedExpiry < now; the field exists only while 'issued'), oldest
 * first, every campaign, in pages — valid prizes can never hide expired ones. Never a 'reserved' prize (open order) or
 * a 'consumed' one. Every commit carries the spin's read version: an order reserving it meanwhile, or a second /
 * overlapping cron run, makes the commit fail and nothing is returned twice.
 */
export async function expireUnclaimedPrizes(fs, cfg, { now = Date.now(), pageSize = 50, maxPages = 4 } = {}) {
  if (cfg.wheelMode === 'off') return { enabled: false, expired: 0 };
  const nowTs = new Date(now).toISOString();
  let expired = 0;
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const docs = await fs.runQuery({
      from: [{ collectionId: 'wheelSpins' }],
      // <= now: at EXACTLY the end time the prize has ended (the same rule as an order: expiresAt <= now = expired)
      where: { fieldFilter: { field: { fieldPath: 'issuedExpiry' }, op: 'LESS_THAN_OR_EQUAL', value: { timestampValue: nowTs } } },
      orderBy: [{ field: { fieldPath: 'issuedExpiry' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      ...(cursor ? { startAt: { values: cursor, before: false } } : {}),
      limit: pageSize,
    });
    for (const d of docs) {
      const sp = decodeFields(d.fields);
      // a second-order prize whose 5 days to CREATE the first order are over: an order created in time (cancelled
      // ones never count) keeps it, linked to that order until its delivery — nothing returned, never expired twice
      if (sp.status === 'waiting' && !sp.firstOrderId && sp.firstOrderBy instanceof Date && sp.uid) {
        const first = await firstOrderWithin(fs, sp.uid, sp.firstOrderBy.getTime());
        const until = sp.waitingUntil instanceof Date ? sp.waitingUntil.getTime() : 0;
        // ...and only while that order can still be delivered within 168 h of its creation (else: expired below)
        const link = first && until > now ? linkFirstOrder(cfg, first, until, now) : null;
        if (link) {
          await fs.commit([{ update: { name: d.name, fields: encodeFields(link) }, updateMask: { fieldPaths: Object.keys(link) }, currentDocument: { updateTime: d.updateTime } }]);
          continue;
        }
      }
      // 'waiting' past its deadline (no first order in 5 days / the campaign ended) or 'issued' past its window
      const valid = (sp.status === 'issued' || sp.status === 'waiting') && sp.prizeId && sp.prizeId !== NO_PRIZE;
      const r = await fs.commit([
        // not 'issued' any more (should not happen): only the stale marker is cleared, nothing is returned
        // only the PRIZE document changes (and its pool unit): the first order itself is never touched
        { update: { name: d.name, fields: encodeFields(valid ? { status: 'expired', expiredAt: new Date(now), issuedExpiry: null, ...(sp.status === 'waiting' ? { expiredReason: sp.firstOrderId ? 'first_order_not_delivered' : 'no_first_order' } : {}) } : { issuedExpiry: null }) }, updateMask: { fieldPaths: valid ? ['status', 'expiredAt', 'issuedExpiry', ...(sp.status === 'waiting' ? ['expiredReason'] : [])] : ['issuedExpiry'] }, currentDocument: { updateTime: d.updateTime } },
        ...(valid ? [{ update: { name: fs.name(`wheelPool/${sp.campaignId}_${sp.prizeId}`), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'remaining', increment: { integerValue: '1' } }], currentDocument: { exists: true } }] : []),
      ]);
      if (r.ok && valid) expired += 1;
    }
    if (docs.length < pageSize) break;
    const last = docs[docs.length - 1];
    cursor = [last.fields.issuedExpiry, { referenceValue: last.name }];
  }
  if (expired) log('wheel.expired', { count: expired });
  return { enabled: true, expired };
}
