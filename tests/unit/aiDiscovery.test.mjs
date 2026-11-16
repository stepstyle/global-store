// AI Product Discovery — local unit tests. MOCK catalog (tests/fixtures), fake providers, no network.
//   node --test tests/unit/aiDiscovery.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeArabic, numberWordsToDigits } from '../../src/services/discovery/arabicText.ts';
import { parseDiscoveryQuery, DiscoveryInputError, MAX_QUERY_LENGTH, numbersInContext } from '../../src/services/discovery/intent.ts';
import { toCatalogItem, buildCatalog } from '../../src/services/discovery/catalog.ts';
import { STORE_CATEGORIES, SUBCATEGORY_LABEL_AR, CATEGORY_TERMS } from '../../src/services/discovery/lexicon.ts';
import { discoverProductsLocal, discoverProducts, createRemoteIntentProvider, sanitizeProviderIntent, discoverWithIntent, giftFinderIntent } from '../../src/services/discovery/index.ts';
import { MOCK_PRODUCTS } from '../fixtures/discoveryCatalog.mjs';
import { REAL_AI_RESPONSES } from '../fixtures/realAiResponses.mjs';
import { mergeIntent, needsAiHelp, cleanKeywordTokens } from '../../src/services/discovery/index.ts';

const MAIN = 'بدي هدية تعليمية لطفل عمره 7 سنوات بحدود 12 دينار';
const byId = Object.fromEntries(MOCK_PRODUCTS.map((p) => [p.id, p]));
const ids = (r) => r.results.map((x) => x.id);

// ------------------------------------------------------------------ text
test('normalization folds spelling variants, diacritics, tatweel and Arabic-Indic digits', () => {
  assert.equal(normalizeArabic('هَدِيّة'), normalizeArabic('هديه'));
  assert.equal(normalizeArabic('إلى أطفال'), 'الي اطفال');
  assert.equal(normalizeArabic('ألـــعاب'), 'العاب');
  assert.equal(normalizeArabic('١٢٫٥ دينار'), '12.5 دينار');
  assert.equal(numberWordsToDigits(normalizeArabic('سبع سنين بتلاتة دنانير')), '7 سنين ب 3 دنانير');
  assert.equal(numberWordsToDigits('5 ونص'), '5.5');
});

// ------------------------------------------------------------------ intent
const intentCases = [
  [MAIN, { budget: { min: null, max: 12, approximate: true }, age: [7, 7], occasions: ['gift'], educational: true, recipient: 'child', categories: [] }],
  ['بدي اشي لابني عمره سبع سنين ما بدي اكثر من 10 دنانير', { budget: { min: null, max: 10, approximate: false }, age: [7, 7], recipient: 'boy' }],
  ['هدية عيد ميلاد لبنتي ٥ سنين اقل من ١٥ دينار', { budget: { min: null, max: 15, approximate: false, maxExclusive: true }, age: [5, 5], recipient: 'girl', occasions: ['gift', 'birthday'] }],
  ['لعبة لطفل من 6 ل 8 سنوات بين 5 و 10 دنانير', { budget: { min: 5, max: 10, approximate: false }, age: [6, 8], categories: ['Games'] }],
  ['شنطة مدرسة لبنتي صف تالت', { age: [8, 9], categories: ['Bags'], subCategories: ['Bags/school'], recipient: 'girl' }],
  ['بدي اشي لرضيع عمره 6 شهور', { age: [0.5, 0.5], recipient: 'baby' }],
  ['ألوان خشب بحدود خمسة دنانير', { budget: { min: null, max: 5, approximate: true }, categories: ['ArtSupplies'], subCategories: ['ArtSupplies/colors'] }],
  ['عندكم عروض على الدفاتر؟', { wantsOffers: true, categories: ['Stationery'], subCategories: ['Stationery/notebooks'] }],
  ['educational toy for 7 years under 12 JD', { budget: { min: null, max: 12, approximate: false, maxExclusive: true }, age: [7, 7], educational: true, categories: ['Games'] }],
  ['بين 20 و 10 دنانير قلم', { budget: { min: 10, max: 20, approximate: false }, categories: ['Stationery'] }], // swapped -> ordered
];
for (const [q, want] of intentCases) {
  test(`intent: ${q}`, () => {
    const i = parseDiscoveryQuery(q);
    if ('budget' in want) assert.deepEqual(i.budget, want.budget);
    if ('age' in want) assert.deepEqual([i.age?.min, i.age?.max], want.age);
    for (const k of ['recipient', 'educational', 'wantsOffers']) if (k in want) assert.equal(i[k], want[k], k);
    for (const k of ['occasions', 'categories', 'subCategories']) if (k in want) assert.deepEqual([...i[k]].sort(), [...want[k]].sort(), k);
  });
}

test('intent: age numbers are never read as budget, and vice versa', () => {
  const i = parseDiscoveryQuery('لعبة لطفل عمره 7 سنوات');
  assert.equal(i.budget, null);
  assert.deepEqual([i.age.min, i.age.max], [7, 7]);
  const j = parseDiscoveryQuery('لعبة بحدود 7 دنانير');
  assert.equal(j.age, null);
  assert.equal(j.budget.max, 7);
});

test('intent: impossible budget / age are ignored with a warning (not guessed)', () => {
  const a = parseDiscoveryQuery('لعبة تحت 0 دينار');
  assert.equal(a.budget, null);
  assert.ok(a.warnings.some((w) => w.includes('الميزانية')));
  const b = parseDiscoveryQuery('لعبة بحدود 999999 دينار');
  assert.equal(b.budget, null);
  const c = parseDiscoveryQuery('هدية لعمر 150 سنه');
  assert.equal(c.age, null);
  assert.ok(c.warnings.some((w) => w.includes('العمر')));
});

test('invalid input: never throws from discover*, returns invalid_query with a message', async () => {
  for (const bad of [null, undefined, 42, {}, [], '', '    ', '???!!!', '\u0000\u0001', 'ا'.repeat(MAX_QUERY_LENGTH + 1)]) {
    const r = discoverProductsLocal(bad, MOCK_PRODUCTS);
    assert.equal(r.status, 'invalid_query', String(bad).slice(0, 20));
    assert.ok(r.message.length > 5);
    assert.deepEqual(r.results, []);
    assert.equal((await discoverProducts(bad, MOCK_PRODUCTS)).status, 'invalid_query');
  }
  assert.throws(() => parseDiscoveryQuery(''), DiscoveryInputError);
});

test('script / markup in the query is treated as text (no crash, no echo into results)', () => {
  const r = discoverProductsLocal('<img src=x onerror=alert(1)> لعبة', MOCK_PRODUCTS);
  assert.notEqual(r.status, 'invalid_query');
  for (const x of r.results) for (const line of [...x.reasons, ...x.caveats, ...x.missing]) assert.ok(!line.includes('<'));
});

// ------------------------------------------------------------------ catalog (store facts only)
test('catalog: price/stock from the cheapest IN-STOCK variant; unknown stock stays unknown; no price -> null', () => {
  const pc = toCatalogItem(byId['m-pencil-case']);
  assert.equal(pc.price, 4.25);
  assert.equal(pc.stock, 'in');
  assert.equal(toCatalogItem(byId['m-pens']).stock, 'unknown');
  assert.equal(toCatalogItem(byId['m-no-price']).price, null);
  assert.equal(toCatalogItem(byId['m-english-cards']).stock, 'out');
  const { items, skipped } = buildCatalog(MOCK_PRODUCTS);
  assert.equal(skipped, 1); // the record without a name
  assert.equal(items.length, MOCK_PRODUCTS.length - 1);
});

