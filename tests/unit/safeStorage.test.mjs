// src/config/safeStorage.ts: a browser that refuses web storage gets an in-memory one; a working storage is untouched.
//   node --test tests/unit/safeStorage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSafeStorage, memoryStorage, storageWorks } from '../../src/config/safeStorage.ts';

const refusedGetter = () => { const w = {}; Object.defineProperty(w, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } }); Object.defineProperty(w, 'sessionStorage', { configurable: true, get() { throw new Error('SecurityError'); } }); return w; };
const refusedMethods = () => { const boom = () => { throw new Error('SecurityError'); }; const s = { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 }; return { localStorage: s, sessionStorage: s }; };

test('storage refused on access (Safari "Block All Cookies"): replaced by memory, readable and writable', () => {
  const w = refusedGetter();
  installSafeStorage(w);
  w.localStorage.setItem('anta_cart', '[1]');
  assert.equal(w.localStorage.getItem('anta_cart'), '[1]');
  w.sessionStorage.setItem('x', 'y');
  assert.equal(w.sessionStorage.getItem('x'), 'y');
  assert.equal(w.localStorage.getItem('missing'), null);
});

test('storage whose calls throw (quota 0 / blocked site data): replaced too', () => {
  const w = refusedMethods();
  installSafeStorage(w);
  assert.doesNotThrow(() => w.localStorage.setItem('language', 'ar'));
  assert.equal(w.localStorage.getItem('language'), 'ar');
});

test('a working storage is NOT replaced (the same object stays, its data kept)', () => {
  const real = memoryStorage();
  real.setItem('keep', '1');
  const w = { localStorage: real, sessionStorage: real };
  installSafeStorage(w);
  assert.equal(w.localStorage, real);
  assert.equal(w.localStorage.getItem('keep'), '1');
  assert.equal(real.getItem('__anta_storage_probe__'), null, 'the probe key is removed');
});

test('memoryStorage behaves like Storage (length, key, removeItem, clear, string values)', () => {
  const s = memoryStorage();
  s.setItem('a', 1);
  s.setItem('b', '2');
  assert.equal(s.length, 2);
  assert.equal(s.key(0), 'a');
  assert.equal(s.getItem('a'), '1');
  s.removeItem('a');
  assert.equal(s.length, 1);
  s.clear();
  assert.equal(s.length, 0);
  assert.equal(storageWorks(() => s), true);
  assert.equal(storageWorks(() => null), false);
});
