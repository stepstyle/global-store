// Store Product -> CatalogItem: only facts present in the store data. Missing data stays null/'unknown', never guessed.
import { normalizeArabic, tokenize, lightStem } from './arabicText.ts';
import { CHILD_CATEGORIES, CHILD_SUBCATEGORIES, CHILD_WORDS } from './lexicon.ts';
import type { CatalogItem } from './types.ts';

/** Store subCategory slugs that carry an age range (constants.ts SUBCATEGORIES.Games). */
const AGE_SUBCATEGORIES: Readonly<Record<string, [number, number]>> = Object.freeze({
  '0-9m': [0, 0.75],
  '1-2y': [1, 2],
  '2-3y': [2, 3],
});

const UNIT_Y = '(?:سنه|سنوات|سنين|عام|اعوام|years?|yrs?|y)';
const OPEN_MAX = 99;

/** Age range written in a store text field. Bare "6+" is accepted in tags only (names/descriptions need a unit). */
export function ageFromText(normalized: string, allowBarePlus: boolean): [number, number] | null {
  const t = normalized;
  let m = new RegExp(`(?:من|from)?\\s*(\\d{1,2})\\s*(?:-|الى|الي|ل|to)\\s*(\\d{1,2})\\s*${UNIT_Y}(?=\\s|$)`, 'u').exec(t);
  if (m) { const a = Number(m[1]); const b = Number(m[2]); return a <= b ? [a, b] : [b, a]; }
  m = new RegExp(`(\\d{1,2})\\s*${UNIT_Y}\\s*(?:فما فوق|وما فوق|فاكثر|فاكبر|and up|\\+)`, 'u').exec(t);
  if (m) return [Number(m[1]), OPEN_MAX];
  m = new RegExp(`(?:\\+\\s*(\\d{1,2})|(\\d{1,2})\\s*\\+)\\s*${UNIT_Y}(?=\\s|$)`, 'u').exec(t);
  if (m) return [Number(m[1] ?? m[2]), OPEN_MAX];
  m = /(?:^|\s)(?:لعمر|للعمر|عمر|لسن|سن|ages?)\s*(\d{1,2})(?=\s|$)/u.exec(t);
  if (m) return [Number(m[1]), Number(m[1])];
  if (allowBarePlus) {
    m = /(?:^|\s)(?:\+\s*(\d{1,2})|(\d{1,2})\s*\+)(?=\s|$)/u.exec(t);
    if (m) return [Number(m[1] ?? m[2]), OPEN_MAX];
  }
  return null;
}

const EDU_WORDS = ['تعليمي', 'تعليميه', 'تعليم', 'educational', 'learning', 'montessori', 'مونتيسوري'].map(normalizeArabic);

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function words(...texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const w of tokenize(normalizeArabic(t))) {
    out.add(w);
    out.add(lightStem(w));
  }
  return out;
}

/**
 * Builds the discovery view of one store product. `p` is the store Product shape (src/types.ts) but read defensively:
 * documents loaded from Firestore may miss fields. Returns null for records without an id or a name.
 */