test('catalog: age only from store data, with its source', () => {
  assert.deepEqual(toCatalogItem(byId['m-math-cards']).age, { min: 6, max: 8, source: 'tags' });
  assert.deepEqual(toCatalogItem(byId['m-doll']).age, { min: 2, max: 3, source: 'subCategory' });
  assert.deepEqual(toCatalogItem(byId['m-science-kit']).age, { min: 7, max: 10, source: 'description' });
  assert.equal(toCatalogItem(byId['m-puzzle-edu']).age.min, 6);
  assert.equal(toCatalogItem(byId['m-car']).age, null);
  assert.equal(toCatalogItem(byId['m-water-colors']).age, null);
  // "100 ورقة" or "24 لون" are not ages
  assert.equal(toCatalogItem(byId['m-notebook-offer']).age, null);
  assert.equal(toCatalogItem(byId['m-wood-colors']).age, null);
});

// ------------------------------------------------------------------ ranking
test('main example: educational, age-compatible, within ~12 JD, best first, every reason backed by data', () => {
  const r = discoverProductsLocal(MAIN, MOCK_PRODUCTS);
  assert.equal(r.status, 'ok');
  assert.deepEqual(ids(r), ['m-math-cards', 'm-puzzle-edu', 'm-science-kit']);
  for (const x of r.results) {
    const p = byId[x.id];
    assert.ok(p, 'never an invented product');
    assert.equal(x.name, p.name);
    assert.ok(x.price <= 12 * 1.1);
    assert.ok(x.reasons.some((l) => l.startsWith('تعليمي حسب')));
    assert.ok(x.reasons.some((l) => l.startsWith('مناسب لعمر')));
  }
  const sci = r.results.find((x) => x.id === 'm-science-kit');
  assert.ok(sci.caveats.some((c) => c.includes('أعلى قليلًا')), 'over the approximate budget is said plainly');
  for (const x of r.results) assert.equal(x.matchLabel, 'يناسب شروط طلبك', 'no type was asked: "fits", not "exact"');
  // robot (24 JD) excluded by budget; the 0-price product is never recommended
  assert.ok(!ids(r).includes('m-robot-kit'));
  assert.ok(!ids(r).includes('m-no-price'));
  // the course (35 JD) is over budget; without a budget it is still not recommended: no age in the store data
  assert.ok(!ids(r).includes('m-course'));
  const noBudget = discoverProductsLocal('بدي هدية تعليمية لطفل عمره 7 سنوات', MOCK_PRODUCTS);
  assert.ok(!ids(noBudget).includes('m-course'));
  assert.ok(noBudget.unconfirmed.some((u) => u.id === 'm-course' && u.reason.startsWith('المعلومات غير كافية')));
});

test('prices in results are the store prices (incl. variant price) — never altered', () => {
  const r = discoverProductsLocal('مقلمة', MOCK_PRODUCTS);
  assert.equal(r.results[0].id, 'm-pencil-case');
  assert.equal(r.results[0].price, 4.25);
});

test('strict budget: "تحت 10" excludes 18 and 25; the reply explains with the cheapest real price', () => {
  const r = discoverProductsLocal('شنطة مدرسية تحت 10 دنانير', MOCK_PRODUCTS);
  assert.equal(r.status, 'no_results');
  assert.equal(r.excluded.overBudget, 2);
  assert.match(r.message, /أرخصها 18 دينار/);
});

test('out of stock: never recommended, listed separately; only-out-of-stock match -> alternatives flagged', () => {
  const r = discoverProductsLocal('بطاقات انجليزي', MOCK_PRODUCTS);
  assert.ok(!ids(r).includes('m-english-cards'));
  assert.deepEqual(r.unavailable.map((u) => u.id), ['m-english-cards']);
  assert.ok(r.results.length > 0);
  for (const x of r.results) {
    assert.equal(x.matchLevel, 'alternative', x.id);
    assert.equal(x.matchLabel, 'بديل قريب', x.id);
    assert.ok(x.caveats.some((c) => c.includes('بديل')), x.id);
    assert.ok(!('matchPercent' in x), 'no percentage is produced for the customer');
  }
  const b = discoverProductsLocal('حقيبة ظهر', MOCK_PRODUCTS);
  assert.ok(!ids(b).includes('m-backpack'));
  assert.ok(b.unavailable.some((u) => u.id === 'm-backpack'));
  assert.ok(b.results.every((x) => x.matchLevel === 'alternative'), 'school bags stand in for the backpack, labelled as such');
});

test('age known on both sides decides; an unknown age is NEVER recommended for a baby (listed as not confirmed)', () => {
  const r = discoverProductsLocal('لعبة لرضيع', MOCK_PRODUCTS);
  assert.deepEqual(ids(r), ['m-baby-rattle']);
  assert.ok(!ids(r).includes('m-puzzle-edu')); // 6+ vs baby
  assert.ok(!ids(r).includes('m-car'), 'the race car has no age in the store data');
  assert.ok(r.unconfirmed.some((u) => u.id === 'm-car' && u.reason.includes('العمر المناسب غير مذكور')));
});

test('unknown stock is never recommended (listed as not confirmed)', () => {
  const r = discoverProductsLocal('اقلام', MOCK_PRODUCTS);
  assert.ok(!ids(r).includes('m-pens'));
  assert.ok(r.unconfirmed.some((u) => u.id === 'm-pens' && u.reason.includes('التوفر غير مسجل')));
});

test('offers: only discounted items, with the real old and new price', () => {
  const r = discoverProductsLocal('عندكم عروض على الدفاتر؟', MOCK_PRODUCTS);
  assert.deepEqual(ids(r), ['m-notebook-offer']);
  assert.ok(r.results[0].reasons.some((l) => l.includes('كان 3 دينار وأصبح 2 دينار')));
});

test('broad request (who/age/budget, no product type): no unrelated lists; age-critical items need a confirmed age', () => {
  const r = discoverProductsLocal('بدي اشي لابني عمره سبع سنين ما بدي اكثر من 10 دنانير', MOCK_PRODUCTS);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.unavailable, [], 'no topic -> the backpack / English cards are not "matches"');
  assert.deepEqual(r.unconfirmed, [], 'no topic -> nothing to list as unconfirmed');
  assert.equal(ids(r)[0], 'm-math-cards');
  for (const x of r.results) {
    assert.ok(x.price <= 10, `${x.id} strict budget`);
    const it = toCatalogItem(byId[x.id]);
    if (!it.age) assert.ok(!['Games', 'EducationalCards', 'Courses'].includes(it.category), `${x.id}: a toy/card/course without age is not recommended`);
  }
});

test('gender label of the store is respected softly (caveat, lower rank), never hidden', () => {
  const r = discoverProductsLocal('بدي لعبة لبنت', MOCK_PRODUCTS);
  const got = ids(r);
  assert.ok(got.includes('m-car') && got.indexOf('m-car') === got.length - 1, `the boys-labelled car ranks last: ${got}`);
  assert.ok(r.results.find((x) => x.id === 'm-car').caveats.some((c) => c.includes('ألعاب ولادي')));
});

test('no results / needs more info / empty catalog', () => {
  assert.equal(discoverProductsLocal('بدي تلسكوب فلكي', MOCK_PRODUCTS).status, 'no_results');
  assert.equal(discoverProductsLocal('مرحبا', MOCK_PRODUCTS).status, 'needs_more_info');
  const e = discoverProductsLocal(MAIN, []);
  assert.equal(e.status, 'no_results');
  assert.match(e.message, /لا توجد منتجات في بيانات المتجر/);
  assert.equal(discoverProductsLocal(MAIN, null).status, 'no_results'); // bad product list is tolerated
});

test('deterministic and fast on a large catalog (5000 products)', () => {
  const big = Array.from({ length: 5000 }, (_, i) => ({ ...MOCK_PRODUCTS[i % 20], id: `big-${i}` }));
  const t0 = performance.now();
  const a = discoverProductsLocal(MAIN, big);
  const ms = performance.now() - t0;
  const b = discoverProductsLocal(MAIN, big);
  assert.deepEqual(ids(a), ids(b));
  assert.ok(a.results.length <= 12);
  assert.ok(ms < 2000, `took ${ms.toFixed(0)} ms`);
});

