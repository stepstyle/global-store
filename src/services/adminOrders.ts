// Admin dashboard -> order Worker: status changes of orders whose stock moves on DELIVERY
// (Worker STOCK_POLICY=on_delivery, POST /admin/orders/{id}/status). Pure and injectable (fetch, ID token) — unit-tested
// with node --test (tests/unit/adminOrders.test.mjs). No imports.
//
// Such an order carries `inventory: { policy: 'on_delivery', state }` (written by the Worker only). Its status is NEVER
// written from the browser (the Firestore rules refuse it): the Worker changes the status and the stock in ONE atomic
// commit, so "delivered" deducts exactly once, "cancelled" before delivery only releases the reservation, and a
// return after delivery puts the stock back once — only with an explicit confirmation.
// Every other order (old site / Worker v1) keeps the old direct status update, without any stock effect.

export type InventoryState = 'reserved' | 'none' | 'released' | 'deducted' | 'restocked';
export type AdminStatus = 'new' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

type AnyOrder = { status?: unknown; inventory?: { policy?: unknown; state?: unknown } | null } | null | undefined;

/** true = the order's status (and stock) is managed by the Worker */
// on_delivery (stock deducted on delivery) or on_acceptance (deducted when accepted from Telegram / automatically):
// either way every status change goes through the Worker (stock + prize wheel in one commit)
export const isWorkerManaged = (o: AnyOrder): boolean => o?.inventory?.policy === 'on_delivery' || o?.inventory?.policy === 'on_acceptance';
export const inventoryState = (o: AnyOrder): InventoryState | null => {
  const s = isWorkerManaged(o) ? String(o?.inventory?.state || '') : '';
  return (['reserved', 'none', 'released', 'deducted', 'restocked'] as const).find((x) => x === s) ?? null;
};

export const INVENTORY_LABEL_AR: Record<InventoryState, string> = {
  reserved: 'الكمية محجوزة (لم تُخصم بعد)',
  none: 'لا يوجد مخزون متتبَّع لهذا الطلب',
  released: 'أُلغي الحجز (لم يُخصم شيء)',
  deducted: 'خُصمت الكمية من المخزون عند التسليم',
  restocked: 'أُعيدت الكمية إلى المخزون (إرجاع)',
};

/** the stock line for THIS order (an on_acceptance order is deducted when it is ACCEPTED, not on delivery) */
export const inventoryLabelAr = (o: AnyOrder): string => {
  const st = inventoryState(o);
  if (!st) return '';
  if (o?.inventory?.policy === 'on_acceptance') {
    if (st === 'reserved') return 'الكمية محجوزة — تُخصم عند قبول الطلب (Telegram أو تلقائيًا)';
    if (st === 'deducted') return 'خُصمت الكمية من المخزون عند قبول الطلب';
    if (st === 'restocked') return 'أُعيدت الكمية إلى المخزون (إلغاء بعد القبول أو إرجاع)';
  }
  return INVENTORY_LABEL_AR[st];
};

/** a delivered Worker order can be cancelled only as a RETURN (stock put back after an explicit confirmation) */
export const canCancel = (o: AnyOrder): boolean => {
  const st = String(o?.status || '').toLowerCase();
  if (st === 'cancelled') return false;
  if (st === 'delivered') return isWorkerManaged(o) && inventoryState(o) === 'deducted';
  return true;
};

/** a Worker order still holding a reservation must be cancelled (reservation released) before it can be deleted */
export const deleteBlockedReason = (o: AnyOrder): string | null =>
  isWorkerManaged(o) && inventoryState(o) === 'reserved'
    ? 'هذا الطلب ما زالت كميته محجوزة. ألغِ الطلب أولًا (يُفك الحجز) ثم احذفه.'
    : null;

/** INSUFFICIENT_STOCK: available / requested; ITEMS_MISSING: reason (PRODUCT_NOT_FOUND, VARIANT_NOT_FOUND, …) */
export type DeliveryProblem = { index: number; productId?: string; variantId?: string | null; available?: number; requested?: number; reason?: string };
export type StatusFailure = { ok: false; code: string; messageAr: string; problems?: DeliveryProblem[] };

const REASON_AR: Record<string, string> = {
  PRODUCT_NOT_FOUND: 'المنتج لم يعد موجودًا',
  VARIANT_NOT_FOUND: 'اللون/المقاس لم يعد موجودًا في المنتج',
  DUPLICATE_VARIANT_ID: 'اللون/المقاس مكرر في المنتج (غير محدد)',
  AMBIGUOUS_VARIANT: 'المنتج أصبح بألوان/مقاسات ولم يُحدد أيّها',
  STOCK_UNTRACKED: 'لا يوجد رقم مخزون صالح لهذا المنتج/اللون/المقاس',
};
/** one Arabic line per problem, for the admin toast; `name` = the item name shown in the order */
export function problemLineAr(p: DeliveryProblem, name: string): string {
  if (p.reason) return `• ${name}: ${REASON_AR[p.reason] || p.reason}`;
  return `• ${name}: المتوفر ${p.available ?? 0}، المطلوب ${p.requested ?? 0}`;
}
export type StatusResult = { ok: true; status: AdminStatus; inventory: InventoryState | null; changed: boolean } | StatusFailure;

