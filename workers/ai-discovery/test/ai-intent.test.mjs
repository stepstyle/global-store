// AI discovery helper — LOCAL tests. Fake provider / fake AI binding only: no model, no network, no Cloudflare.
//   node --test workers/ai-discovery/test/ai-intent.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { _resetMemory, MAX_BODY_BYTES } from '../src/handler.js';
import { loadConfig } from '../src/config.js';
import { redactPersonalData } from '../src/privacy.js';
import { INTENT_PATCH_FIELDS } from '../../../src/services/discovery/provider.ts';
import { discoverProducts, discoverProductsLocal, createRemoteIntentProvider } from '../../../src/services/discovery/index.ts';
import { MOCK_PRODUCTS } from '../../../tests/fixtures/discoveryCatalog.mjs';

const ORIGIN = 'http://127.0.0.1:3000';
const BASE = { ENVIRONMENT: 'local', AI_PROVIDER: 'fake', ALLOWED_ORIGINS: ORIGIN };
const req = (body, { origin = ORIGIN, method = 'POST', path = '/ai/intent', headers = {} } = {}) => new Request(`http://127.0.0.1:8799${path}`, {
  method,
  headers: { ...(origin ? { origin } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers },
  body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
});
const call = async (body, env = {}, opts = {}, deps = {}) => {
  const r = await worker.fetch(req(body, opts), { ...BASE, ...env }, {}, deps);
  return { status: r.status, body: r.status === 204 ? null : await r.json(), headers: r.headers };
};
/** captures console.log during fn (the Worker's only log channel) */
async function logsOf(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { await fn(); } finally { console.log = orig; }
  return lines.join('\n');
}
const spyProvider = (answer) => {
  const p = { id: 'spy', calls: [], async extractIntent(text) { p.calls.push(text); return typeof answer === 'function' ? answer(text) : answer; } };
  return p;
};

beforeEach(() => _resetMemory());

// ------------------------------------------------------------------ guards
test('config guard: production / missing env, prod site origin, credentials, unsafe AI opt-in -> CONFIG_ERROR, no provider call', async () => {
  const bad = {
    'production env': { ENVIRONMENT: 'production' },
    'no env': { ENVIRONMENT: '' },
    'prod site origin': { ALLOWED_ORIGINS: 'https://dairsharaf.com' },
    'http non-loopback origin': { ALLOWED_ORIGINS: 'http://example.com' },
    'wildcard origin': { ALLOWED_ORIGINS: '*' },
    'api key present': { OPENAI_API_KEY: 'x' },
    'cloudflare token present': { CLOUDFLARE_API_TOKEN: 'x' },
    'gemini key present': { VITE_GEMINI_API_KEY: 'x' },
    'workers-ai without opt-in': { ENVIRONMENT: 'staging', AI_PROVIDER: 'workers-ai', AI: { run: async () => ({}) } },
    'workers-ai locally': { AI_PROVIDER: 'workers-ai', AI_ENABLED: 'true', AI: { run: async () => ({}) } },
    'workers-ai without binding': { ENVIRONMENT: 'staging', AI_PROVIDER: 'workers-ai', AI_ENABLED: 'true' },
    'bad model id': { AI_MODEL: 'gpt-4' },
    'bad daily limit': { DAILY_AI_LIMIT: '0' },
    'output budget too large': { AI_OUTPUT_LIMIT: '9999' },
    'unknown provider': { AI_PROVIDER: 'openai' },
  };
  for (const [name, env] of Object.entries(bad)) {
    const p = spyProvider({ categories: ['Games'] });
    const r = await call({ query: 'لعبة' }, env, {}, { provider: p });
    assert.equal(r.status, 500, name);
    assert.equal(r.body.code, 'CONFIG_ERROR', name);
    assert.equal(p.calls.length, 0, `${name}: no model call`);
  }
  assert.ok(loadConfig({ ...BASE }).ok);
  assert.ok(loadConfig({ ...BASE, ENVIRONMENT: 'staging', AI_PROVIDER: 'workers-ai', AI_ENABLED: 'true', AI: { run() {} } }).ok);
});

test('wrangler.toml: staging name, no routes / account / production, fake provider, AI binding NOT enabled, KV placeholder', () => {
  const t = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const code = t.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.match(code, /^name = "anta-ai-discovery-staging"$/m);
  assert.equal(/^\s*(routes?|route|zone_id|zone_name|custom_domain|account_id)\s*=|^\s*\[\[?routes?\]|^\s*\[env\./m.test(code), false);
  assert.equal(/dairsharaf\.com|antastore1-82b50/.test(code), false);
  assert.equal(/^\s*\[ai\]/m.test(code), false, 'the Workers AI binding stays commented out until approved');
  assert.match(code, /^AI_PROVIDER = "fake"$/m);
  assert.match(code, /^AI_ENABLED = "false"$/m);
  assert.match(code, /^ENVIRONMENT = "staging"$/m);
  assert.match(code, /REPLACE_WITH_STAGING_AI_KV_NAMESPACE_ID/, 'cannot be deployed before the KV id is set on purpose');
  const vars = Object.fromEntries([...code.matchAll(/^([A-Z_]+) = "([^"]*)"$/gm)].map((m) => [m[1], m[2]]));
  assert.ok(loadConfig(vars).ok, 'the committed vars pass the guard');
});

test('entry module exports ONLY the default handler (the Workers runtime rejects other named exports)', async () => {
  const entry = await import('../src/index.js');
  assert.deepEqual(Object.keys(entry), ['default']);
  assert.equal(typeof entry.default.fetch, 'function');
  assert.equal(entry.default, worker);
});

// ------------------------------------------------------------------ HTTP surface
test('routes, methods, CORS and origin', async () => {
  const h = await worker.fetch(req(null, { method: 'GET', path: '/' }), BASE);
  assert.deepEqual(await h.json(), { ok: true, service: 'ai-discovery', environment: 'local', provider: 'fake' });
  assert.equal((await call({}, {}, { path: '/nope' })).status, 404);
  assert.equal((await worker.fetch(req(null, { method: 'GET' }), BASE)).status, 405);
  const pre = await worker.fetch(req(null, { method: 'OPTIONS' }), BASE);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal((await worker.fetch(req(null, { method: 'OPTIONS', origin: 'https://evil.example' }), BASE)).status, 403);
  assert.equal((await call({ query: 'لعبة' }, {}, { origin: null })).status, 403, 'no Origin -> refused');
  assert.equal((await call({ query: 'لعبة' }, {}, { origin: 'https://dairsharaf.com' })).status, 403);
  const ok = await call({ query: 'لعبة' });
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
});

test('input limits: JSON only, body <= 2 KB, query validated like the site (empty, too long, not text)', async () => {
  assert.equal((await call('{"query":"x"}', {}, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call(JSON.stringify({ query: 'ا'.repeat(MAX_BODY_BYTES) }))).status, 413);
  assert.equal((await call('{not json')).body.code, 'BAD_JSON');
  for (const q of ['', '   ', 42, null, 'ا'.repeat(301), '!!!']) {
    const r = await call({ query: q });
    assert.equal(r.status, 400, String(q).slice(0, 10));
    assert.equal(r.body.code, 'INVALID_QUERY');
  }
});

// ------------------------------------------------------------------ contract + privacy
test('fake provider: Jordanian request -> intent in the discovery contract only', async () => {
  const r = await call({ query: 'بدي هدية تعليمية لطفل عمره 7 سنوات بحدود 12 دينار' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.intent.budget, { min: null, max: 12, approximate: true });
  assert.deepEqual(r.body.intent.age.min, 7);
  assert.equal(r.body.intent.educational, true);
  for (const k of Object.keys(r.body.intent)) assert.ok(INTENT_PATCH_FIELDS.includes(k), k);
  assert.deepEqual(Object.keys(r.body).sort(), ['cached', 'intent', 'ok', 'provider']);
});

test('model output cannot add products, prices, stock or text (inject mode and a hostile spy)', async () => {
  const r = await call({ query: 'لعبة لبنت' }, { FAKE_MODE: 'inject' });
  assert.equal(r.status, 200);
  const s = JSON.stringify(r.body);
  for (const bad of ['منتج مخترع', '"price"', '"stock"', '"products"', 'اشتري']) assert.ok(!s.includes(bad), bad);
  const hostile = spyProvider({ categories: ['Games', 'Weapons'], products: [{ id: 'p' }], price: 1, keywords: ['<b>x</b>'], answer: 'buy' });
  const r2 = await call({ query: 'اشي حلو' }, {}, {}, { provider: hostile });
  assert.deepEqual(r2.body.intent, { categories: ['Games'], keywords: ['<b>x</b>'] });
});

test('personal data is removed BEFORE the model, and nothing of the request text reaches the logs', async () => {
  const q = 'بدي لعبة لابني رقمي 0791234567 او +962 79 765 4321 وايميلي ali.k@example.com https://x.example/a';
  const p = spyProvider({ categories: ['Games'] });
  let r;
  const logs = await logsOf(async () => { r = await call({ query: q }, {}, {}, { provider: p }); });
  assert.equal(r.status, 200);
  const sent = p.calls[0];
  for (const pii of ['0791234567', '765 4321', '7654321', 'ali.k@example.com', 'https://x.example']) assert.ok(!sent.includes(pii), `model got ${pii}`);
  assert.match(sent, /\[number\]/);
  assert.match(sent, /\[email\]/);
  for (const piece of ['0791234567', 'ali.k', 'لابني', 'لعبة', q]) assert.ok(!logs.includes(piece), `log contains "${piece}"`);
  assert.match(logs, /"event":"ok"/);
  assert.match(logs, /"redactions":4/);
  // budgets and ages are short numbers and stay
  assert.equal(redactPersonalData('لطفل 7 سنين بحدود 12 دينار').redactions, 0);
  assert.equal(redactPersonalData('هاتفي ٠٧٩١٢٣٤٥٦٧').redactions, 1, 'Arabic-Indic digits too');
});

test('model failures -> clear error status (the site then falls back to local search); logs stay text-free', async () => {
  const q = 'لعبة لبنت عمرها 5 سنين';
  const cases = [['error', 503, 'AI_UNAVAILABLE'], ['timeout', 504, 'AI_TIMEOUT'], ['garbage', 502, 'AI_EMPTY'], ['empty', 502, 'AI_EMPTY']];
  for (const [mode, status, code] of cases) {
    let r;
    const logs = await logsOf(async () => { r = await call({ query: q }, { FAKE_MODE: mode, AI_TIMEOUT_MS: '150' }); });
    assert.equal(r.status, status, mode);
    assert.equal(r.body.code, code, mode);
    assert.ok(!logs.includes('لعبة'), `${mode}: no text in logs`);
  }
});

// ------------------------------------------------------------------ cost controls
test('cache: same request (after normalization) -> one model call; cache hits do not count against the daily cap', async () => {
  const p = spyProvider({ categories: ['Games'] });
  const a = await call({ query: 'لعبه للبنت' }, { DAILY_AI_LIMIT: '1' }, {}, { provider: p });
  const b = await call({ query: 'لُعبة للبنت' }, { DAILY_AI_LIMIT: '1' }, {}, { provider: p });
  assert.equal(a.body.cached, false);
  assert.equal(b.body.cached, true);
  assert.equal(p.calls.length, 1);
});

test('daily cap on MODEL calls -> 429 DAILY_LIMIT without calling the model', async () => {
  const p = spyProvider({ categories: ['Games'] });
  const env = { DAILY_AI_LIMIT: '2' };
  assert.equal((await call({ query: 'لعبة 1 قطعه' }, env, {}, { provider: p })).status, 200);
  assert.equal((await call({ query: 'دفتر' }, env, {}, { provider: p })).status, 200);
  const r = await call({ query: 'شنطة' }, env, {}, { provider: p });
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'DAILY_LIMIT');
  assert.equal(p.calls.length, 2);
  // the next day the counter starts again
  const tomorrow = Date.now() + 24 * 3600 * 1000;
  assert.equal((await worker.fetch(req({ query: 'شنطة' }), { ...BASE, ...env }, {}, { provider: p, now: tomorrow })).status, 200);
});

test('rate limit per client (local fallback and the Cloudflare RATE_LIMITER binding)', async () => {
  const env = { RATE_LIMIT_PER_MIN: '3' };
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await call({ query: `دفتر رقم ${i}` }, env)).status);
  assert.deepEqual(codes, [200, 200, 200, 429]);
  const binding = { calls: 0, async limit() { binding.calls++; return { success: binding.calls <= 1 }; } };
  assert.equal((await call({ query: 'قلم' }, { RATE_LIMITER: binding })).status, 200);
  assert.equal((await call({ query: 'قلم احمر' }, { RATE_LIMITER: binding })).status, 429);
});

test('KV binding: stores only hashed keys + validated intents; daily counter in KV', async () => {
  const store = new Map();
  const kv = { async get(k) { return store.get(k) ?? null; }, async put(k, v) { store.set(k, v); } };
  const q = 'بدي ألوان لبنتي';
  await call({ query: q }, { AI_KV: kv });
  const keys = [...store.keys()];
  assert.ok(keys.some((k) => /^daily:\d{4}-\d{2}-\d{2}$/.test(k)));
  const cacheKeys = keys.filter((k) => k.startsWith('intent:'));
  assert.equal(cacheKeys.length, 1);
  assert.match(cacheKeys[0], /^intent:v1:fake:[0-9a-f]{64}$/);
  const stored = [...store.values()].join(' ');
  assert.ok(!stored.includes('ألوان') && !stored.includes('لبنتي'), 'no request text stored');
});

// ------------------------------------------------------------------ Workers AI adapter (FAKE binding — not a real model)
test('workers-ai adapter with a FAKE AI binding: redacted text only, JSON schema requested, output validated', async () => {
  const seen = [];
  const AI = { async run(model, input) { seen.push({ model, input }); return { response: 'Sure! {"categories":["ArtSupplies"],"price":3,"products":["x"],"age":{"min":5,"max":5}} done' }; } };
  const env = { ENVIRONMENT: 'staging', AI_PROVIDER: 'workers-ai', AI_ENABLED: 'true', AI };
  const r = await call({ query: 'ألوان لبنت عمرها 5 سنين رقمي 0799999999' }, env);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.intent, { age: { min: 5, max: 5, phrase: '' }, categories: ['ArtSupplies'] });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].model, '@cf/meta/llama-3.1-8b-instruct');
  assert.equal(seen[0].input.response_format.type, 'json_schema');
  const user = seen[0].input.messages.find((m) => m.role === 'user').content;
  assert.ok(!user.includes('0799999999'));
  const sentAll = JSON.stringify(seen[0].input);
  for (const p of MOCK_PRODUCTS) assert.ok(!(p.id && sentAll.includes(p.id)) && !(p.name && sentAll.includes(p.name)), `no catalog data sent (${p.id})`);
  assert.deepEqual(seen[0].input.messages.map((m) => m.role), ['system', 'user'], 'only the instruction + the redacted request');
  assert.equal(seen[0].input.max_tokens, 160, 'small default output budget');
  assert.equal(seen[0].input.temperature, 0);
  // the schema avoids union types (constrained decoding) and forbids extra fields at every level
  const walk = (s) => { assert.ok(!Array.isArray(s.type), 'no union types'); if (s.type === 'object') assert.equal(s.additionalProperties, false); for (const v of Object.values(s.properties ?? {})) walk(v); if (s.items) walk(s.items); };
  walk(seen[0].input.response_format.json_schema);
  const sys = seen[0].input.messages[0].content;
  assert.ok(sys.length < 700, `system prompt kept short (${sys.length} chars)`);
  await call({ query: 'قلم احمر' }, { ...env, AI_OUTPUT_LIMIT: '96' });
  assert.equal(seen.at(-1).input.max_tokens, 96, 'configurable output budget');
  const prose = { async run() { return { response: 'I cannot help with that.' }; } };
  assert.equal((await call({ query: 'دفتر' }, { ...env, AI: prose })).status, 502);
  const slow = { run: () => new Promise(() => {}) };
  assert.equal((await call({ query: 'شنطة' }, { ...env, AI: slow, AI_TIMEOUT_MS: '120' })).status, 504);
});

