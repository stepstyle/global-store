// AI Product Discovery — public entry points.
//   discoverProductsLocal(query, products)            -> synchronous, rule-based, no network (the fallback)
//   discoverProducts(query, products, { provider })   -> optional AI intent help, ALWAYS falls back to local
// `products` are store Products (src/types.ts) from any ProductSource; the module never fetches data itself.
import { parseDiscoveryQuery, hasSignal, needsAiHelp, DiscoveryInputError } from './intent.ts';
import { buildCatalog } from './catalog.ts';
import { rankCatalog, effectiveNeeds, isWideYoungAgeRange } from './ranking.ts';
import { STORE_CATEGORIES, CATEGORY_LABEL_AR } from './lexicon.ts';
import { sanitizeProviderIntent, mergeIntent } from './provider.ts';
import type { IntentProvider } from './provider.ts';
import type { DiscoveryIntent, DiscoveryResponse, DiscoveryCategory } from './types.ts';

export type { IntentProvider } from './provider.ts';
export type { DiscoveryResponse, DiscoveryResult, DiscoveryIntent } from './types.ts';
export { createRemoteIntentProvider, sanitizeProviderIntent } from './provider.ts';
export { parseDiscoveryQuery, DiscoveryInputError, buildIntent, needsAiHelp, cleanKeywordTokens } from './intent.ts';
export { mergeIntent } from './provider.ts';
export { giftFinderIntent } from './giftFinder.ts';
export type { GiftFinderAnswers } from './giftFinder.ts';

/** Where the products come from (the store data layer in the app, fixtures in tests). */
export interface ProductSource {
  listProducts(): Promise<readonly unknown[]>;
}

export const DEFAULT_AI_TIMEOUT_MS = 2500;

const EMPTY_EXCLUDED = { overBudget: 0, underBudget: 0, ageMismatch: 0, outOfStock: 0, noPrice: 0, negated: 0, notForRecipient: 0, unconfirmed: 0 };
/** a gift for an adult without a product type: a few reliable suggestions + one question, never a long guess list */
export const ADULT_OPEN_REQUEST_LIMIT = 3;
export const YOUNG_AGE_OPTIONS = Object.freeze(['أقل من سنة', 'من سنة إلى سنتين', 'من سنتين إلى 3 سنوات']);

