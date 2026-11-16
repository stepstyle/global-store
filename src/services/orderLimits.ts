// Input limits of the order Worker v2 (workers/order-worker/src/validate.js), mirrored for the checkout form so a
// customer can never send something the Worker refuses because of a length/format difference. The Worker's limits
// are the security boundary and are NOT changed here; tests/unit/orderLimits.test.mjs checks both sides agree.
//
// Two kinds of fields:
//  - typed by the customer (name, address, note, e-mail, CliQ reference, cart size): CHECKED, with an Arabic message,
//    and the order is not sent (nothing is lost: cart and pending attempt stay as they are);
//  - coming from store data (product name, image, variant fields): the customer cannot fix them, they are display-only
//    in the order (never part of the order identity), so they are TRIMMED to the Worker's limits.

export const ORDER_LIMITS = {
  nameMin: 1,
  nameMax: 120,
  streetMax: 500,
  noteMax: 600,
  cliqRefMax: 100,
  emailMax: 254,
  linesMax: 30,
  qtyMin: 1,
  qtyMax: 99,
  moneyMax: 100_000,
  itemNameMax: 300,
  itemImageMax: 2000,
  variantLabelMax: 200,
  variantTypeMax: 20,
  colorCodeMax: 30,
} as const;

/** = Worker EMAIL_RE */
export const ORDER_EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export type LimitField = 'fullName' | 'streetAddress' | 'email' | 'note' | 'cliqRef' | 'cart' | 'quantity' | 'total';
export type LimitProblem = { field: LimitField; ar: string; en: string };

export type LimitInput = {
  fullName: string;
  street: string;
  email: string;
  note: string;
  paymentMethod: string;
  cliqRef: string;
  quantities: number[];
  total: number;
};

/** Problems the CUSTOMER can fix, in form order. Empty array = the Worker will accept these fields. */
export function checkOrderLimits(i: LimitInput): LimitProblem[] {
  const L = ORDER_LIMITS;
  const out: LimitProblem[] = [];
  if (i.fullName.length > L.nameMax) {
    out.push({ field: 'fullName', ar: `الاسم طويل جدًا: الحد الأقصى ${L.nameMax} حرفًا.`, en: `Name is too long (max ${L.nameMax} characters).` });
  }
  if (i.street.length > L.streetMax) {
    out.push({ field: 'streetAddress', ar: `العنوان التفصيلي طويل جدًا: الحد الأقصى ${L.streetMax} حرف.`, en: `Address is too long (max ${L.streetMax} characters).` });
  }
  if (i.email && (i.email.length > L.emailMax || !ORDER_EMAIL_RE.test(i.email))) {
    out.push({ field: 'email', ar: 'البريد الإلكتروني غير صحيح. مثال: name@example.com', en: 'Invalid e-mail address. Example: name@example.com' });
  }
  if (i.note.length > L.noteMax) {
    out.push({ field: 'note', ar: `الملاحظات طويلة جدًا (${i.note.length} حرفًا): الحد الأقصى ${L.noteMax} حرف. اختصرها ثم أعد المحاولة.`, en: `The note is too long (${i.note.length}); max ${L.noteMax} characters.` });
  }
  if (i.paymentMethod === 'cliq') {
    if (!i.cliqRef) out.push({ field: 'cliqRef', ar: 'يرجى إدخال الرقم المرجعي لحوالة CliQ.', en: 'Please enter the CliQ reference.' });
    else if (i.cliqRef.length > L.cliqRefMax) out.push({ field: 'cliqRef', ar: `الرقم المرجعي لحوالة CliQ طويل جدًا: الحد الأقصى ${L.cliqRefMax} حرف.`, en: `CliQ reference is too long (max ${L.cliqRefMax}).` });
  }
  if (i.quantities.length > L.linesMax) {
    out.push({ field: 'cart', ar: `الطلب الواحد يتسع لـ ${L.linesMax} منتجًا مختلفًا كحد أقصى (في سلتك ${i.quantities.length}). قسّم الطلب إلى طلبين.`, en: `One order can hold at most ${L.linesMax} different products.` });
  }
  if (i.quantities.some((q) => !Number.isInteger(q) || q < L.qtyMin || q > L.qtyMax)) {
    out.push({ field: 'quantity', ar: `الكمية لكل منتج بين ${L.qtyMin} و${L.qtyMax}.`, en: `Quantity per product must be ${L.qtyMin}–${L.qtyMax}.` });
  }
  if (!Number.isFinite(i.total) || i.total < 0 || i.total > L.moneyMax) {
    out.push({ field: 'total', ar: 'قيمة الطلب خارج الحد المسموح للطلب الإلكتروني. تواصل معنا عبر واتساب لإتمامه.', en: 'Order total is outside the online limit. Please contact us on WhatsApp.' });
  }
  return out;
}

const cut = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const imageOrEmpty = (v: unknown): string => (typeof v === 'string' && v.length <= ORDER_LIMITS.itemImageMax ? v : '');

/** Store-data fields of one order line, trimmed to the Worker's limits (identity fields untouched). */
export function sanitizeOrderLine<T extends Record<string, unknown>>(line: T): T {
  const L = ORDER_LIMITS;
  const out: Record<string, unknown> = { ...line };
  if (typeof line.name === 'string') out.name = line.name.slice(0, L.itemNameMax);
  if ('image' in line) out.image = imageOrEmpty(line.image);
  const sv = line.selectedVariant as Record<string, unknown> | null | undefined;
  if (sv && typeof sv === 'object') {
    const v: Record<string, unknown> = { ...sv };
    for (const [k, max] of [['label', L.variantLabelMax], ['type', L.variantTypeMax], ['colorCode', L.colorCodeMax], ['colorCode2', L.colorCodeMax]] as const) {
      if (k in v) v[k] = cut(v[k], max) ?? v[k];
    }
    if ('image' in v) v.image = imageOrEmpty(v.image);
    out.selectedVariant = v;
  }
  return out as T;
}