// ------------------------------------------------------------------ AI provider adapter (fakes only)
const provider = (fn) => ({ id: 'fake', extractIntent: fn });

test('AI guesses are hints, never conditions: local understanding kept; categories reorder but do not filter', async () => {
  const q = 'بدي اشي لطفل بحدود 12 دينار';
  const local = discoverProductsLocal(q, MOCK_PRODUCTS);
  const r = await discoverProducts(q, MOCK_PRODUCTS, {
    aiPolicy: 'always',
    provider: provider(async () => ({ categories: ['EducationalCards'], budget: { max: 500 }, educational: true })),
  });
  assert.equal(r.engine, 'ai+local');
  assert.deepEqual(r.intent.categories, [], 'an AI category is not a customer condition');
  assert.deepEqual(r.intent.aiHints.categories, ['EducationalCards']);
  assert.equal(r.intent.budget.max, 12, 'local budget kept');
  assert.equal(r.intent.educational, false, 'AI "educational" does not become a requirement');
  assert.ok(r.ai.ignored.some((s) => s.startsWith('budget')));
  // same products as without AI (nothing hidden), only reordered, and no level upgrade
  assert.deepEqual(new Set(ids(r)), new Set(ids(local)));
  assert.equal(byId[r.results[0].id].category, 'EducationalCards', 'the hint lifts matching products');
  for (const x of r.results) assert.notEqual(x.matchLevel, 'exact');
});

test('AI output cannot inject products, prices or text: unknown fields dropped, results only from the catalog', async () => {
  const evil = {
    products: [{ id: 'fake-1', name: 'منتج مخترع', price: 1 }], price: 0.01, message: 'اشتري الآن',
    categories: ['Games', 'Weapons', 42], subCategories: ['Games/edu', '../../etc'], keywords: ['<script>', 'x'.repeat(200)], age: { min: 9, max: 3 },
  };
  assert.deepEqual(sanitizeProviderIntent(evil), { categories: ['Games'], subCategories: ['Games/edu'], keywords: ['<script>'] });
  const r = await discoverProducts('بدي اشي حلو', MOCK_PRODUCTS, { provider: provider(async () => evil), aiPolicy: 'always' });
  for (const x of r.results) assert.ok(byId[x.id], 'every result is a store product');
  assert.ok(!JSON.stringify(r).includes('منتج مخترع'));
});

test('AI failure modes fall back to local search with a reason', async () => {
  const local = discoverProductsLocal(MAIN, MOCK_PRODUCTS);
  const cases = [
    ['throws', provider(async () => { throw new Error('boom'); }), /provider error/],
    ['garbage', provider(async () => 'not json'), /empty or invalid/],
    ['null', provider(async () => null), /empty or invalid/],
    ['slow', provider((q, { signal }) => new Promise((res) => { const t = setTimeout(() => res({}), 5000); signal.addEventListener('abort', () => clearTimeout(t)); })), /timeout/],
  ];
  for (const [name, p, re] of cases) {
    // 'always': force the call so the failure path itself is exercised
    const r = await discoverProducts(MAIN, MOCK_PRODUCTS, { provider: p, timeoutMs: 150, aiPolicy: 'always' });
    assert.equal(r.engine, 'local', name);
    assert.match(r.aiFallbackReason, re, name);
    assert.deepEqual(ids(r), ids(local), `${name}: same results as local`);
  }
});

test('no provider configured = local only, no AI call', async () => {
  const r = await discoverProducts(MAIN, MOCK_PRODUCTS);
  assert.equal(r.engine, 'local');
  assert.equal(r.aiFallbackReason, null);
});

test('remote provider: https or http://127.0.0.1 only; posts {query, categories}; fake fetch, no network', async () => {
  assert.throws(() => createRemoteIntentProvider({ endpoint: 'http://example.com/ai' }), /https/);
  assert.throws(() => createRemoteIntentProvider({ endpoint: 'https://u:p@example.com/ai' }), /https/);
  assert.throws(() => createRemoteIntentProvider({ endpoint: 'not a url' }), /valid URL/);
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ intent: { categories: ['ArtSupplies'] } }) };
  };
  const p = createRemoteIntentProvider({ endpoint: 'https://worker.example.invalid/ai/intent', fetchImpl: fakeFetch });
  const r = await discoverProducts('بدي اشي لبنتي', MOCK_PRODUCTS, { provider: p, aiPolicy: 'always' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'error');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.query, 'بدي اشي لبنتي');
  assert.deepEqual(body.categories, [...STORE_CATEGORIES]);
  assert.deepEqual(r.intent.aiHints.categories, ['ArtSupplies'], 'received as a hint');
  const down = createRemoteIntentProvider({ endpoint: 'https://worker.example.invalid/ai/intent', fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  const r2 = await discoverProducts(MAIN, MOCK_PRODUCTS, { provider: down, aiPolicy: 'always' });
  assert.equal(r2.engine, 'local');
  assert.match(r2.aiFallbackReason, /provider error/);
});