function respond(intent: DiscoveryIntent, products: readonly unknown[], limit: number | undefined, engine: DiscoveryResponse['engine'], aiFallbackReason: string | null, ai: DiscoveryResponse['ai'] = null): DiscoveryResponse {
  const base: Pick<DiscoveryResponse, 'intent' | 'engine' | 'aiFallbackReason' | 'unconfirmed' | 'clarification' | 'needs' | 'ai'> = {
    intent, engine, aiFallbackReason, unconfirmed: [], clarification: null, needs: [], ai,
  };
  const hasHints = Boolean(intent.aiHints && (intent.aiHints.categories.length || intent.aiHints.keywords.length));
  if (!hasSignal(intent) && !hasHints) {
    return {
      ...base, status: 'needs_more_info', results: [], unavailable: [], excluded: { ...EMPTY_EXCLUDED },
      message: 'لم أجد في طلبك ما يحدد المنتج. أخبرني بالمناسبة أو العمر أو الميزانية أو نوع المنتج، مثل: "ألوان لبنت عمرها 5 سنين تحت 8 دينار".',
    };
  }
  // a very young child over a wide range (e.g. 0-3): ask, do not guess what is safe
  if (isWideYoungAgeRange(intent.age)) {
    return {
      ...base, status: 'needs_more_info', results: [], unavailable: [], excluded: { ...EMPTY_EXCLUDED },
      clarification: { question: 'كم عمر الطفل بالتحديد؟ النطاق من 0 إلى 3 سنوات واسع جدًا لنقترح منتجًا مناسبًا وآمنًا.', options: [...YOUNG_AGE_OPTIONS] },
      message: 'لكي نقترح منتجًا مناسبًا لعمر الطفل بأمان، حدّد العمر بدقة أكثر.',
    };
  }
  const { items } = buildCatalog(products);
  const r = rankCatalog(intent, items, { limit });
  const adultOpen = (intent.recipient === 'adult' || intent.recipient === 'teen') && !effectiveNeeds(intent).length && !intent.keywords.length;
  const results = adultOpen ? r.results.slice(0, ADULT_OPEN_REQUEST_LIMIT) : r.results;
  const clarification = adultOpen
    ? { question: 'لنقترح هدية أنسب: ما نوع الهدية الذي تفضّله؟', options: ['قرطاسية مكتبية', 'أدوات رسم وفن', 'حقيبة'] }
    : null;
  const unconfirmedNote = r.unconfirmed.length ? ` ${r.unconfirmed.length} منتج لم نعرضه لأن بيانات المتجر لا تؤكد مناسبته.` : '';
  const out = { ...base, unavailable: r.unavailable, unconfirmed: r.unconfirmed, excluded: r.excluded, needs: r.needs, clarification };

  if (results.length) {
    const extra = r.unavailable.length ? ` (و${r.unavailable.length} منتج مناسب غير متوفر حاليًا)` : '';
    let message = `وجدت ${results.length} منتج مناسب لطلبك${extra}.${unconfirmedNote}`;
    if (r.needs.length > 1) {
      // several product types: say per type what was found — one product never "answers" the whole request
      const per = r.needs.map((n) => (n.found
        ? `«${n.label}»: ${n.found}`
        : n.unconfirmed ? `«${n.label}»: لا يوجد منتج مؤكد (${n.unconfirmed} غير مؤكد التوفر أو العمر)` : `«${n.label}»: لا يوجد منتج مطابق`)).join('، ');
      message = `طلبك فيه ${r.needs.length} أنواع — ${per}.${unconfirmedNote}`;
    }
    if (adultOpen) message = `اقتراحات محدودة لا تخص الأطفال حسب بيانات المتجر.${unconfirmedNote}`;
    return { ...out, status: 'ok', results, message };
  }
  // no result: explain with facts only
  const parts: string[] = [];
  if (!items.length) parts.push('لا توجد منتجات في بيانات المتجر حاليًا.');
  else if (!r.relevant) {
    const cats = intent.categories.map((c: DiscoveryCategory) => CATEGORY_LABEL_AR[c]).join('، ');
    parts.push(cats ? `لا توجد منتجات مطابقة في قسم ${cats}.` : 'لا توجد منتجات تطابق وصفك في المتجر.');
  } else {
    if (r.excluded.overBudget) parts.push(`${r.excluded.overBudget} منتج مناسب أغلى من ميزانيتك${r.cheapestRelevantOverBudget !== null ? ` (أرخصها ${r.cheapestRelevantOverBudget} دينار)` : ''}.`);
    if (r.excluded.ageMismatch) parts.push(`${r.excluded.ageMismatch} منتج لا يناسب العمر المطلوب حسب بيانات المتجر.`);
    if (r.excluded.outOfStock) parts.push(`${r.excluded.outOfStock} منتج مناسب غير متوفر حاليًا.`);
    if (r.excluded.underBudget) parts.push(`${r.excluded.underBudget} منتج أرخص من الحد الأدنى الذي حددته.`);
    if (r.excluded.noPrice) parts.push(`${r.excluded.noPrice} منتج بلا سعر مسجل.`);
    if (r.excluded.negated) parts.push(`${r.excluded.negated} منتج من نوع طلبت استبعاده.`);
    if (r.excluded.notForRecipient) parts.push(`${r.excluded.notForRecipient} منتج مخصص للأطفال حسب بيانات المتجر.`);
    if (r.excluded.unconfirmed) parts.push(`${r.excluded.unconfirmed} منتج لا تؤكد بيانات المتجر مناسبته (العمر أو التوفر غير مسجل).`);
  }
  return {
    ...out, status: 'no_results', results: [],
    message: `لم أجد منتجًا مناسبًا يمكن التأكد منه. ${parts.join(' ')}`.trim(),
  };
}

