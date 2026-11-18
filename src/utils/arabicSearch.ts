// src/utils/arabicSearch.ts
// Arabic-aware product search used by the shop page and the header suggestions.
// Pure functions, no dependencies — runs in the browser on the products already loaded.

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g; // tashkeel + Quranic marks
const TATWEEL = /ـ/g;
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Folds spelling variants so «ألعاب» = «العاب», «لعبة» = «لعبه», «هدايا» = «هدايا», «٣» = «3».
 * Applied identically to the query and to the product text.
 */
export function normalizeArabic(input: unknown): string {
  let s = String(input ?? '');
  s = s.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
       .replace(/[۰-۹]/g, (d) => String(PERSIAN_INDIC.indexOf(d)));
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Words customers type → the words the catalogue uses. Each group is one meaning; any word of a group finds the
 * others. Kept short and unambiguous on purpose (Jordanian usage + common singular/plural pairs).
 */
const SYNONYM_GROUPS: string[][] = [
  ['شنطه', 'شنط', 'شنطات', 'جنطه', 'حقيبه', 'حقائب', 'حقيبة'],
  ['مقلمه', 'مقالم', 'مقلمات', 'حافظه اقلام', 'حافظة أقلام'],
  ['لعبه', 'العاب', 'لعبة', 'ألعاب'],
  ['دفتر', 'دفاتر', 'كشكول'],
  ['قلم', 'اقلام', 'أقلام'],
  ['محايه', 'محايات', 'ممحاه', 'ممحاة', 'استيكه'],
  ['برايه', 'برايات', 'مبراه', 'مبراة'],
  ['بسكليت', 'بسكليته', 'بسكليتات', 'دراجه', 'دراجة'],
  ['مدرسه', 'مدرسي', 'مدرسيه', 'مدارس'],
  ['سكوتر', 'سكوترات', 'سكوتير'],
  ['فلوماستر', 'ماركر', 'ماركرز', 'تخطيط'],
  ['الوان', 'ألوان', 'تلوين'],
  ['هديه', 'هدايا', 'هدية'],
  ['لانش بوكس', 'لنش بوكس', 'حقيبه طعام', 'شنطه اكل'],
  ['ساعه', 'ساعات', 'ساعة'],
];

const SYNONYMS: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const group of SYNONYM_GROUPS) {
    const forms = Array.from(new Set(group.map(normalizeArabic).filter(Boolean)));
    for (const f of forms) map.set(f, forms);
  }
  return map;
})();

/**
 * Strips the definite article «ال» («الدفاتر» → «دفاتر», «القلم» → «قلم») — but only when what remains is a real
 * word (4+ letters, or a known word), so «الوان» never becomes «وان» and «العاب» never becomes «عاب».
 */
const stripArticle = (w: string) => {
  if (!w.startsWith('ال')) return w;
  const bare = w.slice(2);
  return bare.length >= 4 || SYNONYMS.has(bare) ? bare : w;
};

/** Every acceptable spelling of one query word. */
export function wordVariants(word: string): string[] {
  const w = normalizeArabic(word);
  if (!w) return [];
  const out = new Set<string>([w]);
  const bare = stripArticle(w);
  out.add(bare);
  for (const key of [w, bare]) for (const s of SYNONYMS.get(key) ?? []) out.add(s);
  return Array.from(out).filter(Boolean);
}

export type SearchQuery = { raw: string; groups: string[][] };

/**
 * Parses a query once. Multi-word synonyms («لانش بوكس») are matched as a phrase; every other word must be found
 * (AND) in some spelling. Single letters are ignored so «ا» does not match everything.
 */
export function parseQuery(raw: unknown): SearchQuery {
  const norm = normalizeArabic(raw);
  const groups: string[][] = [];
  if (!norm) return { raw: '', groups };

  let rest = ` ${norm} `;
  for (const phrase of SYNONYMS.keys()) {
    if (!phrase.includes(' ')) continue;
    if (rest.includes(` ${phrase} `)) {
      groups.push(SYNONYMS.get(phrase)!);
      rest = rest.replace(` ${phrase} `, ' ');
    }
  }
  for (const w of rest.split(' ')) {
    if (w.length < 2 && !/\d/.test(w)) continue;
    groups.push(wordVariants(w));
  }
  return { raw: norm, groups };
}

/** Builds the normalized, space-padded searchable text of a product from its own words. */
export function searchableText(parts: unknown[]): string {
  return ` ${normalizeArabic(parts.filter(Boolean).join(' '))} `;
}

/** True when every query word (in any of its spellings) appears in the product text. Empty query matches all. */
export function matchesQuery(text: string, q: SearchQuery): boolean {
  if (!q.groups.length) return true;
  return q.groups.every((variants) => variants.some((v) => text.includes(v)));
}

/**
 * Words that name a whole department. Searching one of them («العاب», «هدايا», «toys») lists that department.
 * Category and sub-category labels are NOT otherwise searched: many products carry 8–22 sub-categories, so a
 * label is no evidence that a product matches a word (e.g. «bag» used to find watches through «Wrapping Paper & Bags»).
 */
export const DEPARTMENT_ALIASES: Record<string, string[]> = {
  Games: ['العاب', 'toys', 'toy', 'games'],
  BabyGear: ['مركبات الاطفال', 'مركبات اطفال', 'مستلزمات بيبي', 'baby gear', 'ride ons', 'ride on'],
  Stationery: ['قرطاسيه', 'stationery', 'ادوات مدرسيه', 'ادوات مكتبيه'],
  Gifts: ['هدايا', 'gifts', 'gift'],
  Offers: ['عروض', 'offers', 'تخفيضات', 'خصومات', 'تصفيات', 'sale'],
};

const DEPARTMENT_FORMS: [string, Set<string>][] = Object.entries(DEPARTMENT_ALIASES).map(([id, aliases]) => [
  id,
  new Set(aliases.flatMap((a) => [normalizeArabic(a), ...wordVariants(a)])),
]);

/** Departments the whole query names (empty for ordinary product searches). */
export function departmentsNamedBy(q: SearchQuery): Set<string> {
  const out = new Set<string>();
  if (!q.groups.length) return out;
  for (const [id, forms] of DEPARTMENT_FORMS) {
    if (forms.has(q.raw) || (q.groups.length === 1 && q.groups[0].some((v) => forms.has(v)))) out.add(id);
  }
  return out;
}

export type ProductSearchEntry = { own: string; category: string };

/** Index entry for one product: its own words only (name, English name, brand) + its department id. */
export function productSearchEntry(p: { name?: unknown; nameEn?: unknown; brand?: unknown; category?: unknown }): ProductSearchEntry {
  return { own: searchableText([p.name, p.nameEn, p.brand]), category: String(p.category ?? '') };
}

/**
 * 'name'       — the query words are in the product's own name / English name / brand;
 * 'department' — the query is the name of the product's department («العاب» → every toy);
 * null         — no match. A category or sub-category label alone never makes a match.
 */
export function matchProduct(entry: ProductSearchEntry, q: SearchQuery, named: Set<string> = departmentsNamedBy(q)): 'name' | 'department' | null {
  if (matchesQuery(entry.own, q)) return 'name';
  if (named.has(entry.category)) return 'department';
  return null;
}