// ------------------------------------------------------------------ end to end with the site's discovery engine
const viaWorker = (env, deps = {}) => async (url, init) => worker.fetch(new Request(url, { ...init, headers: { ...init.headers, origin: ORIGIN } }), { ...BASE, ...env }, {}, deps);

test('site + Worker: an unclear request gets AI help as labelled hints; results are still real store products', async () => {
  const q = 'بدي اشي يلعب فيه ابني بالحديقه';
  const local = discoverProductsLocal(q, MOCK_PRODUCTS);
  assert.equal(local.status, 'no_results');
  const p = createRemoteIntentProvider({ endpoint: 'http://127.0.0.1:8799/ai/intent', fetchImpl: viaWorker({}, { provider: spyProvider({ categories: ['Games'] }) }) });
  const r = await discoverProducts(q, MOCK_PRODUCTS, { provider: p }); // default policy: called because the request is unclear
  assert.equal(r.ai.called, true);
  assert.equal(r.engine, 'ai+local');
  assert.deepEqual(r.intent.categories, [], 'an AI category is never a customer condition');
  assert.deepEqual(r.intent.aiHints.categories, ['Games']);
  const ids = new Set(MOCK_PRODUCTS.map((x) => x.id));
  assert.ok(r.results.length > 0);
  for (const x of r.results) {
    assert.ok(ids.has(x.id));
    assert.equal(MOCK_PRODUCTS.find((m) => m.id === x.id).category, 'Games');
    assert.equal(x.matchLevel, 'inferred', 'labelled "اقتراح تقريبي", never "مطابق للنوع المطلوب"');
  }
});