function invalid(e: unknown): DiscoveryResponse {
  return {
    status: 'invalid_query', message: e instanceof DiscoveryInputError ? e.message : 'تعذر فهم الطلب.', intent: null,
    results: [], unavailable: [], unconfirmed: [], clarification: null, needs: [], excluded: { ...EMPTY_EXCLUDED }, engine: 'local', aiFallbackReason: null, ai: null,
  };
}

/**
 * Discovery from an intent that was built from STRUCTURED input (gift finder buttons via buildIntent / giftFinderIntent).
 * Same ranking, same rules, same response shape as the free-text search.
 */
export function discoverWithIntent(intent: DiscoveryIntent, products: readonly unknown[], opts: { limit?: number } = {}): DiscoveryResponse {
  return respond(intent, products, opts.limit, 'local', null);
}

/** Local, deterministic discovery. Never throws for bad input (returns status 'invalid_query'). */
export function discoverProductsLocal(query: unknown, products: readonly unknown[], opts: { limit?: number } = {}): DiscoveryResponse {
  let intent: DiscoveryIntent;
  try { intent = parseDiscoveryQuery(query); } catch (e) {
    if (e instanceof DiscoveryInputError) return invalid(e);
    throw e;
  }
  return respond(intent, products, opts.limit, 'local', null);
}

/**
 * Discovery with an optional AI intent provider. The provider gets `timeoutMs`; any error, timeout or unusable answer
 * falls back to the local result (aiFallbackReason says why). Products are always ranked locally from `products`.
 */
export async function discoverProducts(
  query: unknown,
  products: readonly unknown[],
  opts: { provider?: IntentProvider | null; timeoutMs?: number; limit?: number; aiPolicy?: 'when_needed' | 'always' } = {},
): Promise<DiscoveryResponse> {
  let local: DiscoveryIntent;
  try { local = parseDiscoveryQuery(query); } catch (e) {
    if (e instanceof DiscoveryInputError) return invalid(e);
    throw e;
  }
  const provider = opts.provider ?? null;
  if (!provider) return respond(local, products, opts.limit, 'local', null);
  // AI complements the local understanding only when it is really unclear (no call, no cost, no latency otherwise)
  if ((opts.aiPolicy ?? 'when_needed') === 'when_needed' && !needsAiHelp(local)) {
    return respond(local, products, opts.limit, 'local', null, { called: false, skippedReason: 'request understood locally', verified: [], hints: [], ignored: [] });
  }
  const aiInfo = (verified: string[] = [], hintsList: string[] = [], ignored: string[] = []): DiscoveryResponse['ai'] => ({ called: true, skippedReason: null, verified, hints: hintsList, ignored });

  const ac = new AbortController();
  const ms = Math.max(100, Math.min(10_000, opts.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      provider.extractIntent(local.query, { categories: STORE_CATEGORIES, signal: ac.signal }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { ac.abort(); reject(new Error('timeout')); }, ms); }),
    ]);
    const patch = sanitizeProviderIntent(raw);
    if (!patch) return respond(local, products, opts.limit, 'local', 'AI answer was empty or invalid', aiInfo());
    const { intent, filled, hinted, ignored } = mergeIntent(local, patch);
    const used = filled.length + hinted.length > 0;
    return respond(intent, products, opts.limit, used ? 'ai+local' : 'local', used ? null : 'AI added nothing to the local understanding', aiInfo(filled, hinted, ignored));
  } catch (e) {
    const reason = e instanceof Error && e.message === 'timeout' ? `AI timeout after ${ms} ms` : 'AI provider error';
    return respond(local, products, opts.limit, 'local', reason, aiInfo());
  } finally {
    if (timer) clearTimeout(timer);
  }
}
