// Shopping assistant on the REAL catalogue snapshot (public/catalog-snapshot.json, read-only).
//   node --test tests/unit/shopAssistant.test.mjs
// Ages are recommended only from owner-approved data; under 3 also needs a confirmed "no small parts".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoverProductsLocal, discoverProducts, validateAgeRegistry, parseDiscoveryQuery } from '../../src/services/discovery/index.ts';
import { toCatalogItem } from '../../src/services/discovery/catalog.ts';

const PRODUCTS = JSON.parse(readFileSync(new URL('../../public/catalog-snapshot.json', import.meta.url), 'utf8')).products;
const SHIPPED_AGES = validateAgeRegistry(JSON.parse(readFileSync(new URL('../../src/data/productAges.json', import.meta.url), 'utf8')));
const byId = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
const item = (id) => toCatalogItem(byId[id]);
const ask = (q, ages = SHIPPED_AGES) => discoverProductsLocal(q, PRODUCTS, { limit: 6, ages });
const ids = (r) => r.results.map((x) => x.id);

// real products, picked by their data (not by name) so the test follows the snapshot
const inStock = (id) => item(id).stock === 'in';
const games = PRODUCTS.filter((p) => p.category === 'Games');
const claim3 = games.filter((p) => inStock(p.id) && item(p.id).ageClaim?.min === 3 && item(p.id).ageClaim.max >= 99).map((p) => p.id);
const noClaimGame = games.filter((p) => inStock(p.id) && !item(p.id).ageClaim && item(p.id).smallParts === 'unknown').map((p) => p.id);
const outOfStockGame = games.find((p) => !inStock(p.id))?.id;
const babyWalker = PRODUCTS.find((p) => p.category === 'BabyGear' && inStock(p.id) && !item(p.id).ageClaim)?.id;
assert.ok(claim3.length >= 3 && noClaimGame.length >= 2 && outOfStockGame && babyWalker, 'snapshot has the products these tests need');

const approve = (list) => validateAgeRegistry({ products: Object.fromEntries(list.map(([id, minYears, maxYears, smallParts]) => [id, { minYears, maxYears, smallParts, source: 'packaging', approvedBy: 'test', approvedAt: '2026-11-18' }])) });
// a plausible approval set: one baby product with no small parts, 3+ toys (small parts: yes / unknown), one out of stock
const AGES = approve([
  [babyWalker, 0.5, 2, 'no'],
  [claim3[0], 3, null, 'yes'],
  [claim3[1], 3, null, 'unknown'],
  [claim3[2], 3, 8, 'no'],
  [noClaimGame[0], 1, null, 'unknown'], // approved for 1+ but small parts not confirmed
  [noClaimGame[1], 6, null, 'no'],
  [outOfStockGame, 3, null, 'no'],
]);

const INTERNAL = /\d+\s*منتج|غير متوفر حاليًا:|لا تؤكد بيانات|المعلومات غير كافية/;
function customerSafe(r, q) {
  assert.doesNotMatch(r.message, INTERNAL, `${q}: no internal counts / filter reasons in the reply`);
  for (const x of r.results) {
    const p = byId[x.id];
    assert.ok(p, `${q}: ${x.id} is a real product`);
    assert.equal(x.name, p.name);
    assert.ok(x.image.startsWith('https://res.cloudinary.com/'), `${q}: real image`);
    assert.equal(item(x.id).stock, 'in', `${q}: ${x.id} is in stock`);
    assert.ok(!r.message.includes(p.name), 'product names are on cards, not in the text');
  }
  for (const u of r.unavailable) assert.ok(!r.message.includes(byId[u.id].name), `${q}: an out-of-stock name never appears in the reply`);
}

test('today (no ages approved yet): age requests -> a short apology + WhatsApp, never a guess', () => {
  assert.equal(Object.keys(SHIPPED_AGES).length, 0, 'the shipped registry is empty until the owner approves');
  for (const [q, label] of [['بدي لعبة لعمر سنة', 'سنة'], ['لعبة لبنت عمرها 3 سنين', '3 سنوات'], ['لعبة لطفل عمره 5 سنوات', '5 سنوات'], ['لعبة لولد عمره 7 سنين', '7 سنوات']]) {
    const r = ask(q);
    assert.equal(r.status, 'no_results', q);
    assert.deepEqual(r.results, [], q);
    assert.equal(r.suggestWhatsApp, true, q);
    assert.match(r.message, new RegExp(`للأسف ما لقيت إشي متوفر ومتأكدين إنه مناسب لعمر ${label} هلّق\\. احكي معنا على واتساب`), q);
    customerSafe(r, q);
  }
});

