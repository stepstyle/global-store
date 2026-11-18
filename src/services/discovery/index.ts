// AI Product Discovery — public entry points.
//   discoverProductsLocal(query, products)            -> synchronous, rule-based, no network (the fallback)
//   discoverProducts(query, products, { provider })   -> optional AI intent help, ALWAYS falls back to local
// `products` are store Products (src/types.ts) from any ProductSource; the module never fetches data itself.
import { parseDiscoveryQuery, hasSignal, needsAiHelp, DiscoveryInputError } from './intent.ts';
import { buildCatalog } from './catalog.ts';
import { rankCatalog, effectiveNeeds, isWideYoungAgeRange, formatAge } from './ranking.ts';
import type { RankOutput } from './ranking.ts';
import { STORE_CATEGORIES } from './lexicon.ts';
import type { AgeRegistry } from './ageRegistry.ts';
import { sanitizeProviderIntent, mergeIntent } from './provider.ts';
import type { IntentProvider } from './provider.ts';
import type { DiscoveryIntent, DiscoveryResponse } from './types.ts';
export { validateAgeRegistry } from './ageRegistry.ts';
export type { AgeRegistry, ApprovedAge } from './ageRegistry.ts';

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

const jod = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(2).replace(/0$/, ''));
const dinars = (n: number) => `${jod(n)} ${n >= 3 && n <= 10 && Number.isInteger(n) ? 'دنانير' : 'دينار'}`;

/**
 * Customer-facing message, short Jordanian Arabic. Facts only, and never internal numbers (how many products were
 * filtered, unconfirmed or out of stock) — those stay in `excluded` / `unconfirmed` for the store's own tools.
 */
function okMessage(intent: DiscoveryIntent, adultOpen: boolean): string {
  if (adultOpen) return 'هاي كم اقتراح من المتوفر عنا. إذا بتحكيلي شو نوع الهدية اللي ببالك بساعدك أكثر.';
  const bits: string[] = [];
  if (intent.age) bits.push(`مناسبة لعمر ${formatAge(intent.age.min, intent.age.max)} حسب بيانات العبوة`);
  if (intent.budget?.max != null) bits.push(`${intent.budget.maxExclusive ? 'بأقل من' : 'ضمن'} ${dinars(intent.budget.max)}`);
  return bits.length ? `هاي خيارات متوفرة عنا ${bits.join(' و')}:` : 'هاي أنسب الخيارات المتوفرة عنا:';
}

function noResultMessage(intent: DiscoveryIntent, r: RankOutput, hasItems: boolean): string {
  if (!hasItems) return 'المنتجات مش ظاهرة عندي هلّق. جرّب كمان شوي أو احكي معنا على واتساب.';
  const what = intent.age ? `مناسب لعمر ${formatAge(intent.age.min, intent.age.max)}` : 'يناسب طلبك';
  let msg = `للأسف ما لقيت إشي متوفر ومتأكدين إنه ${what} هلّق.`;
  // the one fact that helps the customer decide: a confirmed product exists, just above the budget
  if (r.excluded.overBudget && r.cheapestRelevantOverBudget !== null) msg = `ما لقيت إشي ضمن ميزانيتك؛ أقرب خيار مناسب سعره ${dinars(r.cheapestRelevantOverBudget)}.`;
  return `${msg} احكي معنا على واتساب ومنساعدك تختار 🌷`;
}

