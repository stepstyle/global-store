// AI Provider Adapter for discovery. An AI model may only help UNDERSTAND the request (intent fields); products,
// prices, stock and reasons always come from the store catalog through the local ranking. Nothing here is called
// unless a provider is passed explicitly — the default is local-only.
import { STORE_CATEGORIES } from './lexicon.ts';
import { MAX_AGE_YEARS, MAX_BUDGET_JOD, cleanKeywordTokens, numbersInQuery, numbersInContext } from './intent.ts';
import { normalizeArabic, numberWordsToDigits, tokenize } from './arabicText.ts';
import type { DiscoveryIntent, Occasion, Recipient, DiscoveryCategory } from './types.ts';

/** A model-backed intent extractor (e.g. a store Worker calling Cloudflare Workers AI). */
export interface IntentProvider {
  readonly id: string;
  /** Returns the model's raw answer; it is validated by sanitizeProviderIntent() before any use. */
  extractIntent(query: string, ctx: { categories: readonly DiscoveryCategory[]; signal: AbortSignal }): Promise<unknown>;
}

export type IntentPatch = Partial<Pick<DiscoveryIntent, 'budget' | 'age' | 'recipient' | 'occasions' | 'categories' | 'subCategories' | 'educational' | 'wantsOffers' | 'keywords' | 'excludeCategories'>>;

/** The ONLY fields a provider answer may contain (the discovery contract). Everything else is dropped. */
export const INTENT_PATCH_FIELDS: readonly string[] = Object.freeze([
  'budget', 'age', 'recipient', 'occasions', 'categories', 'subCategories', 'educational', 'wantsOffers', 'keywords', 'excludeCategories',
]);

const OCCASIONS: readonly Occasion[] = ['gift', 'birthday', 'back_to_school', 'success', 'eid'];
const RECIPIENTS: readonly Recipient[] = ['boy', 'girl', 'child', 'baby', 'teen', 'adult'];
const finite = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/**
 * Strict allow-list validation of a provider answer. Unknown fields are dropped (a model cannot inject products,
 * prices or text into the results). Returns null when nothing usable remains.
 */
export function sanitizeProviderIntent(raw: unknown): IntentPatch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: IntentPatch = {};

  if (r.budget && typeof r.budget === 'object') {
    const b = r.budget as Record<string, unknown>;
    const min = b.min == null ? null : finite(b.min, 0.01, MAX_BUDGET_JOD);
    const max = b.max == null ? null : finite(b.max, 0.01, MAX_BUDGET_JOD);
    const okMin = b.min == null || min !== null;
    const okMax = b.max == null || max !== null;
    if (okMin && okMax && (min !== null || max !== null) && (min === null || max === null || min <= max)) {
      out.budget = { min, max, approximate: b.approximate === true };
    }
  }
  if (r.age && typeof r.age === 'object') {
    const a = r.age as Record<string, unknown>;
    const min = finite(a.min, 0, MAX_AGE_YEARS);
    const max = finite(a.max, 0, MAX_AGE_YEARS);
    if (min !== null && max !== null && min <= max) out.age = { min, max, phrase: typeof a.phrase === 'string' ? a.phrase.slice(0, 40) : '' };
  }
  if (typeof r.recipient === 'string' && RECIPIENTS.includes(r.recipient as Recipient)) out.recipient = r.recipient as Recipient;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const occ = list(r.occasions).filter((o) => OCCASIONS.includes(o as Occasion)) as Occasion[];
  if (occ.length) out.occasions = [...new Set(occ)];
  const cats = list(r.categories).filter((c) => STORE_CATEGORIES.includes(c as DiscoveryCategory) && c !== 'Offers') as DiscoveryCategory[];
  if (cats.length) out.categories = [...new Set(cats)];
  const exCats = list(r.excludeCategories).filter((c) => STORE_CATEGORIES.includes(c as DiscoveryCategory) && c !== 'Offers' && !cats.includes(c as DiscoveryCategory)) as DiscoveryCategory[];
  if (exCats.length) out.excludeCategories = [...new Set(exCats)];
  const subs = list(r.subCategories).filter((s) => /^[A-Za-z]+\/[a-z0-9-]{1,20}$/.test(s) && STORE_CATEGORIES.includes(s.split('/')[0] as DiscoveryCategory));
  if (subs.length) out.subCategories = [...new Set(subs)];
  if (typeof r.educational === 'boolean') out.educational = r.educational;
  if (typeof r.wantsOffers === 'boolean') out.wantsOffers = r.wantsOffers;
  const kws = list(r.keywords).map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 2 && k.length <= 30).slice(0, 8);
  if (kws.length) out.keywords = [...new Set(kws)];
  return Object.keys(out).length ? out : null;
}