export function toCatalogItem(p: unknown): CatalogItem | null {
  if (!p || typeof p !== 'object') return null;
  const r = p as Record<string, unknown>;
  const id = str(r.id).trim();
  const name = str(r.name).trim();
  if (!id || !name) return null;
  const nameEn = str(r.nameEn);
  const tags = strList(r.tags);
  const description = `${str(r.description)} ${str(r.details)}`;
  const subCategory = str(r.subCategory) || str(r.subcategory) || null;

  // price + stock (variants first: the store sells the variant)
  const variants = Array.isArray(r.variants) ? (r.variants as Record<string, unknown>[]).filter((v) => v && typeof v === 'object') : [];
  let price: number | null = null;
  let stock: CatalogItem['stock'] = 'unknown';
  let originalPrice: number | null = num(r.originalPrice);
  if (variants.length) {
    const priced = variants.filter((v) => (num(v.price) ?? 0) > 0);
    const inStock = priced.filter((v) => (num(v.stock) ?? 0) > 0);
    const allKnown = variants.every((v) => num(v.stock) !== null);
    stock = inStock.length ? 'in' : allKnown ? 'out' : 'unknown';
    const pool = inStock.length ? inStock : priced;
    if (pool.length) {
      const cheapest = pool.reduce((a, b) => ((num(a.price) as number) <= (num(b.price) as number) ? a : b));
      price = num(cheapest.price);
      originalPrice = num(cheapest.originalPrice) ?? originalPrice;
    }
  } else {
    const s = num(r.stock);
    stock = s === null ? 'unknown' : s > 0 ? 'in' : 'out';
  }
  if (price === null) {
    const p0 = num(r.price);
    price = p0 !== null && p0 > 0 ? p0 : null;
  }
  if (originalPrice !== null && (price === null || originalPrice <= price)) originalPrice = null;

  // age: store taxonomy first, then text fields (tags may use bare "6+")
  let age: CatalogItem['age'] = null;
  if (subCategory && AGE_SUBCATEGORIES[subCategory]) {
    const [a, b] = AGE_SUBCATEGORIES[subCategory];
    age = { min: a, max: b, source: 'subCategory' };
  } else {
    const fromTags = ageFromText(normalizeArabic(tags.join(' ')), true);
    const fromName = fromTags ? null : ageFromText(normalizeArabic(`${name} ${nameEn}`), false);
    const fromDesc = fromTags || fromName ? null : ageFromText(normalizeArabic(description), false);
    const found = fromTags ?? fromName ?? fromDesc;
    if (found) age = { min: found[0], max: found[1], source: fromTags ? 'tags' : fromName ? 'name' : 'description' };
  }

  // educational evidence
  const category = str(r.category);
  const categories = [...new Set([category, ...strList(r.categories)].filter(Boolean))];
  const hasEdu = (t: string) => { const w = tokenize(normalizeArabic(t)); return w.some((x) => EDU_WORDS.includes(x) || EDU_WORDS.includes(x.replace(/^ال/, ''))); };
  let educational: CatalogItem['educational'] = null;
  if (categories.includes('EducationalCards') || categories.includes('Courses')) educational = { source: 'category' };
  else if (subCategory === 'edu') educational = { source: 'subCategory' };
  else if (hasEdu(tags.join(' '))) educational = { source: 'tags' };
  else if (hasEdu(`${name} ${nameEn}`)) educational = { source: 'name' };
  else if (hasEdu(description)) educational = { source: 'description' };

  // made for children? evidence from the store data only (never from a guess)
  const hasChildWord = (t: string) => tokenize(normalizeArabic(t)).some((w) => CHILD_WORDS.includes(w) || CHILD_WORDS.includes(w.replace(/^(ال|لل|ل)/, '')));
  let forChildren: CatalogItem['forChildren'] = null;
  if (categories.some((c) => (CHILD_CATEGORIES as readonly string[]).includes(c))) forChildren = { source: 'category' };
  else if (subCategory && CHILD_SUBCATEGORIES.includes(subCategory)) forChildren = { source: 'subCategory' };
  else if (age && age.max < 13) forChildren = { source: 'age' };
  else if (hasChildWord(tags.join(' '))) forChildren = { source: 'tags' };
  else if (hasChildWord(`${name} ${nameEn}`)) forChildren = { source: 'name' };
  else if (hasChildWord(description)) forChildren = { source: 'description' };

  const ratingCount = num(r.ratingCount) ?? num(r.reviews) ?? 0;
  const ratingAvg = ratingCount > 0 ? num(r.ratingAvg) ?? num(r.rating) : null;

  return {
    id,
    name,
    nameEn,
    image: str(r.image),
    category,
    categories,
    subCategory,
    price,
    originalPrice,
    stock,
    age,
    educational,
    forChildren,
    ratingAvg,
    ratingCount,
    nameWords: words(name, nameEn, tags.join(' ')),
    textWords: words(name, nameEn, tags.join(' '), str(r.brand), description),
  };
}

/** Converts a product list; records that cannot be used (no id / name) are skipped and counted. */
export function buildCatalog(products: readonly unknown[]): { items: CatalogItem[]; skipped: number } {
  const items: CatalogItem[] = [];
  let skipped = 0;
  for (const p of Array.isArray(products) ? products : []) {
    const it = toCatalogItem(p);
    if (it) items.push(it);
    else skipped++;
  }
  return { items, skipped };
}