function respond(intent: DiscoveryIntent, products: readonly unknown[], limit: number | undefined, engine: DiscoveryResponse['engine'], aiFallbackReason: string | null, ai: DiscoveryResponse['ai'] = null, ages: AgeRegistry = {}): DiscoveryResponse {
  const base: Pick<DiscoveryResponse, 'intent' | 'engine' | 'aiFallbackReason' | 'unconfirmed' | 'clarification' | 'needs' | 'ai' | 'suggestWhatsApp'> = {
    intent, engine, aiFallbackReason, unconfirmed: [], clarification: null, needs: [], ai, suggestWhatsApp: false,
  };
  const hasHints = Boolean(intent.aiHints && (intent.aiHints.categories.length || intent.aiHints.keywords.length));
  if (!hasSignal(intent) && !hasHints) {
    return {
      ...base, status: 'needs_more_info', results: [], unavailable: [], excluded: { ...EMPTY_EXCLUDED },
      message: 'احكيلي شو بدك بالزبط: العمر أو الميزانية أو نوع الهدية، مثلًا «لعبة لبنت عمرها 3 سنين بحدود 10 دنانير».',
    };
  }
  // a very young child over a wide range (e.g. 0-3): ask, do not guess what is safe
  if (isWideYoungAgeRange(intent.age)) {
    return {
      ...base, status: 'needs_more_info', results: [], unavailable: [], excluded: { ...EMPTY_EXCLUDED },
      clarification: { question: 'قديش عمر الطفل بالزبط؟', options: [...YOUNG_AGE_OPTIONS] },
      message: 'عشان أقترح إشي آمن ومناسب إله، احكيلي عمره بالزبط.',
    };
  }
  const { items } = buildCatalog(products, ages);
  const r = rankCatalog(intent, items, { limit });
  const adultOpen = (intent.recipient === 'adult' || intent.recipient === 'teen') && !effectiveNeeds(intent).length && !intent.keywords.length;
  const results = adultOpen ? r.results.slice(0, ADULT_OPEN_REQUEST_LIMIT) : r.results;
  const clarification = adultOpen
    ? { question: 'شو نوع الهدية اللي ببالك؟', options: ['قرطاسية مكتبية', 'أدوات رسم وفن', 'حقيبة'] }
    : null;
  const out = { ...base, unavailable: r.unavailable, unconfirmed: r.unconfirmed, excluded: r.excluded, needs: r.needs, clarification };

  if (results.length) {
    let message = okMessage(intent, adultOpen);
    if (r.needs.length > 1) {
      // several product types: say which ones have something — one product never "answers" the whole request
      const found = r.needs.filter((n) => n.found).map((n) => `«${n.label}»`);
      const missing = r.needs.filter((n) => !n.found).map((n) => `«${n.label}»`);
      message = `لقيتلك من ${found.join(' و')}.${missing.length ? ` أما ${missing.join(' و')} فما لقيت إشي متوفر هلّق.` : ''}`;
    }
    return { ...out, status: 'ok', results, message, suggestWhatsApp: r.needs.some((n) => !n.found) };
  }
  return { ...out, status: 'no_results', results: [], message: noResultMessage(intent, r, items.length > 0), suggestWhatsApp: true };
}

function invalid(e: unknown): DiscoveryResponse {
  return {
    status: 'invalid_query', message: e instanceof DiscoveryInputError ? e.message : 'تعذر فهم الطلب.', intent: null,
    results: [], unavailable: [], unconfirmed: [], clarification: null, needs: [], excluded: { ...EMPTY_EXCLUDED }, engine: 'local', aiFallbackReason: null, ai: null, suggestWhatsApp: false,
  };
}

/**
 * Discovery from an intent that was built from STRUCTURED input (gift finder buttons via buildIntent / giftFinderIntent).
 * Same ranking, same rules, same response shape as the free-text search.
 */
export function discoverWithIntent(intent: DiscoveryIntent, products: readonly unknown[], opts: { limit?: number; ages?: AgeRegistry } = {}): DiscoveryResponse {
  return respond(intent, products, opts.limit, 'local', null, null, opts.ages);
}

/** Local, deterministic discovery. Never throws for bad input (returns status 'invalid_query'). */
export function discoverProductsLocal(query: unknown, products: readonly unknown[], opts: { limit?: number; ages?: AgeRegistry } = {}): DiscoveryResponse {
  let intent: DiscoveryIntent;
  try { intent = parseDiscoveryQuery(query); } catch (e) {
    if (e instanceof DiscoveryInputError) return invalid(e);
    throw e;
  }
  return respond(intent, products, opts.limit, 'local', null, null, opts.ages);
}

/**
 * Discovery with an optional AI intent provider. The provider gets `timeoutMs`; any error, timeout or unusable answer
 * falls back to the local result (aiFallbackReason says why). Products are always ranked locally from `products`.
 */
export async function discoverProducts(
  query: unknown,
  products: readonly unknown[],
  opts: { provider?: IntentProvider | null; timeoutMs?: number; limit?: number; aiPolicy?: 'when_needed' | 'always'; ages?: AgeRegistry } = {},
): Promise<DiscoveryResponse> {
  let local: DiscoveryIntent;
  try { local = parseDiscoveryQuery(query); } catch (e) {
    if (e instanceof DiscoveryInputError) return invalid(e);
    throw e;
  }
  const ages = opts.ages ?? {};
  const provider = opts.provider ?? null;
  if (!provider) return respond(local, products, opts.limit, 'local', null, null, ages);
  // AI complements the local understanding only when it is really unclear (no call, no cost, no latency otherwise)
  if ((opts.aiPolicy ?? 'when_needed') === 'when_needed' && !needsAiHelp(local)) {
    return respond(local, products, opts.limit, 'local', null, { called: false, skippedReason: 'request understood locally', verified: [], hints: [], ignored: [] }, ages);
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
    if (!patch) return respond(local, products, opts.limit, 'local', 'AI answer was empty or invalid', aiInfo(), ages);
    const { intent, filled, hinted, ignored } = mergeIntent(local, patch);
    const used = filled.length + hinted.length > 0;
    return respond(intent, products, opts.limit, used ? 'ai+local' : 'local', used ? null : 'AI added nothing to the local understanding', aiInfo(filled, hinted, ignored), ages);
  } catch (e) {
    const reason = e instanceof Error && e.message === 'timeout' ? `AI timeout after ${ms} ms` : 'AI provider error';
    return respond(local, products, opts.limit, 'local', reason, aiInfo(), ages);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