/** The provider only FILLS what the local parser left empty; local understanding always wins on conflicts. */
/**
 * Merges an AI answer into the LOCAL understanding without letting a guess act as a customer condition.
 *
 *   - Everything the local parser understood stays exactly as it is (budget, age, recipient, negation, occasion, type).
 *   - CONDITIONS (they filter products) may be filled by AI only when the local parser left them empty AND the value
 *     is confirmed by the request text: a budget / age whose numbers are written in the request -> `ai_verified`.
 *   - Everything else from AI is a HINT (`aiHints`): it may lift the ranking, or suggest products when nothing was
 *     understood locally, but it never filters, never excludes and never makes a product "مطابق للنوع المطلوب".
 *   - AI exclusions are never applied (hiding products needs the customer's own words).
 */
export function mergeIntent(local: DiscoveryIntent, patch: IntentPatch | null): { intent: DiscoveryIntent; filled: string[]; hinted: string[]; ignored: string[] } {
  if (!patch) return { intent: local, filled: [], hinted: [], ignored: [] };
  const intent: DiscoveryIntent = { ...local, provenance: { ...(local.provenance ?? {}) } };
  const filled: string[] = [];
  const hinted: string[] = [];
  const ignored: string[] = [];
  const written = new Set(numbersInQuery(local.normalized));
  // a number must be written AS a price / AS an age: "دفتر 100 ورقة" never confirms a 100 JD budget
  const ctx = numbersInContext(local.normalized);

  // conditions: only to fill a gap, only when the request text confirms them
  if (patch.budget) {
    const nums = [patch.budget.min, patch.budget.max].filter((v): v is number => v !== null);
    if (local.budget) ignored.push('budget (local understanding kept)');
    else if (!nums.length || !nums.every((v) => written.has(v))) ignored.push('budget (not written in the request)');
    else if (!nums.every((v) => ctx.budget.has(v))) ignored.push('budget (number not written as a price)');
    else { intent.budget = patch.budget; intent.provenance!.budget = 'ai_verified'; filled.push('budget'); }
  }
  if (patch.age) {
    const nums = [patch.age.min, patch.age.max];
    if (local.age) ignored.push('age (local understanding kept)');
    else if (!nums.every((v) => written.has(v))) ignored.push('age (not written in the request)');
    else if (!nums.every((v) => ctx.age.has(v))) ignored.push('age (number not written as an age)');
    else { intent.age = { ...patch.age, phrase: '' }; intent.provenance!.age = 'ai_verified'; filled.push('age'); }
  }

  // hints: inferences that need verification
  const hints = {
    categories: (patch.categories ?? []).filter((c) => !local.categories.includes(c) && !local.excludeCategories.includes(c)),
    keywords: cleanKeywordTokens(tokenize((patch.keywords ?? []).map((k) => numberWordsToDigits(normalizeArabic(k))).join(' ')), { dropConcepts: true })
      .filter((k) => !local.keywords.includes(k)),
    recipient: local.recipient ? null : patch.recipient ?? null,
    occasions: local.occasions.length ? [] : patch.occasions ?? [],
    educational: !local.educational && patch.educational === true,
    excludeCategories: (patch.excludeCategories ?? []).filter((c) => !local.excludeCategories.includes(c)),
  };
  if (patch.keywords?.length && !hints.keywords.length) ignored.push('keywords (no useful word after cleaning)');
  if (patch.subCategories?.length) ignored.push('subCategories (a product type needs the customer\'s words)');
  if (patch.wantsOffers && !local.wantsOffers) ignored.push('wantsOffers (offers are a condition)');
  if (hints.excludeCategories.length) ignored.push('excludeCategories (an exclusion needs the customer\'s words)');
  for (const k of ['categories', 'keywords', 'occasions'] as const) if (hints[k].length) hinted.push(k);
  if (hints.recipient) hinted.push('recipient');
  if (hints.educational) hinted.push('educational');
  if (hinted.length || hints.excludeCategories.length) intent.aiHints = hints;
  return { intent, filled, hinted, ignored };
}

/**
 * Provider that asks the STORE's own endpoint (e.g. a future Worker route `POST /ai/intent` that calls Workers AI
 * server-side, so no model key ever reaches the browser). Not used anywhere by default.
 * Only https URLs, or http://127.0.0.1 for local tests, are accepted.
 */
export function createRemoteIntentProvider(cfg: { endpoint: string; fetchImpl?: typeof fetch; id?: string }): IntentProvider {
  let url: URL;
  try { url = new URL(cfg.endpoint); } catch { throw new Error('AI intent endpoint is not a valid URL'); }
  const local = url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if (!(url.protocol === 'https:' || local) || url.username || url.password) throw new Error('AI intent endpoint must be https (or http://127.0.0.1 for local tests)');
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    id: cfg.id ?? `remote:${url.host}`,
    async extractIntent(query, ctx) {
      const res = await doFetch(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, categories: ctx.categories }),
        signal: ctx.signal,
        redirect: 'error',
      });
      if (!res.ok) throw new Error(`AI intent endpoint answered HTTP ${res.status}`);
      const body = (await res.json()) as { intent?: unknown };
      return body?.intent ?? null;
    },
  };
}
