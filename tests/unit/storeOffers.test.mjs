// Store improvements (pure parts): real discounts only, cart lines priced from the LIVE catalogue, offers list,
// similar products and "complete your order" suggestions from real products.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saleInfo, liveCartLine } from '../../src/services/priceDisplay.ts';
import { similarProducts, cartSuggestions, offerProducts, tagsOf } from '../../src/services/recommendations.ts';
import { planInventory } from '../../workers/order-worker/src/inventory.js';
import { encodeFields } from '../../workers/order-worker/src/firestore.js';

const P = (id, o) => ({ id, name: id, price: 5, stock: 10, category: 'Stationery', image: `/img/${id}.png`, ...o });

test('discount: only a REAL original price above the selling price; percent and saving computed, never invented', () => {
  assert.deepEqual(saleInfo(3, 4), { onSale: true, original: 4, percent: 25, save: 1 });
  assert.deepEqual(saleInfo(7.5, 10), { onSale: true, original: 10, percent: 25, save: 2.5 });
  assert.equal(saleInfo(1.255, 1.5).save, 0.245, 'fils precision');
  for (const [p, o] of [[5, 5], [5, 4], [5, undefined], [5, null], [5, ''], [5, 'abc'], [5, -1], [0, 5], [5, 5.01], [1, 100]]) {
    assert.equal(saleInfo(p, o).onSale, false, `${p} vs ${o}`);
  }
});

test('cart line priced from the LIVE catalogue: a variant price changed since it was added -> the NEW price (what the server charges)', () => {
  const live = [{ id: 'pen', price: 3, originalPrice: 4, stock: 0, variants: [{ id: 'red', price: 2.75, originalPrice: 3.5, stock: 6 }, { id: 'blue', price: 3, stock: 0 }] }];
  const stale = { id: 'pen', price: 3, quantity: 2, selectedVariant: { id: 'red', label: 'أحمر', price: 3, stock: 9, image: 'x.jpg' } };
  const r = liveCartLine(stale, live);
  assert.equal(r.price, 2.75);
  assert.equal(r.stock, 6);
  assert.equal(r.sale.onSale, true);
  assert.equal(r.sale.original, 3.5);
  assert.equal(r.selectedVariant.label, 'أحمر', 'the chosen option keeps its label / image');
  assert.equal(r.selectedVariant.price, 2.75);
  // sold out now
  assert.equal(liveCartLine({ id: 'pen', selectedVariant: { id: 'blue', price: 3, stock: 4 } }, live).stock, 0);
  // the product-level original price belongs to the product price only (a variant at another price never inherits it)
  assert.equal(liveCartLine({ id: 'pen', selectedVariant: { id: 'blue' } }, live).sale.onSale, true, 'blue is sold at the product price 3 -> original 4');
  assert.equal(liveCartLine({ id: 'pen', selectedVariant: { id: 'x', price: 1, stock: 1 } }, live).price, 1, 'a variant gone from the catalogue keeps its stored data (the server refuses it)');
  // simple product: live price, product original price
  assert.deepEqual(liveCartLine({ id: 'n', price: 9, stock: 1 }, [{ id: 'n', price: 4.5, originalPrice: 6, stock: 3 }]).sale, { onSale: true, original: 6, percent: 25, save: 1.5 });
  // product removed from the catalogue: the stored price (the server refuses the line)
  assert.equal(liveCartLine({ id: 'gone', price: 2, stock: 1 }, live).price, 2);
});

test('the SERVER prices a line from the catalogue price only: the original (struck) price never becomes the charged price', () => {
  const doc = (f) => ({ exists: true, fields: encodeFields(f), updateTime: '2026-11-24T00:00:00.000000Z' });
  const products = new Map([
    ['simple', doc({ name: 'دفتر', price: 3, originalPrice: 4, stock: 5 })],
    ['var', doc({ name: 'قلم', price: 3, originalPrice: 4, stock: 0, variants: [{ id: 'red', price: 2.75, originalPrice: 3.5, stock: 6 }] })],
  ]);
  const r = planInventory([{ index: 0, productId: 'simple', variantId: null, quantity: 1 }, { index: 1, productId: 'var', variantId: 'red', quantity: 1 }], products, 'off');
  assert.deepEqual(r.lineInfo.map((l) => l.serverUnitPrice), [3, 2.75]);
});

