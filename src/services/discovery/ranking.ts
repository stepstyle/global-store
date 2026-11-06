// Ranks STORE catalog items for a DiscoveryIntent.
//
// 1) SUITABILITY GATES first — a product that fails one is never recommended:
//    product type (exact / alternative per asked need) · negations · strict budget · confirmed stock ·
//    age (confirmed for every product under 4; for toys/cards/courses at any age) · recipient (no children's products
//    for an adult) · offers · educational.
//    Relevant products that fail only because the store data cannot CONFIRM suitability go to `unconfirmed`.
// 2) ORDER inside what passed: match level (exact > fits > alternative), then an internal heuristic score.
//    The score is not a probability and is never shown as accuracy; the customer sees a plain-language level.
// Every reason is backed by a store field; nothing is invented.
import {
  CATEGORY_LABEL_AR, SUBCATEGORY_LABEL_AR, GIFT_FRIENDLY, SCHOOL_SUPPLIES, AGE_CRITICAL_CATEGORIES, YOUNG_CHILD_MAX_AGE, BACK_TO_SCHOOL_NEEDS,
  areSubstitutes,
} from './lexicon.ts';
import { hasSignal } from './intent.ts';
import type { CatalogItem, DiscoveryIntent, DiscoveryResult, UnavailableMatch, UnconfirmedMatch, DiscoveryCategory, Need, NeedCoverage } from './types.ts';

export const APPROX_BUDGET_TOLERANCE = 0.1; // "بحدود 12" accepts up to 13.2, flagged in the caveats
export const DEFAULT_LIMIT = 12;
export const UNCONFIRMED_LIMIT = 5;
export const MATCH_LABELS = Object.freeze({ exact: 'مطابق للنوع المطلوب', fits: 'يناسب شروط طلبك', alternative: 'بديل قريب', inferred: 'اقتراح تقريبي' });
export const INFERRED_CAVEAT = 'اقتراح تقريبي من فهم المساعد الذكي لطلبك — لم تذكر هذا النوع صراحة، تأكد من مناسبته';
export const INSUFFICIENT_AGE = 'المعلومات غير كافية: العمر المناسب غير مذكور في بيانات المنتج';
export const INSUFFICIENT_STOCK = 'المعلومات غير كافية: التوفر غير مسجل في بيانات المنتج';
const LEVEL_RANK = { exact: 0, fits: 1, alternative: 2, inferred: 3 } as const;

const W = { exact: 100, fits: 60, alternative: 30, inferred: 20, keyword: 8, edu: 20, age: 15, budget: 8, gift: 6, recipient: 6, offer: 15, rating: 2, nameExact: 10, hint: 4 };

const fmtJod = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')} دينار`;

export function formatAge(min: number, max: number): string {
  const y = (n: number) => (n === 1 ? 'سنة' : n === 2 ? 'سنتين' : n <= 10 ? `${n} سنوات` : `${n} سنة`);
  if (max < 1) return `حتى ${Math.round(max * 12)} أشهر`;
  if (max >= 99) return `من ${y(min)} فما فوق`;
  if (min === max) return min === 2 ? 'سنتين' : y(min);
  return `من ${min} إلى ${max} ${max <= 10 ? 'سنوات' : 'سنة'}`;
}

const SOURCE_AR = { category: 'القسم', subCategory: 'التصنيف الفرعي', tags: 'الوسوم', name: 'اسم المنتج', description: 'وصف المنتج', age: 'العمر' } as const;
const labelOf = (c: string) => CATEGORY_LABEL_AR[c as DiscoveryCategory] ?? c;

/** "0-3" is too wide for a safe recommendation (a newborn and a 3-year-old need different products). */
export function isWideYoungAgeRange(age: { min: number; max: number } | null): boolean {
  return Boolean(age && age.min < 2 && age.max - age.min > 1.5);
}

/** The product types to answer: parsed needs, else derived from categories/subCategories, else back-to-school basics. */
export function effectiveNeeds(intent: DiscoveryIntent): Need[] {
  if (intent.needs?.length) return intent.needs;
  const needs: Need[] = [];
  for (const s of intent.subCategories) {
    const [c, sub] = s.split('/');
    needs.push({ key: s, label: SUBCATEGORY_LABEL_AR[sub] ?? sub, category: c as DiscoveryCategory, subs: [sub], typeWords: [], specific: true });
  }
  for (const c of intent.categories) {
    if (!needs.some((n) => n.category === c)) needs.push({ key: `${c}/*`, label: CATEGORY_LABEL_AR[c], category: c, subs: [], typeWords: [], specific: false });
  }
  if (!needs.length && intent.occasions.includes('back_to_school')) {
    for (const n of BACK_TO_SCHOOL_NEEDS) needs.push({ key: `${n.category}/${n.sub}`, label: n.label, category: n.category, subs: n.sub.split('|'), typeWords: [], specific: true });
  }
  return needs;
}

