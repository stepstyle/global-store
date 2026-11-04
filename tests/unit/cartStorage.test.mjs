// Unit tests for src/services/cartStorage.ts — the saved cart survives app start (incl. React.StrictMode) and
// page refresh, and bad stored data never breaks the app.
//   node --test tests/unit/cartStorage.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { readStoredCart, CART_STORAGE_KEY } from '../../src/services/cartStorage.ts';

const ITEM = { id: 'p-simple', name: 'Notebook', price: 2.5, stock: 10, quantity: 2 };
const mem = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};

// ---------------------------------------------------------------- corrupted / unexpected storage data
test('nothing stored -> empty cart', () => {
  assert.deepEqual(readStoredCart(mem()), []);
  assert.deepEqual(readStoredCart(mem({ [CART_STORAGE_KEY]: '' })), []);
  assert.deepEqual(readStoredCart(null), []);
  assert.deepEqual(readStoredCart(undefined), []);
});

test('invalid JSON -> empty cart, no throw', () => {
  for (const raw of ['{not json', '[{"id":"p1",', 'undefined', 'NaN', '\u0000']) {
    assert.deepEqual(readStoredCart(mem({ [CART_STORAGE_KEY]: raw })), [], raw);
  }
});

test('valid JSON that is not an array -> empty cart', () => {
  for (const v of [null, 0, 42, true, 'str', { id: 'p1' }, { 0: ITEM, length: 1 }]) {
    assert.deepEqual(readStoredCart(mem({ [CART_STORAGE_KEY]: JSON.stringify(v) })), [], JSON.stringify(v));
  }
});

test('entries that are not cart items are dropped, real items kept unchanged', () => {
  const stored = [ITEM, null, 7, 'x', [], {}, { id: '' }, { id: null }, { id: Infinity }, { name: 'no id' }, { id: 5, quantity: 1 }];
  assert.deepEqual(readStoredCart(mem({ [CART_STORAGE_KEY]: JSON.stringify(stored) })), [ITEM, { id: 5, quantity: 1 }]);
});

test('storage that throws on read (blocked / private mode) -> empty cart, no throw', () => {
  const broken = { getItem: () => { throw new Error('SecurityError'); } };
  assert.deepEqual(readStoredCart(broken), []);
});

// ---------------------------------------------------------------- app start + refresh
// Models App.tsx's cart wiring with React's effect semantics: state initialiser at mount, then
//   effect L ("load": the OLD code's mount effect reading anta_cart and calling setCart), and
//   effect S ("save": localStorage.setItem('anta_cart', JSON.stringify(cart)) whenever cart changes).
// StrictMode (dev) runs every mount effect twice; queued state updates apply after the effects, last one wins.
function startApp(storage, { oldCode, strict }) {
  let cart = oldCode ? [] : readStoredCart(storage); // useState([]) vs useState(() => readStoredCart(...))
  const queued = [];
  const runMountEffects = () => {
    if (oldCode) {
      const sc = storage.getItem(CART_STORAGE_KEY);
      if (sc) {
        try { queued.push(JSON.parse(sc)); } catch {}
      }
    }
    storage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); // save effect with the CURRENT (first-render) cart
  };
  runMountEffects();
  if (strict) runMountEffects(); // StrictMode: mount -> unmount -> mount again
  if (queued.length) {
    cart = queued[queued.length - 1];
    storage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); // save effect after the re-render
  }
  return cart;
}

test('model check: the OLD wiring loses a saved cart under StrictMode (the diagnosed U01 failure)', () => {
  const s = mem({ [CART_STORAGE_KEY]: JSON.stringify([ITEM]) });
  assert.deepEqual(startApp(s, { oldCode: true, strict: true }), []);
  assert.equal(s.getItem(CART_STORAGE_KEY), '[]');
});

for (const strict of [true, false]) {
  test(`saved cart survives app start and repeated refreshes (${strict ? 'StrictMode/dev' : 'production'})`, () => {
    const s = mem({ [CART_STORAGE_KEY]: JSON.stringify([ITEM]) });
    for (let refresh = 0; refresh < 3; refresh++) {
      assert.deepEqual(startApp(s, { oldCode: false, strict }), [ITEM], `refresh ${refresh}`);
      assert.deepEqual(JSON.parse(s.getItem(CART_STORAGE_KEY)), [ITEM], `stored after refresh ${refresh}`);
    }
  });
}

test('corrupted stored cart: app starts with an empty cart and the bad value is replaced by []', () => {
  const s = mem({ [CART_STORAGE_KEY]: '{broken' });
  assert.deepEqual(startApp(s, { oldCode: false, strict: true }), []);
  assert.equal(s.getItem(CART_STORAGE_KEY), '[]');
});

// ---------------------------------------------------------------- real React: the FIRST render already has the cart
test('React: the first render (before any effect) already holds the saved cart', () => {
  const s = mem({ [CART_STORAGE_KEY]: JSON.stringify([ITEM, { id: 'p-2', quantity: 1 }]) });
  function Probe() {
    const [cart] = React.useState(() => readStoredCart(s));
    return React.createElement('i', null, `items=${cart.length}`);
  }
  const html = renderToString(React.createElement(React.StrictMode, null, React.createElement(Probe)));
  assert.match(html, /items=2/);
});