test('offers: buyable products with a real discount only (variants: the shown price), with percent and saving', () => {
  const all = [
    P('a', { price: 3, originalPrice: 4 }),
    P('b', { price: 4, originalPrice: 4 }),
    P('c', { price: 3, originalPrice: 6, stock: 0 }),
    P('d', { price: 5, variants: [{ id: 'v1', price: 4, originalPrice: 5, stock: 2 }, { id: 'v2', price: 6, stock: 1 }] }),
    P('e', { price: 5 }),
  ];
  const o = offerProducts(all);
  assert.deepEqual(o.map((x) => x.p.id), ['a', 'd']);
  assert.deepEqual(o.map((x) => [x.percent, x.save, x.price]), [[25, 1, 3], [20, 1, 4]]);
});

const CATALOG = [
  P('kitchen-1', { category: 'Games', subCategory: 'all-toys,kitchen-toys,girls-toys', price: 12 }),
  P('kitchen-2', { category: 'Games', subCategory: 'all-toys,kitchen-toys', price: 14 }),
  P('blocks-1', { category: 'Games', subCategory: 'all-toys,building-blocks,boys-toys', price: 11 }),
  P('blocks-2', { category: 'Games', subCategory: 'all-toys,building-blocks', price: 9 }),
  P('blocks-out', { category: 'Games', subCategory: 'all-toys,building-blocks', price: 9, stock: 0 }),
  P('pen-1', { category: 'Stationery', subCategory: 'pens-ballpoint', price: 0.5 }),
  P('pen-2', { category: 'Stationery', subCategory: 'pens-ballpoint,colors-markers', price: 1 }),
  P('note-1', { category: 'Stationery', subCategory: 'notebooks', price: 1.5 }),
  P('eraser', { category: 'Stationery', subCategory: 'erasers-sharpeners', price: 0.25 }),
  P('car-1', { category: 'BabyGear', subCategory: 'ride-on-cars', price: 90 }),
  P('car-2', { category: 'BabyGear', subCategory: 'ride-on-cars', price: 120 }),
];

test('similar products: never the product itself, never out of stock; a RARE shared tag beats a common one', () => {
  const r = similarProducts(CATALOG[0], CATALOG, 8).map((p) => p.id);
  assert.equal(r[0], 'kitchen-2', 'the other kitchen toy first');
  assert.ok(!r.includes('kitchen-1'));
  assert.ok(!r.includes('blocks-out'));
  assert.ok(!r.includes('pen-1') && !r.includes('car-1'), 'nothing in common = not suggested');
  const b = similarProducts(CATALOG[2], CATALOG, 3).map((p) => p.id);
  assert.equal(b[0], 'blocks-2');
  assert.deepEqual(similarProducts(null, CATALOG), []);
  assert.deepEqual(similarProducts(CATALOG[0], []), []);
  assert.ok(tagsOf(CATALOG[0]).has('sub:kitchen-toys'));
  // deterministic
  assert.deepEqual(similarProducts(CATALOG[5], CATALOG, 5), similarProducts(CATALOG[5], [...CATALOG].reverse(), 5));
});

test('complete your order: related to the cart, never in the cart, never sold out, a much dearer item pushed down; nothing for an empty cart', () => {
  const s = cartSuggestions([{ id: 'pen-1' }, { id: 'note-1' }], CATALOG, 6).map((p) => p.id);
  assert.ok(s.length >= 2);
  assert.ok(!s.includes('pen-1') && !s.includes('note-1'));
  assert.ok(s.includes('pen-2') && s.includes('eraser'));
  assert.ok(!s.some((id) => id.startsWith('car') || id.startsWith('kitchen')));
  const toys = cartSuggestions([{ id: 'blocks-2' }], CATALOG, 6).map((p) => p.id);
  assert.ok(!toys.includes('blocks-out'));
  assert.ok(toys.indexOf('blocks-1') >= 0);
  const car = cartSuggestions([{ id: 'car-1' }], CATALOG, 6).map((p) => p.id);
  assert.deepEqual(car, ['car-2'], 'only the related ride-on (dearer -> scored down but still the only related one)');
  assert.deepEqual(cartSuggestions([], CATALOG), []);
  assert.deepEqual(cartSuggestions([{ id: 'unknown' }], CATALOG), []);
});
