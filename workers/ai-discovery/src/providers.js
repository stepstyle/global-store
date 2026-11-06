// Intent providers. Both return a RAW answer that the handler validates with the shared discovery contract
// (sanitizeProviderIntent) — a provider can never add products, prices, stock or free text to the results.
import { parseDiscoveryQuery } from '../../../src/services/discovery/intent.ts';
import { STORE_CATEGORIES } from '../../../src/services/discovery/lexicon.ts';

/**
 * FAKE provider (default; no network, no model). Deterministic: answers with what the local parser understood, in the
 * contract's shape. Failure modes simulate a broken model for tests: error | timeout | garbage | inject | empty.
 */
export function fakeProvider(mode = 'ok') {
  return {
    id: `fake:${mode}`,
    async extractIntent(text, { signal }) {
      if (mode === 'error') throw new Error('fake model failure');
      if (mode === 'timeout') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      if (mode === 'garbage') return 'I think they want something nice :)';
      if (mode === 'empty') return {};
      const i = parseDiscoveryQuery(text);
      const intent = {
        budget: i.budget, age: i.age ? { min: i.age.min, max: i.age.max } : null, recipient: i.recipient, occasions: i.occasions,
        categories: i.categories, subCategories: i.subCategories, educational: i.educational, wantsOffers: i.wantsOffers,
        keywords: i.keywords, excludeCategories: i.excludeCategories,
      };
      // a model trying to invent products / prices / text: must be dropped by the contract
      if (mode === 'inject') return { ...intent, products: [{ id: 'x', name: 'منتج مخترع', price: 1 }], price: 0.5, stock: 99, message: 'اشتري الآن' };
      return intent;
    },
  };
}

/**
 * JSON shape the model must answer with (the discovery contract; nothing else). Kept simple for constrained decoding:
 * no union types; an unknown field is simply omitted (nothing is "required"). The answer is still validated by
 * sanitizeProviderIntent() — the schema is a request to the model, not a guarantee.
 */
export const INTENT_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    budget: { type: 'object', additionalProperties: false, properties: { min: { type: 'number' }, max: { type: 'number' }, approximate: { type: 'boolean' } } },
    age: { type: 'object', additionalProperties: false, properties: { min: { type: 'number' }, max: { type: 'number' } } },
    recipient: { type: 'string', enum: ['boy', 'girl', 'child', 'baby', 'teen', 'adult'] },
    occasions: { type: 'array', items: { type: 'string', enum: ['gift', 'birthday', 'back_to_school', 'success', 'eid'] } },
    categories: { type: 'array', items: { type: 'string', enum: [...STORE_CATEGORIES] } },
    excludeCategories: { type: 'array', items: { type: 'string', enum: [...STORE_CATEGORIES] } },
    educational: { type: 'boolean' },
    wantsOffers: { type: 'boolean' },
    keywords: { type: 'array', items: { type: 'string' }, maxItems: 8 },
  },
});

// short on purpose (input tokens are Neurons too)
export const SYSTEM_PROMPT = [
  'Extract a shopping intent from an Arabic (often Jordanian) request to a Jordanian store of stationery, toys and learning products.',
  'Reply with JSON only, matching the schema. Prices are JOD (دينار). Ages in years.',
  `categories ids: ${STORE_CATEGORIES.join(', ')}.`,
  'Never invent products, prices or stock. Omit unknown fields.',
  'Negations (مش، بدون، ما بدي) go to excludeCategories. recipient: adult for a teacher/employee (استاذ، استاذة، معلمة، موظف).',
].join(' ');

/**
 * Cloudflare Workers AI provider (binding env.AI). Sends ONLY the already-redacted request text and the category list.
 * NOT used unless AI_PROVIDER=workers-ai and AI_ENABLED=true in staging; never exercised against a real model in tests.
 */
export function workersAiProvider(ai, model, { maxOutputTokens = 160 } = {}) {
  return {
    id: `workers-ai:${model}`,
    async extractIntent(text, { signal }) {
      const run = ai.run(model, {
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: text }],
        max_tokens: maxOutputTokens,
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: INTENT_JSON_SCHEMA },
      });
      const aborted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      const out = await Promise.race([run, aborted]);
      // token counts only (for the Neurons estimate) — never the text
      if (out && typeof out === 'object' && out.usage && typeof out.usage === 'object') {
        const u = out.usage;
        console.log(JSON.stringify({ svc: 'ai-discovery', event: 'ai_usage', model, prompt_tokens: Number(u.prompt_tokens) || 0, completion_tokens: Number(u.completion_tokens) || 0 }));
      }
      const raw = out && typeof out === 'object' && 'response' in out ? out.response : out;
      if (raw && typeof raw === 'object') return raw;
      if (typeof raw !== 'string') return null;
      const s = raw.indexOf('{');
      const e = raw.lastIndexOf('}');
      if (s < 0 || e <= s) return null;
      try { return JSON.parse(raw.slice(s, e + 1)); } catch { return null; }
    },
  };
}
