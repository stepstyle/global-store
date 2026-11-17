// Saving a product from the admin editor without overwriting a stock change made meanwhile (e.g. the order Worker
// deducting stock when an order is delivered, or another admin tab). Pure — unit-tested (tests/unit/stockMerge.test.mjs).
//
// The editor saves the WHOLE product (top-level stock + the variants array with their stock). For every stock number:
//   - the admin did NOT change it in the form   -> the CURRENT value in Firestore is kept (a delivery that happened
//                                                  while the form was open is never undone);
//   - the admin changed it, Firestore unchanged -> the admin's value is saved;
//   - the admin changed it AND Firestore changed -> CONFLICT: nothing is saved, the admin reloads and decides again.
// "Changed" is always measured against `baseline` = the product as the form was opened with.
// New variants (unknown to the baseline) are saved as typed; removed variants stay removed (the form decides).

type StockLike = { stock?: unknown; variants?: unknown } | null | undefined;
type VariantLike = { id?: unknown; label?: unknown; stock?: unknown };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const variantsOf = (p: StockLike): VariantLike[] => (Array.isArray(p?.variants) ? (p!.variants as VariantLike[]) : []);
const byId = (list: VariantLike[], id: unknown): VariantLike | undefined =>
  typeof id === 'string' && id ? list.find((v) => v?.id === id) : undefined;

export type StockMergeResult<T> = { ok: true; product: T } | { ok: false; conflicts: string[] };

export function mergeStockForSave<T extends Record<string, unknown>>(form: T, baseline: StockLike, current: StockLike): StockMergeResult<T> {
  if (!current || !baseline) return { ok: true, product: form }; // new product, or nothing to compare with
  const conflicts: string[] = [];
  const out: Record<string, unknown> = { ...form };

  const fs = num(form.stock);
  const bs = num(baseline.stock);
  const cs = num(current.stock);
  if (fs === bs) {
    if (cs !== null) out.stock = cs; // untouched in the form: keep what Firestore has now
  } else if (cs !== bs) {
    conflicts.push('stock');
  }

  const bVars = variantsOf(baseline);
  const cVars = variantsOf(current);
  if (Array.isArray(form.variants)) {
    out.variants = (form.variants as VariantLike[]).map((v) => {
      const b = byId(bVars, v?.id);
      if (!b) return v; // a new variant: as typed
      const c = byId(cVars, v.id);
      const fv = num(v.stock);
      const bv = num(b.stock);
      const cv = c ? num(c.stock) : null;
      if (fv === bv) return c && cv !== null ? { ...v, stock: cv } : v;
      if (c && cv !== bv) conflicts.push(`variant:${String(v.label || v.id)}`);
      return v;
    });
  }
  return conflicts.length ? { ok: false, conflicts } : { ok: true, product: out as T };
}

export const STALE_STOCK_MESSAGE_AR =
  'تغيّر مخزون هذا المنتج منذ فتحت صفحة التعديل (مثلًا: تسليم طلب أو تعديل من نافذة أخرى). لم يُحفظ شيء. أعد فتح المنتج لترى المخزون الحالي ثم عدّل من جديد.';

export class StaleStockError extends Error {
  conflicts: string[];
  constructor(conflicts: string[]) {
    super(STALE_STOCK_MESSAGE_AR);
    this.name = 'StaleStockError';
    this.conflicts = conflicts;
  }
}