// ------------------------------------------------------------------ taxonomy stays in sync with the store
test('discovery categories / subCategory slugs exist in src/constants.ts', () => {
  const constants = readFileSync(new URL('../../src/constants.ts', import.meta.url), 'utf8');
  for (const c of STORE_CATEGORIES) assert.match(constants, new RegExp(`id: '${c}'`), c);
  const slugs = new Set([...constants.matchAll(/value: '([^']+)'/g)].map((m) => m[1]));
  for (const slug of Object.keys(SUBCATEGORY_LABEL_AR)) assert.ok(slugs.has(slug), `slug ${slug}`);
  for (const t of CATEGORY_TERMS) if (t.sub) for (const s of t.sub.split('|')) assert.ok(slugs.has(s), `term ${t.phrase} -> ${s}`);
});

// ------------------------------------------------------------------ acceptance: 28 varied customer requests
// Expectations are properties a correct answer must have (not a snapshot): status, products that MUST / MUST NOT
// appear, hard limits (budget, exclusions), the first result when it is unambiguous, and the out-of-stock list.
const priceOf = (id) => toCatalogItem(byId[id]).price;
const ACCEPTANCE = [
  { q: MAIN, status: 'ok', first: 'm-math-cards', has: ['m-puzzle-edu'], not: ['m-robot-kit', 'm-no-price', 'm-car', 'm-course'], out: ['m-english-cards'], maxPrice: 13.2 },
  { q: 'بدي اشي لابني عمره سبع سنين ما بدي اكثر من 10 دنانير', status: 'ok', first: 'm-math-cards', not: ['m-baby-rattle', 'm-doll', 'm-puzzle-edu', 'm-car'], maxPrice: 10, outEmpty: true },
  { q: 'ألعاب أقل من 10 دنانير', status: 'ok', has: ['m-baby-rattle', 'm-doll', 'm-car'], not: ['m-puzzle-edu', 'm-no-price'], maxPrice: 10, onlyCats: ['Games'] },
  { q: 'شنطة مدرسية أقل من 10 دنانير', status: 'no_results', message: /أرخصها 18 دينار/ },
  { q: 'شنطة مدرسة لبنتي صف تالت تحت 20 دينار', status: 'ok', first: 'm-bag-girls', not: ['m-bag-big'], maxPrice: 20 },
  { q: 'بطاقات انجليزي', status: 'ok', not: ['m-english-cards'], out: ['m-english-cards'], allAlternatives: true },
  { q: 'حقيبة ظهر', status: 'ok', not: ['m-backpack'], out: ['m-backpack'], allAlternatives: true },
  { q: 'عندكم عروض على الدفاتر؟', status: 'ok', exactly: ['m-notebook-offer'] },
  { q: 'بدي هدية لبنت عمرها 6 سنين بس مش لعبة', status: 'ok', first: 'm-math-cards', noCats: ['Games'] },
  { q: 'هدية لابني بدون الوان ولا قرطاسية تحت 15 دينار', status: 'ok', noCats: ['Stationery'], not: ['m-wood-colors', 'm-water-colors'], maxPrice: 15 },
  { q: 'ما بدي شنطة، بدي اشي تعليمي لطفل 5 سنين', status: 'ok', first: 'm-arabic-cards', noCats: ['Bags'], not: ['m-course'], unconfirmed: ['m-course'] },
  { q: 'لعبة لرضيع عمره 6 شهور', status: 'ok', exactly: ['m-baby-rattle'], unconfirmed: ['m-car'] },
  { q: 'ألوان خشب بحدود خمسة دنانير', status: 'ok', first: 'm-wood-colors', not: ['m-water-colors'], maxPrice: 5.5 },
  { q: 'صلصال لطفل 4 سنين', status: 'ok', exactly: ['m-clay'] },
  { q: 'بدي دفتر وقلم', status: 'ok', exactly: ['m-notebook-offer'], unconfirmed: ['m-pens'], needs: ['دفاتر', 'أقلام'] },
  { q: 'مقلمة', status: 'ok', exactly: ['m-pencil-case'] },
  { q: 'اقلام حبر رخيصة', status: 'no_results', unconfirmed: ['m-pens'], message: /لا تؤكد بيانات المتجر مناسبته/ },
  { q: 'بازل للصف الاول', status: 'ok', first: 'm-puzzle-edu', not: ['m-baby-rattle', 'm-doll'] },
  { q: 'هدية عيد ميلاد لبنتي 3 سنين بين 5 و 10 دنانير', status: 'ok', has: ['m-doll', 'm-clay'], not: ['m-baby-rattle', 'm-puzzle-edu', 'm-water-colors'], minPrice: 5, maxPrice: 10 },
  { q: 'رجعة المدارس لابني صف خامس', status: 'ok', has: ['m-notebook-offer', 'm-bag-girls'], not: ['m-clay', 'm-wood-colors', 'm-puzzle-edu', 'm-robot-kit'], needs: ['دفاتر', 'أقلام', 'شنط مدرسية'] },
  { q: 'شي للبيبي', status: 'ok', first: 'm-baby-rattle', not: ['m-puzzle-edu', 'm-robot-kit', 'm-math-cards'] },
  { q: 'دورة برمجة لابني', status: 'ok', first: 'm-course' },
  { q: 'روبوت برمجة تحت 30 دينار', status: 'ok', first: 'm-robot-kit', not: ['m-course'], maxPrice: 30 },
  { q: 'بطاقات حروف عربي لطفلة 4 سنين', status: 'ok', first: 'm-arabic-cards', not: ['m-math-cards'] },
  { q: 'بدي تلسكوب فلكي', status: 'no_results' },
  { q: 'مرحبا', status: 'needs_more_info' },
  { q: 'لعبة بحدود 2 دينار', status: 'no_results', message: /أغلى من ميزانيتك/ },
  { q: 'هدية تخرج لاستاذة', status: 'ok', not: ['m-baby-rattle', 'm-doll', 'm-math-cards', 'm-arabic-cards', 'm-car', 'm-puzzle-edu', 'm-robot-kit', 'm-bag-girls', 'm-bag-big'], maxResults: 3, clarification: true },
];
test(`acceptance: ${ACCEPTANCE.length} customer requests (Arabic + Jordanian; budget, age, gifts, negation, out of stock)`, () => {
  assert.ok(ACCEPTANCE.length >= 20);
  for (const c of ACCEPTANCE) {
    const r = discoverProductsLocal(c.q, MOCK_PRODUCTS);
    const got = ids(r);
    const tag = `«${c.q}» -> [${got.join(', ')}]`;
    assert.equal(r.status, c.status, tag);
    if (c.first) assert.equal(got[0], c.first, tag);
    for (const id of c.has ?? []) assert.ok(got.includes(id), `${tag} must include ${id}`);
    for (const id of c.not ?? []) assert.ok(!got.includes(id), `${tag} must NOT include ${id}`);
    if (c.exactly) assert.deepEqual(got, c.exactly, tag);
    if (c.out) assert.deepEqual(r.unavailable.map((u) => u.id), c.out, tag);
    if (c.outEmpty) assert.deepEqual(r.unavailable, [], tag);
    if (c.message) assert.match(r.message, c.message, tag);
    for (const id of c.unconfirmed ?? []) assert.ok(r.unconfirmed.some((u) => u.id === id), `${tag}: ${id} must be listed as not confirmed`);
    if (c.needs) assert.deepEqual(r.needs.map((n) => n.label), c.needs, tag);
    if (c.maxResults) assert.ok(r.results.length <= c.maxResults, `${tag}: at most ${c.maxResults}`);
    if (c.clarification) assert.ok(r.clarification?.question, `${tag}: one clarifying question`);
    for (const x of r.results) {
      assert.ok(['exact', 'fits', 'alternative'].includes(x.matchLevel) && x.matchLabel, `${tag}: plain-language level`);
      assert.ok(!('matchPercent' in x), `${tag}: no percentage`);
      const p = byId[x.id];
      assert.ok(p, `${tag}: invented product ${x.id}`);
      assert.equal(x.price, priceOf(x.id), `${tag}: price of ${x.id} must be the store price`);
      assert.notEqual(toCatalogItem(p).stock, 'out', `${tag}: out-of-stock ${x.id} recommended`);
      if (c.maxPrice != null) assert.ok(x.price <= c.maxPrice + 1e-9, `${tag}: ${x.id} over budget`);
      if (c.minPrice != null) assert.ok(x.price >= c.minPrice - 1e-9, `${tag}: ${x.id} under the minimum`);
      if (c.noCats) assert.ok(!toCatalogItem(p).categories.some((k) => c.noCats.includes(k)), `${tag}: excluded category ${x.id}`);
      if (c.onlyCats) assert.ok(toCatalogItem(p).categories.some((k) => c.onlyCats.includes(k)), `${tag}: ${x.id} outside ${c.onlyCats}`);
      if (c.allAlternatives) assert.ok(x.caveats.some((t) => t.includes('بديل')) && x.matchLevel === 'alternative', `${tag}: ${x.id} must be flagged as an alternative`);
      if ((c.notAlternative ?? []).includes(x.id)) assert.ok(!x.caveats.some((t) => t.includes('بديل')), `${tag}: ${x.id} wrongly flagged as alternative`);
    }
  }
});

test('negation: "مش" / "بدون" / "ما بدي" / "ولا" exclude, never include', () => {
  const a = parseDiscoveryQuery('بدي هدية مش لعبة');
  assert.deepEqual(a.excludeCategories, ['Games']);
  assert.deepEqual(a.categories, []);
  const b = parseDiscoveryQuery('بدون الوان ولا قرطاسية');
  assert.deepEqual(b.excludeCategories, ['Stationery']);
  assert.deepEqual(b.excludeSubCategories, ['ArtSupplies/colors']);
  const c = parseDiscoveryQuery('ما بدي شنطة بدي لعبة');
  assert.deepEqual(c.excludeCategories, ['Bags']);
  assert.deepEqual(c.categories, ['Games']);
  const d = parseDiscoveryQuery('لعبة مش تعليمية');
  assert.equal(d.educational, false);
  assert.ok(!parseDiscoveryQuery('مش لعبة').keywords.includes('مش'));
});

// ------------------------------------------------------------------ gift finder (SmartFinder) on the same engine
test('gift finder: answers -> intent with ONLY what was chosen (no budget, no age from "who")', () => {
  const i = giftFinderIntent({ who: 'boy', age: '4-7', interest: 'art' });
  assert.equal(i.budget, null);
  assert.deepEqual([i.age.min, i.age.max], [4, 7]);
  assert.equal(i.recipient, 'boy');
  assert.deepEqual(i.categories, ['ArtSupplies', 'Stationery']);
  assert.deepEqual(i.occasions, ['gift']);
  const baby = giftFinderIntent({ who: 'baby' });
  assert.equal(baby.age, null, '"بيبي" alone does not invent an age');
  const junk = giftFinderIntent({ who: 'robot', age: '200', interest: 'hacking' });
  assert.equal(junk.recipient, null);
  assert.equal(junk.age, null);
  assert.deepEqual(junk.categories, []);
});

test('gift finder results: real store products, age-compatible, stable order (no shuffle), same engine as free text', () => {
  const cases = [
    [{ who: 'girl', age: '2-3', interest: 'fun' }, (p) => p.categories.includes('Games')],
    [{ who: 'baby', age: '0-1', interest: 'fun' }, (p) => p.categories.includes('Games')],
    [{ who: 'boy', age: '8-12', interest: 'educational' }, (p) => p.educational !== null],
    [{ who: 'boy', age: '4-7', interest: 'art' }, (p) => p.categories.some((c) => c === 'ArtSupplies' || c === 'Stationery')],
  ];
  for (const [answers, belongs] of cases) {
    const intent = giftFinderIntent(answers);
    const runs = Array.from({ length: 5 }, () => discoverWithIntent(intent, MOCK_PRODUCTS, { limit: 6 }).results.map((x) => x.id));
    for (const run of runs) assert.deepEqual(run, runs[0], `${JSON.stringify(answers)}: same order every time`);
    const res = discoverWithIntent(intent, MOCK_PRODUCTS, { limit: 6 });
    assert.equal(res.status, 'ok', JSON.stringify(answers));
    const age = intent.age;
    for (const x of res.results) {
      const it = toCatalogItem(byId[x.id]);
      assert.ok(byId[x.id] && x.price === it.price && it.stock !== 'out', x.id);
      assert.ok(belongs(it), `${JSON.stringify(answers)}: ${x.id} does not match the chosen interest`);
      if (it.age) assert.ok(it.age.max >= age.min && it.age.min <= age.max, `${x.id} age`);
      else {
        assert.ok(age.max >= 4, `${x.id}: under 4 an unknown age is never recommended`);
        assert.ok(!['Games', 'EducationalCards', 'Courses'].includes(it.category), `${x.id}: toy/card/course without age not recommended`);
      }
    }
  }
  // free text with the same meaning goes through the same gates: identical products
  const finder = discoverWithIntent(giftFinderIntent({ who: 'girl', age: '2-3', interest: 'fun' }), MOCK_PRODUCTS).results.map((x) => x.id);
  const text = discoverProductsLocal('هدية لعبة لبنت عمرها من 2 ل 3 سنين', MOCK_PRODUCTS).results.map((x) => x.id);
  assert.deepEqual(new Set(text), new Set(finder));
  assert.deepEqual(finder, ['m-doll'], 'rattle (up to 9 months) is too young, the car has no age');
});

test('gift finder "0-3" and free text "0 to 3": a clarifying question, never a guess (same rule in both)', () => {
  const f = discoverWithIntent(giftFinderIntent({ who: 'baby', age: '0-3', interest: 'educational' }), MOCK_PRODUCTS);
  const t = discoverProductsLocal('لعبة لطفل من 0 ل 3 سنين', MOCK_PRODUCTS);
  for (const r of [f, t]) {
    assert.equal(r.status, 'needs_more_info');
    assert.deepEqual(r.results, []);
    assert.ok(r.clarification.question.includes('العمر') || r.clarification.question.includes('عمر'));
    assert.deepEqual(r.clarification.options, ['أقل من سنة', 'من سنة إلى سنتين', 'من سنتين إلى 3 سنوات']);
  }
  // the follow-up answers each give a confirmed-age answer
  const baby = discoverWithIntent(giftFinderIntent({ who: 'baby', age: '0-1', interest: 'fun' }), MOCK_PRODUCTS);
  assert.deepEqual(ids(baby), ['m-baby-rattle']);
  const edu = discoverWithIntent(giftFinderIntent({ who: 'baby', age: '0-1', interest: 'educational' }), MOCK_PRODUCTS);
  assert.equal(edu.status, 'no_results', 'no educational product is confirmed for under 1 year — saying so beats a guess');
  assert.ok(!ids(edu).includes('m-course'));
});

test('SmartFinder.tsx: uses the discovery engine; no random shuffle, fake delay or "AI is choosing" claim', () => {
  const src = readFileSync(new URL('../../src/components/SmartFinder.tsx', import.meta.url), 'utf8');
  assert.match(src, /from '\.\.\/services\/discovery\/index\.ts'/);
  assert.match(src, /discoverWithIntent\(giftFinderIntent\(answers\)/);
  assert.equal(/Math\.random/.test(src), false, 'no random order');
  assert.equal(/isAnalyzing/.test(src), false, 'no fake analysing delay');
  assert.equal(/الذكاء الاصطناعي|our AI|let our AI/i.test(src), false, 'no claim that an AI model is choosing');
  assert.match(src, /navigate\(`\/product\/\$\{p\.id\}`\)/, 'product links kept');
  assert.equal(/matchPercent|%<\//.test(src), false, 'no percentage shown to the customer');
  assert.match(src, /p\.matchLabel/, 'plain-language match level shown');
  assert.match(src, /'ageDetail'/, '"0-3" asks the exact age');
});

// ------------------------------------------------------------------ quality gates (focused cases)
const extra = (p) => [...MOCK_PRODUCTS, ...p]; // test-only additions — the shared fixture file is not changed

test('quality — babies: no age in the data = not recommended, whatever the name, gender or category says', () => {
  const named = { id: 't-named-baby', name: 'لعبة للرضع ناعمة', nameEn: 'Soft Baby Toy', price: 5, category: 'Games', subCategory: 'girls', stock: 4, image: '', description: '', rating: 0, reviews: 0 };
  const r = discoverProductsLocal('لعبة لبنتي الرضيعة عمرها 8 شهور', extra([named]));
  assert.ok(!ids(r).includes('t-named-baby'), 'a name saying "للرضع" is not a confirmed age');
  assert.ok(r.unconfirmed.some((u) => u.id === 't-named-baby'));
  assert.deepEqual(ids(r), ['m-baby-rattle']);
  // a 2-year-old: the toy must already suit age 2 (the rattle stops at 9 months)
  const two = discoverProductsLocal('لعبة لطفل عمره سنتين', MOCK_PRODUCTS);
  assert.deepEqual(ids(two), ['m-doll']);
  // "3+" is not for a 2-year-old even though the range "overlaps" at 3
  const clay = discoverProductsLocal('صلصال لطفل عمره سنتين', MOCK_PRODUCTS);
  assert.ok(!ids(clay).includes('m-clay'));
});

test('quality — adults: no children\'s products (by category, slug, words or age); few results + one question', () => {
  const kidStationery = { id: 't-kid-pen', name: 'قلم للاطفال', nameEn: 'Pen for kids', price: 2, category: 'Stationery', subCategory: 'pens', stock: 9, image: '', description: '', rating: 0, reviews: 0 };
  for (const q of ['هدية تخرج لاستاذة', 'هدية لموظف بحدود 20 دينار', 'هدية لمعلمة']) {
    const r = discoverProductsLocal(q, extra([kidStationery]));
    assert.equal(r.status, 'ok', q);
    assert.ok(r.results.length <= 3, `${q}: limited`);
    assert.ok(r.clarification, `${q}: asks one question`);
    for (const x of r.results) assert.equal(toCatalogItem(extra([kidStationery]).find((p) => p.id === x.id)).forChildren, null, `${q}: ${x.id} is a children's product`);
    assert.ok(!ids(r).includes('t-kid-pen'), `${q}: "للاطفال" in the name`);
  }
});

test('quality — stationery types: the named type only; sharing the category is not a match', () => {
  assert.deepEqual(ids(discoverProductsLocal('مقلمة', MOCK_PRODUCTS)), ['m-pencil-case']);
  const ruler = discoverProductsLocal('مسطرة', MOCK_PRODUCTS);
  assert.equal(ruler.status, 'no_results', 'no ruler in the store: notebooks/pens are not offered instead');
  const pens = discoverProductsLocal('اقلام حبر', MOCK_PRODUCTS);
  assert.equal(pens.status, 'no_results', 'the only pens have unknown stock; a notebook is not a substitute');
  assert.ok(pens.unconfirmed.some((u) => u.id === 'm-pens'));
});

test('quality — several products in one request: answered per type, never "one product covers it all"', () => {
  const r = discoverProductsLocal('بدي دفتر وقلم', MOCK_PRODUCTS);
  assert.deepEqual(r.needs.map((n) => [n.label, n.found]), [['دفاتر', 1], ['أقلام', 0]]);
  assert.match(r.message, /«دفاتر»: 1/);
  assert.match(r.message, /«أقلام»: لا يوجد منتج مؤكد/);
  for (const x of r.results) assert.equal(x.forNeed, 'دفاتر');
  const two = discoverProductsLocal('شنطة ومقلمة', MOCK_PRODUCTS);
  assert.deepEqual(two.needs.map((n) => n.label), ['حقائب', 'مقلمة']);
  const by = Object.groupBy(two.results, (x) => x.forNeed);
  assert.ok(by['حقائب']?.length >= 1 && by['مقلمة']?.length === 1, JSON.stringify(Object.keys(by)));
});

test('quality — back to school: notebooks, pens and school bags first; not clay, colors or toys', () => {
  const r = discoverProductsLocal('رجعة المدارس', MOCK_PRODUCTS);
  assert.deepEqual(r.needs.map((n) => n.label), ['دفاتر', 'أقلام', 'شنط مدرسية']);
  for (const x of r.results) assert.ok(['m-notebook-offer', 'm-bag-girls', 'm-bag-big'].includes(x.id), x.id);
});

test('quality — misleading categories: a toy labelled for boys, a backpack vs school bags, an alternative never "exact"', () => {
  const b = discoverProductsLocal('شنطة مدرسية', MOCK_PRODUCTS);
  for (const x of b.results) assert.equal(x.matchLevel, 'exact', x.id);
  const bp = discoverProductsLocal('حقيبة ظهر', MOCK_PRODUCTS);
  for (const x of bp.results) assert.equal(x.matchLevel, 'alternative', x.id);
  const s = discoverProductsLocal('صلصال', MOCK_PRODUCTS);
  assert.deepEqual(ids(s), ['m-clay'], 'colors are not offered as "clay"');
});

test('quality — missing age data: a toy/card/course without age is never recommended for an age request', () => {
  for (const q of ['لعبة لطفل 5 سنين', 'هدية تعليمية لطفل عمره 9 سنوات', 'لعبة لبنت 4 سنين']) {
    const r = discoverProductsLocal(q, MOCK_PRODUCTS);
    for (const x of r.results) {
      const it = toCatalogItem(byId[x.id]);
      if (['Games', 'EducationalCards', 'Courses'].includes(it.category)) assert.ok(it.age, `${q}: ${x.id} has no age in the data`);
    }
  }
});

test('quality — free text and SmartFinder pass through the SAME gates (structured vs text intent)', () => {
  const pairs = [
    [{ who: 'boy', age: '8-12', interest: 'educational' }, 'هدية تعليمية لولد عمره من 8 ل 12 سنة'],
    [{ who: 'girl', age: '2-3', interest: 'fun' }, 'هدية لعبة لبنت عمرها من 2 ل 3 سنين'],
  ];
  for (const [answers, text] of pairs) {
    const a = new Set(ids(discoverWithIntent(giftFinderIntent(answers), MOCK_PRODUCTS)));
    const b = new Set(ids(discoverProductsLocal(text, MOCK_PRODUCTS)));
    assert.deepEqual(a, b, `${JSON.stringify(answers)} vs «${text}»`);
  }
});

// ------------------------------------------------------------------ AI merge: the two REAL Workers AI answers (replayed)
const replay = (intent) => { const p = { id: 'replay', calls: 0, async extractIntent() { p.calls++; return intent; } }; return p; };
const CONDITION_FIELDS = ['budget', 'recipient', 'occasions', 'categories', 'subCategories', 'excludeCategories', 'educational', 'wantsOffers'];
const conditionsOf = (i) => Object.fromEntries([...CONDITION_FIELDS.map((k) => [k, i[k]]), ['age', i.age && [i.age.min, i.age.max]]]);
const shown = (r) => r.results.map((x) => [x.id, x.price, x.matchLevel, x.matchLabel]);

test('real AI answer #1 (educational gift, 7 years, ~12 JD): nothing misleading after the merge', async () => {
  const real = REAL_AI_RESPONSES[0];
  const local = discoverProductsLocal(real.query, MOCK_PRODUCTS);
  const r = await discoverProducts(real.query, MOCK_PRODUCTS, { provider: replay(real.intent), aiPolicy: 'always' });
  // the customer's own conditions are untouched: budget 12 (the model missed it), age 7, gift, educational
  assert.deepEqual(conditionsOf(r.intent), conditionsOf(local.intent));
  assert.deepEqual(r.intent.budget, { min: null, max: 12, approximate: true });
  assert.deepEqual(r.intent.occasions, ['gift']);
  assert.equal(r.intent.educational, true);
  assert.equal(r.intent.provenance.budget, 'stated');
  // the AI categories are hints only; its keywords ("هدية تعليمية", "طفل", "دينار 12") are all cleaned away
  assert.deepEqual(r.intent.aiHints.categories, ['EducationalCards', 'Games']);
  assert.deepEqual(r.intent.aiHints.keywords, []);
  assert.deepEqual(r.intent.keywords, []);
  assert.ok(r.ai.ignored.includes('age (local understanding kept)'));
  assert.ok(r.ai.ignored.includes('keywords (no useful word after cleaning)'));
  // the bug of the real test: products must NOT become "مطابق للنوع المطلوب" — same products, prices and labels as local
  assert.deepEqual(shown(r), shown(local));
  for (const x of r.results) assert.equal(x.matchLabel, 'يناسب شروط طلبك');
  assert.deepEqual(r.unavailable, local.unavailable);
  assert.deepEqual(r.unconfirmed, local.unconfirmed);
});

test('real AI answer #2 (gift for a teacher, no children\'s toys): local negation/recipient kept, AI adds nothing', async () => {
  const real = REAL_AI_RESPONSES[1];
  const local = discoverProductsLocal(real.query, MOCK_PRODUCTS);
  const r = await discoverProducts(real.query, MOCK_PRODUCTS, { provider: replay(real.intent), aiPolicy: 'always' });
  assert.deepEqual(conditionsOf(r.intent), conditionsOf(local.intent));
  assert.equal(r.intent.recipient, 'adult');
  assert.deepEqual(r.intent.excludeCategories, ['Games']);
  assert.deepEqual(r.intent.occasions, ['gift'], 'the model missed the gift; the local reading keeps it');
  assert.equal(r.intent.aiHints, undefined, 'everything the model said was already understood locally');
  assert.equal(r.engine, 'local');
  assert.match(r.aiFallbackReason, /added nothing/);
  assert.deepEqual(shown(r), shown(local));
  assert.ok(r.results.length <= 3 && r.clarification, 'still limited + one question');
});

test('the two real requests are clear: with the default policy AI is NOT called (no cost, no latency)', async () => {
  for (const real of REAL_AI_RESPONSES) {
    const p = replay(real.intent);
    const local = discoverProductsLocal(real.query, MOCK_PRODUCTS);
    assert.equal(needsAiHelp(local.intent), false, real.query);
    const r = await discoverProducts(real.query, MOCK_PRODUCTS, { provider: p });
    assert.equal(p.calls, 0, `${real.query}: no AI call`);
    assert.equal(r.ai.called, false);
    assert.equal(r.ai.skippedReason, 'request understood locally');
    assert.deepEqual(shown(r), shown(local));
  }
  // a really unclear request does call it (once)
  const p = replay({ categories: ['Games'] });
  const r = await discoverProducts('بدي اشي يلعب فيه ابني بالحديقه', MOCK_PRODUCTS, { provider: p });
  assert.equal(p.calls, 1);
  assert.equal(r.ai.called, true);
  assert.equal(needsAiHelp(parseDiscoveryQuery('مرحبا')), true);
});

test('AI-only suggestions are labelled "اقتراح تقريبي" with a caveat — never "مطابق للنوع المطلوب"', async () => {
  const q = 'بدي اشي يلعب فيه ابني بالحديقه';
  const local = discoverProductsLocal(q, MOCK_PRODUCTS);
  assert.equal(local.status, 'no_results', 'locally: unknown words, nothing matches');
  const r = await discoverProducts(q, MOCK_PRODUCTS, { provider: replay({ categories: ['Games'] }) });
  assert.equal(r.status, 'ok');
  assert.ok(r.results.length > 0);
  for (const x of r.results) {
    assert.equal(x.matchLevel, 'inferred', x.id);
    assert.equal(x.matchLabel, 'اقتراح تقريبي');
    assert.ok(x.caveats.some((c) => c.includes('لم تذكر هذا النوع صراحة')), x.id);
    assert.ok(byId[x.id] && x.price === toCatalogItem(byId[x.id]).price, 'real store product and price');
    assert.notEqual(toCatalogItem(byId[x.id]).stock, 'out');
  }
  assert.deepEqual(r.unavailable, [], 'an AI guess is not "your product is out of stock"');
});

test('AI hints never hide suitable products and never bypass safety / age conditions', async () => {
  // an AI exclusion is NOT applied (only the customer's words can hide products)
  const q1 = 'هدية لابني';
  const l1 = discoverProductsLocal(q1, MOCK_PRODUCTS);
  const r1 = await discoverProducts(q1, MOCK_PRODUCTS, { provider: replay({ excludeCategories: ['Stationery', 'ArtSupplies'] }), aiPolicy: 'always' });
  assert.deepEqual(new Set(ids(r1)), new Set(ids(l1)));
  assert.deepEqual(r1.intent.excludeCategories, []);
  assert.ok(r1.ai.ignored.some((s) => s.startsWith('excludeCategories')));
  // an AI "adult" recipient does not remove children's products the customer asked for
  const q2 = 'لعبة';
  const r2 = await discoverProducts(q2, MOCK_PRODUCTS, { provider: replay({ recipient: 'adult' }), aiPolicy: 'always' });
  assert.equal(r2.intent.recipient, null);
  assert.deepEqual(new Set(ids(r2)), new Set(ids(discoverProductsLocal(q2, MOCK_PRODUCTS))));
  // a hint cannot get an unknown-age toy recommended for a baby (local age 0-1 stays a hard condition)
  const q3 = 'بدي اشي لرضيع يلعب فيه بالحديقه';
  const r3 = await discoverProducts(q3, MOCK_PRODUCTS, { provider: replay({ categories: ['Games'], recipient: 'adult', age: { min: 8, max: 12 } }) });
  assert.deepEqual([r3.intent.age.min, r3.intent.age.max], [0, 1], 'AI age does not replace the local one');
  assert.equal(r3.intent.provenance.age, 'local_inferred');
  for (const x of r3.results) {
    const it = toCatalogItem(byId[x.id]);
    assert.ok(it.age && it.age.min <= 0 && it.age.max >= 0, `${x.id}: age confirmed for a baby`);
  }
  assert.ok(!ids(r3).includes('m-car'));
});

test('AI may fill a missing budget/age ONLY when the number is written in the request', async () => {
  // "ما تتعدى 8" used to be such a gap; the local parser now reads it (inclusive), so the gap example changed
  assert.deepEqual(parseDiscoveryQuery('بدي لعبة ما تتعدى 8').budget, { min: null, max: 8, approximate: false });
  const q = 'بدي لعبة سعرها 8 او اقل';
  assert.equal(parseDiscoveryQuery(q).budget, null, 'the local parser does not read this budget form');
  const ok = await discoverProducts(q, MOCK_PRODUCTS, { provider: replay({ budget: { max: 8 } }), aiPolicy: 'always' });
  assert.equal(ok.intent.budget.max, 8);
  assert.equal(ok.intent.provenance.budget, 'ai_verified');
  assert.deepEqual(ok.ai.verified, ['budget']);
  for (const x of ok.results) assert.ok(x.price <= 8, x.id);
  const invented = await discoverProducts(q, MOCK_PRODUCTS, { provider: replay({ budget: { max: 500 }, age: { min: 4, max: 6 } }), aiPolicy: 'always' });
  assert.equal(invented.intent.budget, null, '500 is not in the request');
  assert.equal(invented.intent.age, null, '4-6 is not in the request');
  assert.ok(invented.ai.ignored.includes('budget (not written in the request)'));
  assert.ok(invented.ai.ignored.includes('age (not written in the request)'));
});

test('keyword hygiene: currency / lone numbers dropped, product-spec numbers kept (local and AI keywords)', () => {
  assert.deepEqual(cleanKeywordTokens(['دينار', '12']), []);
  assert.deepEqual(cleanKeywordTokens(['12', 'jd']), []);
  const spec = cleanKeywordTokens(['100', 'ورقه']);
  assert.equal(spec.length, 2);
  assert.ok(spec.includes('100'));
  // the same light stemming runs on the request and on product names: the spec words find the 100-sheet notebook
  const notebook = toCatalogItem(byId['m-notebook-offer']);
  for (const w of spec) assert.ok(notebook.nameWords.has(w), `"${w}" matches the notebook name`);
  assert.ok(cleanKeywordTokens(['24', 'لون']).includes('24'));
  assert.deepEqual(cleanKeywordTokens(['a4']), ['a4']);
  assert.deepEqual(cleanKeywordTokens(['هديه', 'تعليميه', 'طفل'], { dropConcepts: true }), []);
  assert.ok(parseDiscoveryQuery('دفتر 100 ورقة').keywords.includes('100'), 'a spec number in a local request is kept');
  assert.ok(!parseDiscoveryQuery('دفتر بحدود 3 دينار').keywords.some((k) => /\d|دينار/.test(k)), 'the budget is not a keyword');
  const merged = mergeIntent(parseDiscoveryQuery('اشي حلو'), { keywords: ['دينار 12', 'هدية', 'ألوان 24 لون'] });
  assert.ok(merged.intent.aiHints.keywords.includes('24'));
  assert.ok(!merged.intent.aiHints.keywords.some((k) => k.includes('دينار') || k === '12'));
});

test('provenance: what the customer said vs. a safe local inference', () => {
  const a = parseDiscoveryQuery(MAIN).provenance;
  assert.deepEqual(a, { budget: 'stated', age: 'stated', recipient: 'stated', occasions: 'stated', educational: 'stated' });
  assert.equal(parseDiscoveryQuery('لعبة لرضيع').provenance.age, 'local_inferred');
  assert.equal(giftFinderIntent({ who: 'boy', age: '4-7', interest: 'art' }).provenance.age, 'stated');
});

// ------------------------------------------------------------------ numbers & budget forms (strict vs inclusive, AI context)
const INCL = { min: null, max: 10, approximate: false };
const STRICT = { min: null, max: 10, approximate: false, maxExclusive: true };
const APPROX = { min: null, max: 10, approximate: true };
const budgetForms = [
  ['شنطة ما يتعدى 10 دنانير', INCL], ['شنطة ما يتعدي 10 دنانير', INCL], ['شنطة ما بتتعدى 10 دنانير', INCL],
  ['شنطة ما يزيد عن 10 دنانير', INCL], ['شنطة ما يزيد على 10 دنانير', INCL], ['شنطة ما يتجاوز 10 دنانير', INCL],
  ['شنطة حتى 10 دنانير', INCL], ['شنطة لحد 10 دنانير', INCL], ['شنطة بحد أقصى 10 دنانير', INCL], ['bag up to 10 JD', INCL],
  ['شنطة أقل من 10 دنانير', STRICT], ['شنطة تحت 10 دنانير', STRICT], ['bag under 10 JD', STRICT],
  ['شنطة بحدود 10 دنانير', APPROX], ['شنطة حوالي 10 دنانير', APPROX], ['شنطة 10 دنانير', APPROX],
  // Arabic-Indic digits and number words
  ['شنطة أقل من ١٠ دنانير', STRICT], ['شنطة ما يتعدى ١٠ دنانير', INCL], ['شنطة بحدود عشرة دنانير', APPROX],
  // a negated "less than" is a MINIMUM
  ['شنطة مش أقل من 10 دنانير', { min: 10, max: null, approximate: false }],
];
for (const [q, want] of budgetForms) {
  test(`budget form: ${q}`, () => {
    const i = parseDiscoveryQuery(q);
    assert.deepEqual(i.budget, want);
    assert.equal(i.provenance.budget, 'stated');
    assert.ok(!i.keywords.some((k) => /يتعد|يزيد|تتعد|حتي/.test(k)), `no budget word left as a keyword: ${i.keywords}`);
  });
}

test('strict vs inclusive limit on real ranking: "أقل من 10" drops a 10 JD product, "حتى 10" / "ما يتعدى 10" keep it', () => {
  const cat = [{ ...byId['m-car'], id: 't-ten', price: 10 }, { ...byId['m-car'], id: 't-nine', price: 9.5 }, { ...byId['m-car'], id: 't-eleven', price: 11 }];
  const got = (q) => new Set(ids(discoverProductsLocal(q, cat)));
  for (const q of ['سيارة أقل من 10 دنانير', 'سيارة تحت 10 دنانير']) {
    const s = got(q);
    assert.ok(s.has('t-nine') && !s.has('t-ten') && !s.has('t-eleven'), `${q}: ${[...s]}`);
  }
  for (const q of ['سيارة حتى 10 دنانير', 'سيارة ما يتعدى 10 دنانير', 'سيارة ما يزيد عن 10 دنانير']) {
    const s = got(q);
    assert.ok(s.has('t-nine') && s.has('t-ten') && !s.has('t-eleven'), `${q}: ${[...s]}`);
  }
});

test('numbers in context: a product spec is not a price; age and budget stay apart; Arabic and Latin digits', () => {
  const ctx = (q) => { const c = numbersInContext(normalizeArabic(q)); return { age: [...c.age].sort((a, b) => a - b), budget: [...c.budget].sort((a, b) => a - b) }; };
  assert.deepEqual(ctx('دفتر 100 ورقة'), { age: [], budget: [] });
  assert.deepEqual(ctx('ألوان 24 لون'), { age: [], budget: [] });
  assert.deepEqual(ctx('سعر دفتر 100 ورقة'), { age: [], budget: [] }, 'a price word before a spec number does not make it a price');
  assert.deepEqual(ctx(MAIN), { age: [7], budget: [12] });
  assert.deepEqual(ctx('بدي هدية تعليمية لطفل عمره ٧ سنوات بحدود ١٢ دينار'), { age: [7], budget: [12] });
  assert.deepEqual(ctx('لعبة لعمر سبع سنين بعشرة دنانير'), { age: [7], budget: [10] });
  assert.deepEqual(ctx('لعبة لطفل من 6 ل 8 سنوات بين 5 و 10 دنانير'), { age: [6, 8], budget: [5, 10] });
  assert.deepEqual(ctx('شنطة مدرسة صف 3'), { age: [], budget: [] }, 'a school grade is not an age');
  const local = parseDiscoveryQuery(MAIN);
  assert.deepEqual([local.age.min, local.age.max], [7, 7]);
  assert.deepEqual(local.budget, { min: null, max: 12, approximate: true });
  for (const q of ['دفتر 100 ورقة', 'ألوان 24 لون']) assert.equal(parseDiscoveryQuery(q).budget, null, q);
});

test('AI budget/age needs the number IN CONTEXT: "دفتر 100 ورقة" is no 100 JD budget, an age is no price', async () => {
  const cases = [
    ['دفتر 100 ورقة', { budget: { max: 100 } }, 'budget (number not written as a price)'],
    ['ألوان 24 لون', { budget: { max: 24 } }, 'budget (number not written as a price)'],
    ['لعبة لطفل عمره 7 سنوات', { budget: { max: 7 } }, 'budget (number not written as a price)'],
    ['لعبة بحدود 12 دينار', { age: { min: 12, max: 12 } }, 'age (number not written as an age)'],
    ['دفتر 100 ورقة', { age: { min: 100, max: 100 } }, 'age (number not written as an age)'],
  ];
  for (const [q, patch, why] of cases) {
    const local = parseDiscoveryQuery(q);
    const r = await discoverProducts(q, MOCK_PRODUCTS, { provider: replay(patch), aiPolicy: 'always' });
    assert.deepEqual(r.intent.budget, local.budget, `${q}: budget unchanged`);
    assert.deepEqual(r.intent.age, local.age, `${q}: age unchanged`);
    assert.ok(r.ai.ignored.includes(why), `${q}: ${r.ai.ignored}`);
    assert.ok(!r.ai.verified.includes('budget') && !r.ai.verified.includes('age'), q);
  }
  // the spec number still finds the 100-sheet notebook (a keyword, not a price limit)
  const nb = await discoverProducts('دفتر 100 ورقة', MOCK_PRODUCTS, { provider: replay({ budget: { max: 100 } }), aiPolicy: 'always' });
  assert.equal(nb.results[0]?.id, 'm-notebook-offer');
  // a price cue the local rules do not read is accepted (Arabic digits too)
  const ok = await discoverProducts('بدي لعبة سعرها ٨ او اقل', MOCK_PRODUCTS, { provider: replay({ budget: { max: 8 } }), aiPolicy: 'always' });
  assert.equal(ok.intent.budget.max, 8);
  assert.equal(ok.intent.provenance.budget, 'ai_verified');
});

test('AI never replaces a clear local budget — not the amount, not strict vs inclusive vs approximate', async () => {
  const cases = [
    ['شنطة أقل من 10 دنانير', { budget: { max: 20 } }],
    ['شنطة أقل من 10 دنانير', { budget: { max: 10, approximate: true } }],
    ['شنطة حتى 10 دنانير', { budget: { min: 5, max: 10 } }],
    ['شنطة ما يتعدى 10 دنانير', { budget: { max: 10, approximate: true } }],
    [MAIN, { budget: { max: 7 }, age: { min: 12, max: 12 } }],
    [REAL_AI_RESPONSES[0].query, REAL_AI_RESPONSES[0].intent],
  ];
  for (const [q, patch] of cases) {
    const local = parseDiscoveryQuery(q);
    const r = await discoverProducts(q, MOCK_PRODUCTS, { provider: replay(patch), aiPolicy: 'always' });
    assert.deepEqual(r.intent.budget, local.budget, `${q}: budget kept`);
    assert.deepEqual(r.intent.age, local.age, `${q}: age kept`);
    assert.equal(r.intent.provenance.budget, 'stated', q);
    if (patch.budget) assert.ok(r.ai.ignored.includes('budget (local understanding kept)'), q);
    const max = local.budget.max;
    for (const x of r.results) assert.ok(local.budget.maxExclusive ? x.price < max : x.price <= max * (local.budget.approximate ? 1.1 : 1) + 1e-9, `${q}: ${x.id} ${x.price}`);
  }
});
