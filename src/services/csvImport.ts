// Product creation that can NEVER overwrite an existing product (CSV import + every "add product" path).
// Pure planning + an injectable Firestore transaction — unit-tested (tests/unit/csvImport.test.mjs) and against the
// Firestore emulator (workers/order-worker/test/product-editor.test.mjs).
//
// Owner's decision: a CSV row whose id already exists is REFUSED (with a clear message) — the CSV import never
// changes an existing product's stock, variants (colours / sizes), price, ratings or anything else. Rows for new ids
// are created. A file that names the same id twice keeps only its first row.

export type CsvRejectReason = 'EXISTS' | 'DUPLICATE_IN_FILE';
export type CsvRejection = { row: number; id: string; reason: CsvRejectReason };
export type CsvCandidate<T> = { row: number; product: T };

/** First pass against the ids the dashboard already knows (the transaction below re-checks against Firestore). */
export function planCsvImport<T extends { id: string }>(candidates: CsvCandidate<T>[], existingIds: Iterable<string>): { accepted: CsvCandidate<T>[]; rejected: CsvRejection[] } {
  const existing = new Set([...existingIds].map(String));
  const seen = new Set<string>();
  const accepted: CsvCandidate<T>[] = [];
  const rejected: CsvRejection[] = [];
  for (const c of candidates) {
    const id = String(c.product.id);
    if (existing.has(id)) rejected.push({ row: c.row, id, reason: 'EXISTS' });
    else if (seen.has(id)) rejected.push({ row: c.row, id, reason: 'DUPLICATE_IN_FILE' });
    else {
      seen.add(id);
      accepted.push(c);
    }
  }
  return { accepted, rejected };
}

/** Arabic summary for the admin (bounded list of rejected rows). */
export function csvImportMessageAr(added: number, rejected: CsvRejection[], max = 10): string {
  const parts = [`تمت إضافة ${added} منتج جديد.`];
  if (rejected.length) {
    const why = (r: CsvRejection) => (r.reason === 'EXISTS' ? 'المعرّف موجود مسبقًا' : 'المعرّف مكرر في الملف');
    parts.push(`رُفض ${rejected.length} صف — لا يُعدَّل أي منتج موجود عبر CSV (لا المخزون ولا الألوان/المقاسات ولا التقييمات). عدّل المنتجات الموجودة من صفحة المنتج:`);
    for (const r of rejected.slice(0, max)) parts.push(`• السطر ${r.row} (${r.id}): ${why(r)}`);
    if (rejected.length > max) parts.push(`… و${rejected.length - max} صفوف أخرى`);
  }
  return parts.join('\n');
}

export class ProductExistsError extends Error {
  ids: string[];
  constructor(ids: string[]) {
    super(`يوجد منتج بنفس المعرّف (${ids.slice(0, 5).join('، ')}) — لم يُعدَّل المنتج الموجود. استخدم صفحة تعديل المنتج.`);
    this.name = 'ProductExistsError';
    this.ids = ids;
  }
}

export type FirestoreCreateApi = {
  runTransaction: (db: any, fn: (tx: any) => Promise<unknown>) => Promise<unknown>;
  doc: (db: any, collection: string, id: string) => any;
};

/** Firestore allows at most 500 writes per transaction; stay well below */
export const CREATE_CHUNK = 200;

/**
 * Create the products whose id does NOT exist in Firestore — checked and written in the same transaction (a product
 * created meanwhile by someone else is never overwritten). Returns which ids were added and which already existed.
 */
export async function createProductsIfAbsent<T extends { id: string }>(api: FirestoreCreateApi, db: any, products: T[], clean: (p: T) => any = (p) => p): Promise<{ added: string[]; existing: string[] }> {
  const added: string[] = [];
  const existing: string[] = [];
  for (let i = 0; i < products.length; i += CREATE_CHUNK) {
    const chunk = products.slice(i, i + CREATE_CHUNK);
    const refs = chunk.map((p) => api.doc(db, 'products', String(p.id)));
    let a: string[] = [];
    let e: string[] = [];
    await api.runTransaction(db, async (tx) => {
      a = [];
      e = [];
      const snaps = [];
      for (const r of refs) snaps.push(await tx.get(r)); // all reads before any write
      chunk.forEach((p, k) => {
        if (snaps[k].exists()) e.push(String(p.id));
        else {
          tx.set(refs[k], clean(p));
          a.push(String(p.id));
        }
      });
    });
    added.push(...a);
    existing.push(...e);
  }
  return { added, existing };
}
