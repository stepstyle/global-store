// firebase/firestore.indexes.json vs the storefront's REAL Firestore queries — LOCAL, static (no Firebase at all).
// Every equality + orderBy query that the app runs must have its composite index; nothing speculative is listed.
//   node --test tools/firestore-indexes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const idx = JSON.parse(readFileSync(join(ROOT, 'firebase/firestore.indexes.json'), 'utf8'));
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
const ALL_SRC = walk(join(ROOT, 'src')).map((p) => ({ p, t: readFileSync(p, 'utf8') }));
const has = (coll, fields) => idx.indexes.some((i) => i.collectionGroup === coll && i.queryScope === 'COLLECTION'
  && JSON.stringify(i.fields) === JSON.stringify(fields.map(([f, o]) => ({ fieldPath: f, order: o }))));

test('format: the Firebase CLI indexes file shape (indexes[] + fieldOverrides[]), valid orders only', () => {
  assert.deepEqual(Object.keys(idx).sort(), ['fieldOverrides', 'indexes']);
  for (const i of idx.indexes) {
    assert.deepEqual(Object.keys(i).sort(), ['collectionGroup', 'fields', 'queryScope']);
    assert.ok(i.fields.length >= 2);
    for (const f of i.fields) assert.ok(['ASCENDING', 'DESCENDING'].includes(f.order), JSON.stringify(f));
  }
  assert.equal(idx.indexes.length, 2, 'only the two confirmed indexes — nothing speculative');
});

test('reviews.ts: product reviews list where(productId ==) + orderBy(createdAt desc) -> reviews(productId ASC, createdAt DESC)', () => {
  assert.match(src('src/services/reviews.ts'), /query\(col, where\('productId', '==', pid\), orderBy\('createdAt', 'desc'\)\)/);
  assert.ok(has('reviews', [['productId', 'ASCENDING'], ['createdAt', 'DESCENDING']]));
});

test('storage.ts: my orders / purchase check where(userId ==) + orderBy(createdAt desc) -> orders(userId ASC, createdAt DESC)', () => {
  assert.match(src('src/services/storage.ts'), /query\(collection\(firestore, 'orders'\), where\('userId', '==', userId\), orderBy\('createdAt', 'desc'\)\)/);
  assert.ok(has('orders', [['userId', 'ASCENDING'], ['createdAt', 'DESCENDING']]));
});

test('no other composite index is needed by code that actually runs', () => {
  // products: the storefront reads products.getAll / getById (no orderBy+filter); products.list (filters) has NO caller
  const listCallers = ALL_SRC.filter(({ p, t }) => !p.endsWith('storage.ts') && /products\.list\(/.test(t));
  assert.deepEqual(listCallers.map((x) => x.p), [], 'products.list is unused — if it gets a caller, add its indexes here');
  // AdminOrders.tsx (status + createdAt) is not imported anywhere
  assert.deepEqual(ALL_SRC.filter(({ t }) => /from ['"][^'"]*AdminOrders['"]/.test(t)).map((x) => x.p), [], 'AdminOrders.tsx is unused');
  // equality-only multi-field queries (reviews productId + userId) need no composite index; orderBy alone neither
  const combos = ALL_SRC.flatMap(({ p, t }) => [...t.matchAll(/query\([^;]*?where\([^;]*?orderBy\([^;]*?\)/g)].map((m) => `${p.replace(ROOT, '')}: ${m[0].slice(0, 120)}`));
  const known = combos.filter((c) => !/reviews\.ts|storage\.ts|AdminOrders\.tsx/.test(c));
  assert.deepEqual(known, [], 'a new where+orderBy query appeared — it needs an index entry');
});