export type AdminDeps = {
  fetch: (url: string, init: Record<string, unknown>) => Promise<{ status: number; text(): Promise<string> }>;
  /** Firebase ID token of the signed-in admin (forceRefresh after a 401 AUTH_EXPIRED) */
  getIdToken: (forceRefresh: boolean) => Promise<string | null>;
  timeoutMs?: number;
};

const MESSAGES_AR: Record<string, string> = {
  ITEMS_MISSING: 'لا يمكن التسليم: منتج أو لون/مقاس في هذا الطلب لم يعد موجودًا، فلا يمكن خصم كميته. لم تتغير الحالة ولا أي كمية. أعد المنتج/الصنف كما كان، أو ألغِ الطلب.',
  STOCK_UNTRACKED: 'لا يمكن التسليم: منتج أو لون/مقاس في هذا الطلب ليس له رقم مخزون صالح، فلا يمكن خصم كميته. لم تتغير الحالة ولا أي كمية. أدخل رقم المخزون الصحيح من صفحة المنتج ثم أعد المحاولة.',
  INSUFFICIENT_STOCK: 'لا يمكن التسليم: المخزون المسجّل أقل من كمية الطلب (ربما عُدّل يدويًا). صحّح المخزون من صفحة المنتج ثم أعد المحاولة. لم يُخصم شيء.',
  RETURN_CONFIRMATION_REQUIRED: 'إلغاء طلب مُسلَّم يحتاج تأكيد استرجاع المنتجات فعليًا.',
  TRANSITION_NOT_ALLOWED: 'لا يمكن نقل الطلب إلى هذه الحالة من حالته الحالية.',
  LEGACY_ORDER: 'هذا طلب من النظام السابق — يُدار بالطريقة القديمة.',
  APPROVAL_PENDING: 'هذا الطلب بانتظار القبول (من Telegram أو تلقائيًا) — يُخصم المخزون عند القبول. يمكنك إلغاؤه (رفضه) من هنا.',
  NOT_FOUND: 'الطلب غير موجود.',
  NOT_ADMIN: 'حسابك ليس مسؤولًا مفعّلًا — لم يتغير شيء.',
  AUTH_REQUIRED: 'انتهت جلسة الدخول. سجّل الدخول من جديد ثم أعد المحاولة.',
  AUTH_EXPIRED: 'انتهت جلسة الدخول. سجّل الدخول من جديد ثم أعد المحاولة.',
  AUTH_INVALID: 'تعذّر التحقق من تسجيل الدخول. سجّل الدخول من جديد ثم أعد المحاولة.',
  RATE_LIMITED: 'محاولات كثيرة — انتظر قليلًا ثم أعد المحاولة.',
  NO_WORKER: 'خدمة الطلبات غير مهيأة في هذه النسخة — لم يتغير شيء.',
};
const UNKNOWN_AR = 'تعذّر تحديث الحالة — لم يتغير شيء. أعد المحاولة.';
export const messageFor = (code: string): string => MESSAGES_AR[code] || UNKNOWN_AR;

const fail = (code: string, extra: Record<string, unknown> = {}): StatusResult => ({ ok: false, code, messageAr: messageFor(code), ...extra });

/** POST /admin/orders/{id}/status — never reports success unless the Worker confirmed it for THIS order. */
export async function changeStatusViaWorker(
  workerUrl: string, orderId: string, status: AdminStatus, opts: { confirmReturn?: boolean }, deps: AdminDeps,
): Promise<StatusResult> {
  const base = String(workerUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+/.test(base)) return fail('NO_WORKER');
  const send = async (refresh: boolean): Promise<{ status: number; body: Record<string, unknown> | null } | null> => {
    const token = await deps.getIdToken(refresh).catch(() => null);
    if (!token) return { status: 401, body: { code: 'AUTH_REQUIRED' } };
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), deps.timeoutMs ?? 15_000);
    try {
      const r = await deps.fetch(`${base}/admin/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ status, ...(opts.confirmReturn === true ? { confirmReturn: true } : {}) }),
        signal: ctl?.signal,
      });
      const text = await r.text();
      let body: Record<string, unknown> | null = null;
      try {
        const p = JSON.parse(text);
        body = p && typeof p === 'object' && !Array.isArray(p) ? p : null;
      } catch {}
      return { status: r.status, body };
    } catch {
      return null; // network / timeout: unknown outcome — the order list (live snapshot) shows the real state
    } finally {
      clearTimeout(timer);
    }
  };
  let r = await send(false);
  if (r && r.status === 401 && r.body?.code === 'AUTH_EXPIRED') r = await send(true);
  if (!r) return fail('NETWORK');
  const code = typeof r.body?.code === 'string' ? (r.body.code as string) : `HTTP_${r.status}`;
  if (r.status === 200 && r.body?.ok === true && r.body?.orderId === orderId && r.body?.status === status) {
    const inv = typeof r.body.inventory === 'string' ? (r.body.inventory as InventoryState) : null;
    return { ok: true, status, inventory: inv, changed: r.body.result === 'changed' };
  }
  if ((code === 'INSUFFICIENT_STOCK' || code === 'ITEMS_MISSING' || code === 'STOCK_UNTRACKED') && Array.isArray(r.body?.problems)) {
    return fail(code, { problems: r.body!.problems as DeliveryProblem[] });
  }
  return fail(code);
}