test('site + Worker: a clear request never reaches the AI Worker (default policy)', async () => {
  let hits = 0;
  const fetchImpl = async (...a) => { hits++; return viaWorker({})(...a); };
  const p = createRemoteIntentProvider({ endpoint: 'http://127.0.0.1:8799/ai/intent', fetchImpl });
  const q = 'بدي هدية تعليمية لطفل عمره 7 سنوات بحدود 12 دينار';
  const r = await discoverProducts(q, MOCK_PRODUCTS, { provider: p });
  assert.equal(hits, 0);
  assert.equal(r.ai.called, false);
  assert.deepEqual(r.results.map((x) => x.id), discoverProductsLocal(q, MOCK_PRODUCTS).results.map((x) => x.id));
});

test('site + Worker failing in every way: search still answers with the LOCAL result (store never blocked)', async () => {
  const q = 'بدي هدية تعليمية لطفل عمره 7 سنوات بحدود 12 دينار';
  const local = discoverProductsLocal(q, MOCK_PRODUCTS);
  const envs = [{ FAKE_MODE: 'error' }, { FAKE_MODE: 'timeout', AI_TIMEOUT_MS: '100' }, { FAKE_MODE: 'garbage' }, { ENVIRONMENT: 'production' }, { DAILY_AI_LIMIT: '1' }];
  _resetMemory();
  await worker.fetch(new Request('http://127.0.0.1:8799/ai/intent', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ query: 'دفتر' }) }), { ...BASE, DAILY_AI_LIMIT: '1' });
  for (const env of envs) {
    const p = createRemoteIntentProvider({ endpoint: 'http://127.0.0.1:8799/ai/intent', fetchImpl: viaWorker(env) });
    // 'always': force the call so each failure path is really exercised
    const r = await discoverProducts(q, MOCK_PRODUCTS, { provider: p, timeoutMs: 2000, aiPolicy: 'always' });
    assert.equal(r.status, 'ok', JSON.stringify(env));
    assert.equal(r.engine, 'local', JSON.stringify(env));
    assert.ok(r.aiFallbackReason, JSON.stringify(env));
    assert.deepEqual(r.results.map((x) => x.id), local.results.map((x) => x.id), JSON.stringify(env));
  }
  // network down entirely
  const down = createRemoteIntentProvider({ endpoint: 'http://127.0.0.1:8799/ai/intent', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  const r = await discoverProducts(q, MOCK_PRODUCTS, { provider: down, aiPolicy: 'always' });
  assert.equal(r.engine, 'local');
  assert.match(r.aiFallbackReason, /provider error/);
  assert.deepEqual(r.results.map((x) => x.id), local.results.map((x) => x.id));
});
