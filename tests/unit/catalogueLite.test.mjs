// The catalogue read through Firestore Lite is used only for PLAIN product data (storage.ts / plainData.ts).
//   node --test tests/unit/catalogueLite.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasSpecialValue } from '../../src/services/plainData.ts';

test('catalogue guard: plain product data is accepted as is', () => {
  const p = { id: 'p', name: 'دفتر', price: 2.5, stock: 3, images: ['https://x/a.webp'], variants: [{ id: 'v', price: 1, colorCode: '#fff', image: null }], tags: [], imagePosition: { x: 50, y: 50, zoom: 1 }, isNew: true };
  assert.equal(hasSpecialValue(p), false);
  assert.equal(hasSpecialValue(Object.assign(Object.create(null), { a: 1 })), false);
});

test('catalogue guard: a class instance (Timestamp, GeoPoint, reference, Bytes…) anywhere -> the full SDK read is used', () => {
  class Timestamp { constructor() { this.seconds = 1; this.nanoseconds = 0; } toMillis() { return 1000; } }
  assert.equal(hasSpecialValue({ createdAt: new Timestamp() }), true);
  assert.equal(hasSpecialValue({ variants: [{ at: new Timestamp() }] }), true);
  assert.equal(hasSpecialValue({ deep: { deeper: [{ when: new Date() }] } }), true);
  assert.equal(hasSpecialValue({ bytes: new Uint8Array(2) }), true);
});
