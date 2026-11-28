// Verified-purchase reviews — the browser side. Every review is written by the order Worker (workers/order-worker/
// src/reviews.js) after it checked a DELIVERED order that contains the product; the Firestore rules refuse a review
// written by a browser. Pure and injectable (fetch, ID token): unit-tested with node --test
// (tests/unit/verifiedReviews.test.mjs). No imports.
//
// The private link the admin sends:  https://dairsharaf.com/#/review/<orderId>/<token>
// The token is moved out of the address bar as soon as the app starts (stashReviewToken, before any analytics can
// read the URL) and kept for this tab only (sessionStorage); the address bar then shows #/review/<orderId>.

export const REVIEW_ORDER_ID_RE = /^ORD-[A-Z0-9]{4,16}-[A-Z0-9]{4,16}$/;
export const REVIEW_TOKEN_RE = /^[0-9A-HJKMNP-TV-Z]{24}$/;
export const COMMENT_MAX = 1000;
export const NAME_MIN = 2;
export const NAME_MAX = 40;

export type ReviewItem = { productId: string; name: string; image: string; variants: string[]; available: boolean; reviewed: boolean; rating?: number | null };
export type ReviewOrderState = { ok: true; orderId: string; via: 'link' | 'account'; date: string; suggestedName: string; items: ReviewItem[] };
export type ReviewError = { ok: false; code: string; status: number };
export type Deps = { fetch: typeof fetch; base: string; idToken?: () => Promise<string | null> };

/** what the customer typed, checked like the Worker does (the Worker checks again: this only saves a round trip) */
export function checkReviewInput(input: { rating: unknown; comment: unknown; name: unknown }): { ok: true } | { ok: false; field: 'rating' | 'comment' | 'name' } {
  const r = input.rating;
  if (!(typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= 5)) return { ok: false, field: 'rating' };
  const c = typeof input.comment === 'string' ? input.comment.trim() : '';
  if (c.length > COMMENT_MAX) return { ok: false, field: 'comment' };
  const n = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  if (n.length < NAME_MIN || n.length > NAME_MAX) return { ok: false, field: 'name' };
  return { ok: true };
}

async function post<T>(deps: Deps, path: string, body: unknown, { auth = false }: { auth?: boolean } = {}): Promise<T | ReviewError> {
  if (!deps.base) return { ok: false, code: 'NOT_CONFIGURED', status: 0 };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) {
    const t = deps.idToken ? await deps.idToken().catch(() => null) : null;
    if (t) headers.authorization = `Bearer ${t}`;
  }
  let res: Response;
  try {
    res = await deps.fetch(`${deps.base.replace(/\/+$/, '')}${path}`, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store' });
  } catch {
    return { ok: false, code: 'NETWORK', status: 0 };
  }
  const data = await res.json().catch(() => null);
  if (res.ok && data && data.ok === true) return data as T;
  return { ok: false, code: String(data?.code || 'UNAVAILABLE'), status: res.status };
}

/** with the private link (token) — or, without a token, as the signed-in owner of the order */
export const loadReviewOrder = (deps: Deps, orderId: string, token: string | null) =>
  post<ReviewOrderState>(deps, '/reviews/state', token ? { orderId, token } : { orderId }, { auth: !token });

export const submitReview = (deps: Deps, a: { orderId: string; token: string | null; productId: string; rating: number; comment: string; name: string }) =>
  post<{ ok: true; reviewId: string; ratingAvg?: number; ratingCount?: number }>(deps, '/reviews/submit',
    { orderId: a.orderId, ...(a.token ? { token: a.token } : {}), productId: a.productId, rating: a.rating, comment: a.comment.trim(), name: a.name.trim().replace(/\s+/g, ' ') },
    { auth: !a.token });

/** the signed-in customer's delivered, not yet reviewed orders of this product */
export const eligibleOrders = (deps: Deps, productId: string) =>
  post<{ ok: true; orders: Array<{ orderId: string; date: string; variants: string[] }> }>(deps, '/reviews/eligible', { productId }, { auth: true });

