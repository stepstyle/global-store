// node --test tests/unit/priceDisplay.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { saleInfo, formatJod, displayPrice } from '../../src/services/priceDisplay.ts';

test('a sale is shown only when the original price is strictly higher', () => {
  assert.deepEqual(saleInfo(2, 2), { onSale: false }, 'equal: no badge (6 real products had this)');
  assert.deepEqual(saleInfo(2, 1.5), { onSale: false }, 'lower');
  assert.deepEqual(saleInfo(2, undefined), { onSale: false });
  assert.deepEqual(saleInfo(2, 0), { onSale: false });
  assert.deepEqual(saleInfo(2, 'abc'), { onSale: false });
  assert.deepEqual(saleInfo(2, 2.004), { onSale: false }, 'a 0% rounding difference is not a sale');
  assert.deepEqual(saleInfo(24, 28), { onSale: true, original: 28, percent: 14 });
  assert.deepEqual(saleInfo('3.5', '5'), { onSale: true, original: 5, percent: 30 });
  assert.deepEqual(saleInfo(0.01, 5), { onSale: false }, '>95% looks like a data error: not shown');
});

test('JOD formatting (fils precision, no trailing zeros, invalid -> 0)', () => {
  assert.equal(formatJod(2), '2');
  assert.equal(formatJod(2.5), '2.5');
  assert.equal(formatJod(1.255), '1.255');
  assert.equal(formatJod(0.1 + 0.2), '0.3');
  assert.equal(formatJod('x'), '0');
});

test('variant products show the cheapest IN-STOCK variant (and its own original price)', () => {
  const p = { price: 9, originalPrice: 12, variants: [{ price: 3, stock: 0, originalPrice: 4 }, { price: 5, stock: 2, originalPrice: 6 }, { price: 7, stock: 1 }] };
  assert.deepEqual(displayPrice(p), { price: 5, originalPrice: 6 });
  assert.deepEqual(displayPrice({ price: 9, variants: [{ price: 3, stock: 0 }, { price: 4, stock: 0 }] }), { price: 3, originalPrice: null }, 'all sold out: cheapest priced');
  assert.deepEqual(displayPrice({ price: 2.5, originalPrice: 3 }), { price: 2.5, originalPrice: 3 });
  // real case p-1786781317250-381: product 1 / original 1, variants 0.5–0.85 without their own original price
  const real = { price: 1, originalPrice: 1, variants: [{ price: 0.5, stock: 10 }, { price: 0.65, stock: 10 }, { price: 0.85, stock: 10 }] };
  assert.deepEqual(displayPrice(real), { price: 0.5, originalPrice: null });
  assert.equal(saleInfo(0.5, displayPrice(real).originalPrice).onSale, false, 'no invented -50%');
});

test('the real catalogue snapshot: every product gets a valid display price; equal-original products show no sale', () => {
  const products = JSON.parse(readFileSync(new URL('../../public/catalog-snapshot.json', import.meta.url), 'utf8')).products;
  const equal = [];
  for (const p of products) {
    const d = displayPrice(p);
    assert.ok(d.price !== null && d.price > 0, `${p.id} has a price`);
    if (Number(p.originalPrice) === Number(p.price)) { equal.push(p.id); assert.equal(saleInfo(d.price, d.originalPrice).onSale, false, p.id); }
    // a sale is only ever shown with an original price that exists in the data for the price shown
    const s = saleInfo(d.price, d.originalPrice);
    if (s.onSale) assert.ok([p.originalPrice, ...(p.variants || []).map((v) => v.originalPrice)].map(Number).includes(s.original), `${p.id}: sale from real data`);
  }
  assert.ok(equal.length >= 1, 'the snapshot still contains equal-price products (data list for the owner)');
});

test('a product-level original price applies to a variant only when it belongs to the SAME price', () => {
  assert.deepEqual(displayPrice({ price: 18, originalPrice: 20, variants: [{ price: 18, stock: 3 }, { price: 18, stock: 1 }] }), { price: 18, originalPrice: 20 });
  assert.deepEqual(displayPrice({ price: 18, originalPrice: 20, variants: [{ price: 15, stock: 3 }] }), { price: 15, originalPrice: null });
});

test('available stock: variants decide for variant products (3 real products were shown "sold out" while in stock)', async () => {
  const { availableStock, hasPriceRange } = await import('../../src/services/priceDisplay.ts');
  assert.equal(availableStock({ stock: 0, variants: [{ stock: 0 }, { stock: 2 }] }), 2);
  assert.equal(availableStock({ stock: 5, variants: [{ stock: 0 }, { stock: 0 }] }), 0);
  assert.equal(availableStock({ stock: 4 }), 4);
  assert.equal(availableStock({ stock: -3 }), 0);
  assert.equal(hasPriceRange({ variants: [{ price: 1 }, { price: 1 }] }), false);
  assert.equal(hasPriceRange({ variants: [{ price: 0.5 }, { price: 0.85 }] }), true);
  const products = JSON.parse(readFileSync(new URL('../../public/catalog-snapshot.json', import.meta.url), 'utf8')).products;
  for (const id of ['p-1773693914315-421', 'p-1773758972839-198', 'p-1773760581725-574']) {
    const p = products.find((x) => x.id === id);
    if (p && (p.variants || []).some((v) => Number(v.stock) > 0)) assert.ok(availableStock(p) > 0, id);
  }
});