test('age 1: only an approved product with confirmed "no small parts"; 3+ texts, unknown small parts and guesses excluded', () => {
  const r = ask('بدي لعبة لعمر سنة', AGES);
  // the walker is BabyGear, not a "لعبة": a toy request finds no confirmed toy for a 1-year-old
  assert.ok(!ids(r).includes(noClaimGame[0]), 'approved 1+ but small parts unknown -> not for a 1-year-old');
  for (const id of claim3) assert.ok(!ids(r).includes(id), `${id}: 3+ never for a 1-year-old`);
  assert.equal(r.status, 'no_results');
  assert.equal(r.suggestWhatsApp, true);
  const b = ask('بدي اشي لطفل عمره سنة', AGES);
  assert.deepEqual(ids(b), [babyWalker], 'without a product type: only the approved, small-parts-free baby product');
  assert.equal(b.results[0].ageLabel, 'من 6 أشهر إلى سنتين');
  assert.match(b.message, /^هاي خيارات متوفرة عنا مناسبة لعمر سنة حسب بيانات العبوة:$/);
  customerSafe(b, 'age 1');
});

test('ages 3, 5, 7: approved ranges decide; out of stock never shown; reply is short Jordanian', () => {
  const r3 = ask('لعبة لبنت عمرها 3 سنين', AGES);
  // from 3 years the small-parts rule no longer applies: the 1+ toy is fine
  assert.deepEqual(new Set(ids(r3)), new Set([noClaimGame[0], claim3[0], claim3[1], claim3[2]]));
  assert.ok(!ids(r3).includes(outOfStockGame), 'out of stock never recommended');
  for (const x of r3.results) assert.ok(x.ageLabel, 'each card shows the approved age');
  assert.match(r3.message, /^هاي خيارات متوفرة عنا مناسبة لعمر 3 سنوات حسب بيانات العبوة:$/);
  customerSafe(r3, 'age 3');

  const r5 = ask('لعبة لطفل عمره 5 سنوات', AGES);
  assert.deepEqual(new Set(ids(r5)), new Set([noClaimGame[0], claim3[0], claim3[1], claim3[2]]));
  customerSafe(r5, 'age 5');

  const r7 = ask('شو عندك العاب لابني 7 سنين', AGES);
  assert.deepEqual(new Set(ids(r7)), new Set([noClaimGame[0], noClaimGame[1], claim3[0], claim3[1], claim3[2]]), '6+ joins at 7; 3-8 still fits 7');
  customerSafe(r7, 'age 7');
});

test('Jordanian phrasing is understood', () => {
  assert.deepEqual(parseDiscoveryQuery('بدي هدية بخمس ليرات').budget, { min: null, max: 5, approximate: true });
  assert.equal(parseDiscoveryQuery('بدي لعبة لعمر سنة').age.min, 1);
  const g = parseDiscoveryQuery('لعبة لبنت عمرها 3 سنين');
  assert.equal(g.age.min, 3);
  assert.equal(g.recipient, 'girl');
  assert.equal(parseDiscoveryQuery('لبنتي عمرها سنة ونص').age.min, 1.5);
  const s = parseDiscoveryQuery('ألوان بأقل من 3 ليرات').budget;
  assert.equal(s.max, 3);
  assert.equal(s.maxExclusive, true);
});

test('budget requests: in stock, within budget, real cards; nothing found -> nearest real price + WhatsApp', () => {
  const r = ask('بدي هدية بخمس ليرات', AGES);
  assert.equal(r.status, 'ok');
  assert.match(r.message, /^هاي خيارات متوفرة عنا ضمن 5 دنانير:$/);
  for (const x of r.results) assert.ok(x.price <= 5 * 1.1, `${x.id} ${x.price}`);
  customerSafe(r, 'gift 5');
  const strict = ask('ألوان بأقل من 3 ليرات', AGES);
  for (const x of strict.results) assert.ok(x.price < 3, `${x.id} ${x.price}`);
  assert.match(strict.message, /بأقل من 3 دنانير/);
  const none = ask('لعبة بأقل من 0.5 دينار', AGES);
  assert.equal(none.status, 'no_results');
  assert.equal(none.suggestWhatsApp, true);
  customerSafe(none, 'too cheap');
});

test('local engine only when no AI provider is configured (the preview): engine reported honestly', async () => {
  const r = await discoverProducts('لعبة لبنت عمرها 3 سنين', PRODUCTS, { provider: null, ages: AGES });
  assert.equal(r.engine, 'local');
  assert.equal(r.ai, null, 'no AI was called or configured');
});
