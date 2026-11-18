// Product creation that can NEVER overwrite an existing product (CSV import + every "add product" path).
// Pure planning + an injectable Firestore transaction — unit-tested (tests/unit/csvImport.test.mjs) and against the
// Firestore emulator (workers/order-worker/test/product-editor.test.mjs).
//
// Owner's decision: a CSV row whose id already exists is REFUSED (with a clear message) — the CSV import never
// changes an existing product's stock, variants (colours / sizes), price, ratings or anything else. Rows for new ids
// are created. A file that names the same id twice keeps only its first row.

export type CsvRowError =
  | 'MISSING_ID' | 'MISSING_NAME' | 'MISSING_PRICE' | 'INVALID_PRICE' | 'MISSING_STOCK' | 'INVALID_STOCK'
  | 'MISSING_CATEGORY' | 'UNKNOWN_CATEGORY' | 'MISSING_IMAGE' | 'INVALID_IMAGE';
export type CsvRejectReason = 'EXISTS' | 'DUPLICATE_IN_FILE' | CsvRowError;
export type CsvRejection = { row: number; id: string; reason: CsvRejectReason; details?: CsvRowError[] };
export type CsvCandidate<T> = { row: number; product: T };

/** What a complete CSV row gives the product (no defaults are invented for anything missing). */
export type CsvRowFields = {
  id: string; name: string; nameEn: string; price: number; originalPrice?: number; stock: number;
  category: string; subCategory?: string; description: string; image: string; images: string[];
};

const ERROR_AR: Record<CsvRejectReason, string> = {
  EXISTS: 'المعرّف موجود مسبقًا',
  DUPLICATE_IN_FILE: 'المعرّف مكرر في الملف',
  MISSING_ID: 'لا يوجد معرّف (id)',
  MISSING_NAME: 'لا يوجد اسم',
  MISSING_PRICE: 'لا يوجد سعر',
  INVALID_PRICE: 'السعر غير صالح',
  MISSING_STOCK: 'لا توجد كمية',
  INVALID_STOCK: 'الكمية غير صالحة',
  MISSING_CATEGORY: 'لا يوجد تصنيف',
  UNKNOWN_CATEGORY: 'تصنيف غير معروف في المتجر',
  MISSING_IMAGE: 'لا توجد صورة',
  INVALID_IMAGE: 'رابط صورة غير صالح (https فقط، بلا صور تجريبية)',
};

const cell = (row: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) { const v = row[k]; if (v != null && String(v).trim() !== '') return String(v).trim(); }
  return '';
};
const DEMO_IMAGE = /(picsum\.photos|placeholder|placehold|dummyimage|via\.placeholder|unsplash\.it)/i;
const okImage = (u: string) => { try { const x = new URL(u); return x.protocol === 'https:' && !DEMO_IMAGE.test(u); } catch { return false; } };

/**
 * Checks one CSV row. A row is imported ONLY when it has an id, a name, a valid price (> 0), a stock quantity
 * (integer >= 0), a category the store uses and at least one real https image. Nothing missing is filled with a
 * placeholder (no demo image, no price 0, no default category, no "No description").
 */
export function checkCsvRow(row: Record<string, unknown>, allowedCategories: Iterable<string>): { ok: true; fields: CsvRowFields } | { ok: false; id: string; errors: CsvRowError[] } {
  const errors: CsvRowError[] = [];
  const id = cell(row, 'id', 'ID');
  const name = cell(row, 'nameAr', 'nameAR', 'name', 'Name', 'productName', 'nameEn', 'nameEN');
  const nameEn = cell(row, 'nameEn', 'nameEN') || name;
  const priceS = cell(row, 'price', 'Price');
  const stockS = cell(row, 'stock', 'Stock');
  const category = cell(row, 'category', 'Category');
  if (!id) errors.push('MISSING_ID');
  if (!name) errors.push('MISSING_NAME');
  const price = Number(priceS);
  if (!priceS) errors.push('MISSING_PRICE');
  else if (!/^\d+(\.\d{1,3})?$/.test(priceS) || !(price > 0)) errors.push('INVALID_PRICE');
  const stock = Number(stockS);
  if (!stockS) errors.push('MISSING_STOCK');
  else if (!/^\d+$/.test(stockS)) errors.push('INVALID_STOCK');
  const allowed = new Set([...allowedCategories].map(String));
  if (!category) errors.push('MISSING_CATEGORY');
  else if (!allowed.has(category)) errors.push('UNKNOWN_CATEGORY');
  const images: string[] = [];
  const first = cell(row, 'image', 'Image');
  if (first) images.push(first);
  for (const u of cell(row, 'images', 'Images').split('|').map((s) => s.trim()).filter(Boolean)) images.push(u);
  for (let i = 2; i <= 10; i++) { const u = cell(row, `image${i}`, `Image${i}`); if (u) images.push(u); }
  const uniq = [...new Set(images)];
  if (!uniq.length) errors.push('MISSING_IMAGE');
  else if (!uniq.every(okImage)) errors.push('INVALID_IMAGE');
  if (errors.length) return { ok: false, id, errors };
  const origS = cell(row, 'originalPrice');
  const orig = Number(origS);
  const sub = cell(row, 'subCategory', 'subcategory', 'sub');
  return {
    ok: true,
    fields: {
      id, name, nameEn, price, stock, category, description: cell(row, 'description', 'Description'), image: uniq[0], images: uniq,
      ...(origS && orig > price ? { originalPrice: orig } : {}),
      ...(sub ? { subCategory: sub } : {}),
    },
  };
}

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
    const why = (r: CsvRejection) => (r.details?.length ? r.details : [r.reason]).map((x) => ERROR_AR[x]).join('، ');
    parts.push(`رُفض ${rejected.length} صف — لا يُعدَّل أي منتج موجود عبر CSV، ولا يُضاف منتج ناقص الاسم أو السعر أو الكمية أو التصنيف أو الصورة:`);
    for (const r of rejected.slice(0, max)) parts.push(`• السطر ${r.row}${r.id ? ` (${r.id})` : ''}: ${why(r)}`);
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