/** admin: a private link for a delivered order (rotate = replace the link already sent) */
export const createReviewLink = (deps: Deps, orderId: string, rotate = false) =>
  post<{ ok: true; url: string; expiresAt: string; replaced: boolean; items: number; reviewed: number }>(deps, `/admin/orders/${encodeURIComponent(orderId)}/review-link`, { rotate }, { auth: true });

export type ModerationAction = 'flag' | 'unflag' | 'hide' | 'publish';
export type ModerationReason = 'abusive' | 'personal_data' | 'spam' | 'off_topic' | 'other';
export const MODERATION_REASONS_AR: Record<ModerationReason, string> = {
  abusive: 'ألفاظ مسيئة أو تحريض',
  personal_data: 'بيانات شخصية (هاتف، عنوان، اسم كامل)',
  spam: 'إعلان أو رسائل مزعجة',
  off_topic: 'لا علاقة له بالمنتج',
  other: 'سبب آخر (اكتب ملاحظة)',
};
/** admin: flag / unflag / hide (reason required) / publish again. There is no "negative opinion" reason. */
export const moderateReview = (deps: Deps, reviewId: string, action: ModerationAction, reason?: ModerationReason, note?: string) =>
  post<{ ok: true; status: 'published' | 'hidden'; flagged: boolean }>(deps, `/admin/reviews/${encodeURIComponent(reviewId)}/moderate`, { action, ...(reason ? { reason } : {}), ...(note ? { note } : {}) }, { auth: true });

/** Arabic message for a Worker answer the customer can see */
export function reviewErrorAr(code: string): string {
  switch (code) {
    case 'NOT_FOUND': return 'هذا الرابط غير صالح. تأكد من فتح الرابط كما وصلك، أو اطلب رابطًا جديدًا من المكتبة.';
    case 'LINK_EXPIRED': return 'انتهت صلاحية رابط التقييم. اطلب رابطًا جديدًا من المكتبة.';
    case 'NOT_DELIVERED': return 'يمكن التقييم بعد تأكيد تسليم الطلب.';
    case 'ALREADY_REVIEWED': return 'تم تقييم هذا المنتج من هذا الطلب مسبقًا. شكرًا لك!';
    case 'PRODUCT_NOT_IN_ORDER': return 'هذا المنتج ليس ضمن هذا الطلب.';
    case 'PRODUCT_UNAVAILABLE': return 'هذا المنتج لم يعد معروضًا في المتجر.';
    case 'INVALID_RATING': return 'اختر من نجمة إلى خمس نجوم.';
    case 'INVALID_COMMENT': return `التعليق طويل جدًا (الحد ${COMMENT_MAX} حرف).`;
    case 'INVALID_NAME': return `اكتب الاسم الذي يظهر مع تقييمك (${NAME_MIN}–${NAME_MAX} حرفًا).`;
    case 'RATE_LIMITED': return 'محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة.';
    case 'NETWORK': return 'تعذّر الاتصال. تحقق من الإنترنت وأعد المحاولة.';
    default: return 'تعذّر حفظ التقييم الآن. أعد المحاولة بعد قليل.';
  }
}

/** a review shown to visitors: published AND written by the Worker for a verified purchase */
export const isPublicVerified = (r: { status?: unknown; verifiedPurchase?: unknown }) => (r?.status ?? 'published') === 'published' && r?.verifiedPurchase === true;

/** a customer phone as wa.me wants it (digits, country code): "0791234567" / "+962 79…" / "00962…" -> "962791234567"; null if unsure */
export function waPhone(phone: unknown): string | null {
  let d = String(phone ?? '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (/^07\d{8}$/.test(d)) d = `962${d.slice(1)}`;
  d = d.replace(/\D/g, '');
  return /^\d{10,15}$/.test(d) ? d : null;
}

/** the message the admin can send by hand (WhatsApp / SMS) — never sent automatically */
export function reviewInviteMessage(url: string, firstName = ''): string {
  const hi = firstName ? `مرحباً ${firstName} 👋` : 'مرحباً 👋';
  return [hi, 'شكرًا لطلبك من مكتبة دير شرف. نتمنى أن تكون مشترياتك قد أعجبتك.', 'يسعدنا تقييمك للمنتجات (من نجمة إلى خمس نجوم، والتعليق اختياري) من هذا الرابط الخاص بطلبك:', url].join('\n');
}