/**
 * exact       = the asked type (its slug, or the type word in the product's own name/tags)
 * alternative = a real substitute of the asked slug in the store taxonomy (pencils for pens, a backpack for a school
 *               bag, other cards for English cards). Sharing a category is NOT enough, and a named type without a
 *               slug ("مقلمة") has no alternatives.
 */
function matchNeed(need: Need, it: CatalogItem): 'exact' | 'alternative' | null {
  const inCat = it.categories.includes(need.category);
  if (!need.specific) return inCat ? 'exact' : null;
  const subOk = inCat && need.subs.length > 0 && it.subCategory !== null && need.subs.includes(it.subCategory);
  const nameOk = need.typeWords.some((w) => it.nameWords.has(w));
  if (subOk || nameOk) return 'exact';
  if (inCat && it.subCategory && need.subs.some((s) => areSubstitutes(s, it.subCategory as string))) return 'alternative';
  return null;
}

export interface RankOutput {
  results: DiscoveryResult[];
  unavailable: UnavailableMatch[];
  unconfirmed: UnconfirmedMatch[];
  excluded: { overBudget: number; underBudget: number; ageMismatch: number; outOfStock: number; noPrice: number; negated: number; notForRecipient: number; unconfirmed: number };
  /** relevant items before the hard conditions (for the "no results" explanation) */
  relevant: number;
  cheapestRelevantOverBudget: number | null;
  needs: NeedCoverage[];
}

type Candidate = DiscoveryResult & { needKey: string | null };

