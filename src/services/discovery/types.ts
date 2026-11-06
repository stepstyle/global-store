// Types for AI Product Discovery. Type-only module (erased at runtime).
import type { Category } from '../../types';

export type DiscoveryCategory = Category;

export type Occasion = 'gift' | 'birthday' | 'back_to_school' | 'success' | 'eid';
export type Recipient = 'boy' | 'girl' | 'child' | 'baby' | 'teen' | 'adult';

export interface BudgetIntent {
  /** inclusive, JOD */
  min: number | null;
  /** inclusive, JOD — unless `maxExclusive` */
  max: number | null;
  /** "أقل من 10" / "تحت 10": the price must be BELOW max (10 itself is out). Absent = inclusive ("حتى 10", "ما يتعدى 10"). */
  maxExclusive?: true;
  /** "بحدود 12" / "حوالي 12" / bare "12 دينار": a small tolerance above max is accepted and flagged */
  approximate: boolean;
}

export interface AgeIntent {
  /** years (months are converted: 6 months = 0.5) */
  min: number;
  max: number;
  /** original phrase, normalized (for the explanation) */
  phrase: string;
}

/** One product type the customer asked for ("دفتر وقلم" = two needs). */
export interface Need {
  key: string;
  /** customer-facing name: "دفاتر", "أقلام", "مقلمة", "الألعاب" */
  label: string;
  category: DiscoveryCategory;
  /** store subCategory slugs that satisfy this need exactly (empty = any product named like the need, or the whole category) */
  subs: string[];
  /** light-stemmed words of the asked phrase, matched on the product name/tags */
  typeWords: string[];
  /** false = a whole category ("قرطاسية"): any product of it is an exact match */
  specific: boolean;
}

export interface DiscoveryIntent {
  query: string;
  normalized: string;
  budget: BudgetIntent | null;
  age: AgeIntent | null;
  recipient: Recipient | null;
  occasions: Occasion[];
  categories: DiscoveryCategory[];
  /** "Category/subCategory" slugs from the store taxonomy (constants.ts SUBCATEGORIES) */
  subCategories: string[];
  educational: boolean;
  wantsOffers: boolean;
  /** remaining meaningful words (light-stemmed), used for text matching */
  keywords: string[];
  /** words of the matched category phrases ("مقلمة"): a bonus for products NAMED that way, never a requirement */
  termWords: string[];
  /** negated by the customer ("مش لعبة" -> Games; "بدون الوان" -> ArtSupplies/colors): never recommended */
  excludeCategories: DiscoveryCategory[];
  excludeSubCategories: string[];
  /** the product types asked for, one per distinct type (derived from categories/subCategories when absent) */
  needs?: Need[];
  /**
   * Where each understood field comes from:
   *   stated          the customer's own words (matched by the local parser)
   *   local_inferred  a safe local inference ("رضيع" -> age 0-1)
   *   ai_verified     filled by the AI model AND confirmed in the request text (e.g. the number "12" is written there)
   * AI guesses that cannot be confirmed are NOT here: they live in `aiHints` and never act as conditions.
   */
  provenance?: Partial<Record<'budget' | 'age' | 'recipient' | 'occasions' | 'categories' | 'subCategories' | 'educational' | 'wantsOffers' | 'keywords' | 'excludeCategories', 'stated' | 'local_inferred' | 'ai_verified'>>;
  /** AI inferences that need verification: they may lift the ranking (or suggest when nothing was understood locally)
   *  but never filter, exclude or turn a product into "مطابق للنوع المطلوب" */
  aiHints?: AiHints;
  /** non-fatal parsing notes shown to the customer (e.g. "budget ignored: not a valid amount") */
  warnings: string[];
}

export interface AiHints {
  categories: DiscoveryCategory[];
  keywords: string[];
  recipient: Recipient | null;
  occasions: Occasion[];
  educational: boolean;
  /** shown for transparency only — an exclusion is applied only when the customer's own words say so */
  excludeCategories: DiscoveryCategory[];
}

/** What the ranking needs from a store product — derived from the real Product, never invented. */
export interface CatalogItem {
  id: string;
  name: string;
  nameEn: string;
  image: string;
  category: DiscoveryCategory | string;
  categories: string[];
  subCategory: string | null;
  /** lowest purchasable price (in-stock variant if variants exist), JOD; null if the store has no valid price */
  price: number | null;
  originalPrice: number | null;
  /** 'in' / 'out' from stock fields; 'unknown' when the store has no stock number */
  stock: 'in' | 'out' | 'unknown';
  /** age range found in the store data, with where it was found */
  age: { min: number; max: number; source: 'subCategory' | 'tags' | 'name' | 'description' } | null;
  educational: { source: 'category' | 'subCategory' | 'tags' | 'name' | 'description' } | null;
  /** evidence in the store data that the product is made for children (category, slug, words, or a child age range) */
  forChildren: { source: 'category' | 'subCategory' | 'tags' | 'name' | 'description' | 'age' } | null;
  ratingAvg: number | null;
  ratingCount: number;
  /** normalized + light-stemmed searchable words: name, nameEn, tags, brand, description */
  nameWords: Set<string>;
  textWords: Set<string>;
}

export interface DiscoveryResult {
  id: string;
  name: string;
  nameEn: string;
  image: string;
  price: number;
  originalPrice: number | null;
  category: string;
  /**
   * How it matches — shown to the customer INSTEAD of a percentage (an internal score is not a measured accuracy):
   *   exact       "مطابق للنوع المطلوب"   the product is the type asked for (and meets every stated condition)
   *   fits        "يناسب شروط طلبك"       no type was asked; it meets every stated condition
   *   alternative "بديل قريب"             same category, not the exact type (said plainly)
   *   inferred    "اقتراح تقريبي"          suggested only from an AI hint (nothing was understood locally); needs the customer's check
   */
  matchLevel: 'exact' | 'fits' | 'alternative' | 'inferred';
  matchLabel: string;
  /** which asked type it answers ("دفاتر" / "أقلام") when the request names several */
  forNeed: string | null;
  /** INTERNAL ordering score (heuristic, not a probability) — never show it as accuracy */
  score: number;
  /** why it was suggested — each line is backed by a store field */
  reasons: string[];
  /** information the store data does not provide (never guessed) */
  missing: string[];
  /** honest limits of the match (alternative of the same category, slightly over budget, other gender label…) */
  caveats: string[];
}

export interface UnavailableMatch {
  id: string;
  name: string;
  reason: 'out_of_stock';
}

/** Relevant products whose suitability the store data cannot confirm — listed apart, NEVER recommended. */
export interface UnconfirmedMatch {
  id: string;
  name: string;
  /** "المعلومات غير كافية: …" */
  reason: string;
}

export interface NeedCoverage {
  key: string;
  label: string;
  /** exact, recommendable products for this type */
  found: number;
  /** products of this type the store data cannot confirm (age / availability) — not recommended */
  unconfirmed: number;
}

export type DiscoveryStatus = 'ok' | 'no_results' | 'needs_more_info' | 'invalid_query';

export interface DiscoveryResponse {
  status: DiscoveryStatus;
  /** customer-facing message (Arabic) */
  message: string;
  intent: DiscoveryIntent | null;
  results: DiscoveryResult[];
  /** matching products that are out of stock — listed, never recommended */
  unavailable: UnavailableMatch[];
  /** relevant products whose age suitability / availability is not confirmed by the store data — never recommended */
  unconfirmed: UnconfirmedMatch[];
  /** one question when the request is too open to recommend safely (e.g. "0-3 years", a gift for an adult) */
  clarification: { question: string; options: string[] } | null;
  /** per asked product type, how many recommendations answer it ("دفتر وقلم") */
  needs: NeedCoverage[];
  excluded: { overBudget: number; underBudget: number; ageMismatch: number; outOfStock: number; noPrice: number; negated: number; notForRecipient: number; unconfirmed: number };
  engine: 'local' | 'ai+local';
  /** set when an AI provider was configured but not used (error / timeout / invalid output) */
  aiFallbackReason: string | null;
  /** what happened with AI for this request (null = no provider configured) */
  ai: { called: boolean; skippedReason: string | null; verified: string[]; hints: string[]; ignored: string[] } | null;
}