export function rankCatalog(intent: DiscoveryIntent, items: readonly CatalogItem[], opts: { limit?: number } = {}): RankOutput {
  const limit = Math.max(1, Math.min(50, opts.limit ?? DEFAULT_LIMIT));
  const excluded = { overBudget: 0, underBudget: 0, ageMismatch: 0, outOfStock: 0, noPrice: 0, negated: 0, notForRecipient: 0, unconfirmed: 0 };
  const unavailable: UnavailableMatch[] = [];
  const unconfirmed: UnconfirmedMatch[] = [];
  const candidates: Candidate[] = [];
  let relevant = 0;
  let cheapestOver: number | null = null;
  const unconfirmedByNeed = new Map<string, number>();

  const needs = effectiveNeeds(intent);
  const kw = intent.keywords;
  const excludeCats = intent.excludeCategories ?? [];
  const excludeSubs = intent.excludeSubCategories ?? [];
  const ageReq = intent.age;
  const young = Boolean(ageReq && ageReq.max < YOUNG_CHILD_MAX_AGE);
  const maxBudget = intent.budget?.max ?? null;
  const budgetLimit = maxBudget === null ? null : intent.budget!.approximate ? maxBudget * (1 + APPROX_BUDGET_TOLERANCE) : maxBudget;
  // the customer named WHAT they want: only then are out-of-stock / unconfirmed matches worth listing
  const hasTopic = needs.length > 0 || kw.length > 0 || intent.educational || intent.wantsOffers;
  const adultish = intent.recipient === 'adult' || intent.recipient === 'teen';
  const hints = intent.aiHints ?? null;
  const localSignal = hasSignal(intent);

  for (const it of items) {
    // ---------- relevance + match level ----------
    const kwName = kw.filter((k) => it.nameWords.has(k));
    const kwText = kw.filter((k) => !it.nameWords.has(k) && it.textWords.has(k));
    // AI hints (unverified) — never a condition; see mergeIntent()
    const hintCat = Boolean(hints?.categories.some((c) => it.categories.includes(c)));
    const hintKw = Boolean(hints?.keywords.some((k) => it.nameWords.has(k)));
    let level: DiscoveryResult['matchLevel'] | null = null;
    let need: Need | null = null;
    if (needs.length) {
      // the customer named the type(s): only the customer's words decide relevance (hints never add another type)
      for (const n of needs) {
        const m = matchNeed(n, it);
        if (m === 'exact') { level = 'exact'; need = n; break; }
        if (m === 'alternative' && !level) { level = 'alternative'; need = n; }
      }
      if (!level && kwName.length) level = 'exact'; // the customer named this product
    } else if (kw.length) {
      if (kwName.length + kwText.length) level = 'exact';
      else if (hintCat || hintKw) level = 'inferred'; // unknown words: an AI reading may suggest, clearly labelled
    } else if (!localSignal) {
      level = hintCat || hintKw ? 'inferred' : null; // nothing understood locally: only labelled AI suggestions
    } else {
      level = 'fits';
    }
    if (!level) continue;
    const eduHit = it.educational !== null;
    if (intent.educational && !eduHit) continue; // "تعليمي" is a requirement
    const offerHit = it.originalPrice !== null || it.categories.includes('Offers');
    if (intent.wantsOffers && !offerHit) continue; // "عروض" is a requirement
    if (it.categories.some((c) => excludeCats.includes(c as DiscoveryCategory))
      || excludeSubs.some((s) => { const [c, sub] = s.split('/'); return it.categories.includes(c) && it.subCategory === sub; })) {
      excluded.negated++;
      continue;
    }
    relevant++;

    // ---------- hard conditions ----------
    if (it.price === null) { excluded.noPrice++; continue; }
    // what cannot be recommended is listed only when it is the asked type itself (not an alternative)
    const listable = hasTopic && (level === 'exact' || level === 'fits');
    const noteUnconfirmed = (reason: string) => {
      excluded.unconfirmed++;
      if (need && level === 'exact') unconfirmedByNeed.set(need.key, (unconfirmedByNeed.get(need.key) ?? 0) + 1);
      if (listable && unconfirmed.length < UNCONFIRMED_LIMIT) unconfirmed.push({ id: it.id, name: it.name, reason });
    };
    if (it.stock === 'out') {
      excluded.outOfStock++;
      if (listable && unavailable.length < 5) unavailable.push({ id: it.id, name: it.name, reason: 'out_of_stock' });
      continue;
    }
    // "اقل من 10": 10 itself is over the budget; "حتى 10": 10 is fine
    if (budgetLimit !== null && (intent.budget!.maxExclusive ? it.price >= budgetLimit - 1e-9 : it.price > budgetLimit + 1e-9)) {
      excluded.overBudget++;
      cheapestOver = cheapestOver === null ? it.price : Math.min(cheapestOver, it.price);
      continue;
    }
    if (intent.budget?.min != null && it.price < intent.budget.min - 1e-9) { excluded.underBudget++; continue; }
    if (ageReq) {
      if (it.age) {
        // young children: the product must already be suitable at the YOUNGEST age asked (not merely overlap)
        const ok = it.age.max >= ageReq.min && it.age.min <= (young ? ageReq.min : ageReq.max);
        if (!ok) { excluded.ageMismatch++; continue; }
      } else if (young || it.categories.some((c) => AGE_CRITICAL_CATEGORIES.includes(c as DiscoveryCategory))) {
        // cannot be confirmed from the store data -> never presented as suitable
        noteUnconfirmed(INSUFFICIENT_AGE);
        continue;
      }
    }
    if (adultish && !ageReq && it.forChildren) { excluded.notForRecipient++; continue; }
    if (it.stock === 'unknown') { noteUnconfirmed(INSUFFICIENT_STOCK); continue; }

    // ---------- order score + reasons (all from store data) ----------
    let score = W[level];
    const reasons: string[] = [];
    const caveats: string[] = [];
    const missing: string[] = [];
    if (need && level === 'exact') {
      reasons.push(need.specific ? `من النوع الذي طلبته: «${need.label}»` : `من قسم «${need.label}» الذي طلبته`);
      if (need.typeWords.some((w) => it.nameWords.has(w))) score += W.nameExact;
    } else if (need && level === 'alternative') {
      caveats.push(`بديل قريب من «${SUBCATEGORY_LABEL_AR[it.subCategory ?? ''] ?? labelOf(need.category)}»، وليس «${need.label}» تحديدًا`);
    }
    if (kwName.length || kwText.length) {
      score += Math.min(3, kwName.length + kwText.length) * W.keyword;
      reasons.push(`يطابق كلمات بحثك في ${kwName.length ? 'اسم المنتج أو وسومه' : 'وصف المنتج'}`);
    }
    if (intent.educational && eduHit) { score += W.edu; reasons.push(`تعليمي حسب ${SOURCE_AR[it.educational!.source]}`); }
    if (ageReq && it.age) { score += W.age; reasons.push(`مناسب لعمر ${formatAge(it.age.min, it.age.max)} حسب ${SOURCE_AR[it.age.source]}`); }
    if (intent.budget) {
      if (maxBudget !== null && it.price > maxBudget) { score += 2; caveats.push(`سعره ${fmtJod(it.price)}، أعلى قليلًا من ميزانيتك (${fmtJod(maxBudget)})`); }
      else { score += W.budget; reasons.push(`سعره ${fmtJod(it.price)} ضمن ميزانيتك`); }
    }
    if (!needs.length && intent.occasions.some((o) => o !== 'back_to_school') && it.categories.some((c) => GIFT_FRIENDLY.includes(c as DiscoveryCategory))) {
      score += W.gift;
      reasons.push(`مناسب كهدية من قسم «${labelOf(it.category)}»`);
    }
    if (intent.occasions.includes('back_to_school') && it.categories.some((c) => SCHOOL_SUPPLIES.includes(c as DiscoveryCategory))) score += W.gift;
    if ((intent.recipient === 'boy' && it.subCategory === 'boys') || (intent.recipient === 'girl' && it.subCategory === 'girls')) {
      score += W.recipient;
      reasons.push(`مصنّف «${SUBCATEGORY_LABEL_AR[it.subCategory] ?? it.subCategory}» في المتجر`);
    } else if ((intent.recipient === 'girl' && it.subCategory === 'boys') || (intent.recipient === 'boy' && it.subCategory === 'girls')) {
      score -= W.recipient;
      caveats.push(`مصنّف في المتجر «${SUBCATEGORY_LABEL_AR[it.subCategory]}»`);
    }
    if (intent.wantsOffers && offerHit) {
      score += W.offer;
      reasons.push(it.originalPrice !== null ? `عليه خصم: كان ${fmtJod(it.originalPrice)} وأصبح ${fmtJod(it.price)}` : 'من قسم العروض');
    }
    if (it.ratingAvg !== null && it.ratingCount > 0) {
      score += (Math.max(0, Math.min(5, it.ratingAvg)) / 5) * W.rating;
      if (it.ratingAvg >= 4) reasons.push(`تقييمه ${it.ratingAvg.toFixed(1)} من 5 (${it.ratingCount} تقييم)`);
    }
    if (ageReq && !it.age) missing.push('العمر المناسب غير مذكور في بيانات المنتج (غير حاسم لهذا النوع)');
    // AI hints only reorder inside what already passed every condition
    if (hintCat) score += W.hint;
    if (hintKw) score += W.hint;
    if (hints?.educational && it.educational) score += W.hint;
    if (level === 'inferred') caveats.push(INFERRED_CAVEAT);
    if (!reasons.length) reasons.push('ضمن الشروط التي طلبتها');

    candidates.push({
      id: it.id, name: it.name, nameEn: it.nameEn, image: it.image, price: it.price, originalPrice: it.originalPrice, category: it.category,
      matchLevel: level, matchLabel: MATCH_LABELS[level], forNeed: need?.label ?? null, needKey: need?.key ?? null,
      score: Math.round(score * 100) / 100, reasons, missing, caveats,
    });
  }

  const order = (a: Candidate, b: Candidate) => LEVEL_RANK[a.matchLevel] - LEVEL_RANK[b.matchLevel] || b.score - a.score || a.price - b.price || a.id.localeCompare(b.id);
  candidates.sort(order);

  // per asked type: exact products only; alternatives ONLY for a type that has no exact product
  let chosen: Candidate[];
  const coverage: NeedCoverage[] = [];
  if (needs.length) {
    const perNeed = Math.max(3, Math.ceil(limit / needs.length));
    chosen = [];
    for (const n of needs) {
      const mine = candidates.filter((c) => c.needKey === n.key);
      const exact = mine.filter((c) => c.matchLevel === 'exact');
      const pick = (exact.length ? exact : mine).slice(0, needs.length > 1 ? perNeed : limit);
      coverage.push({ key: n.key, label: n.label, found: exact.length, unconfirmed: unconfirmedByNeed.get(n.key) ?? 0 });
      chosen.push(...pick);
    }
    // products the customer named directly (keywords) that answer no listed type
    chosen.push(...candidates.filter((c) => c.needKey === null));
    if (needs.length === 1) chosen.sort(order);
  } else {
    chosen = candidates;
  }
  const results: DiscoveryResult[] = chosen.slice(0, needs.length > 1 ? Math.max(limit, needs.length * 3) : limit).map((c) => {
    const { needKey, ...r } = c;
    void needKey;
    return r;
  });
  return { results, unavailable, unconfirmed, excluded, relevant, cheapestRelevantOverBudget: cheapestOver, needs: coverage };
}
