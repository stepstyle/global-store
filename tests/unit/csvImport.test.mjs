// src/services/csvImport.ts — CSV import never overwrites an existing product (fake transaction, no network).
//   node --test tests/unit/csvImport.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCsvImport, csvImportMessageAr, createProductsIfAbsent, ProductExistsError, CREATE_CHUNK, checkCsvRow } from '../../src/services/csvImport.ts';

const c = (row, id, extra = {}) => ({ row, product: { id, name: id, price: 1, stock: 5, ...extra } });

test('rows whose id already exists are refused (simple and colour / size products alike); new ids accepted', () => {
  const existing = ['p-simple', 'p-colours', 'p-sizes'];
  const r = planCsvImport([c(2, 'p-simple', { stock: 0 }), c(3, 'new-1'), c(4, 'p-colours'), c(5, 'p-sizes', { stock: 99 }), c(6, 'new-2')], existing);
  assert.deepEqual(r.accepted.map((x) => x.product.id), ['new-1', 'new-2']);
  assert.deepEqual(r.rejected, [
    { row: 2, id: 'p-simple', reason: 'EXISTS' }, { row: 4, id: 'p-colours', reason: 'EXISTS' }, { row: 5, id: 'p-sizes', reason: 'EXISTS' },
  ]);
});

test('the same id twice in one file: only the first row is kept', () => {
  const r = planCsvImport([c(2, 'n1', { stock: 3 }), c(3, 'n1', { stock: 0 }), c(4, 'n2')], []);
  assert.deepEqual(r.accepted.map((x) => [x.row, x.product.stock]), [[2, 3], [4, 5]]);
  assert.deepEqual(r.rejected, [{ row: 3, id: 'n1', reason: 'DUPLICATE_IN_FILE' }]);
});

test('admin message: counts, line numbers, reason, and that nothing existing was changed; long lists are bounded', () => {
  const m = csvImportMessageAr(2, [{ row: 4, id: 'p1', reason: 'EXISTS' }, { row: 7, id: 'n1', reason: 'DUPLICATE_IN_FILE' }]);
  assert.match(m, /تمت إضافة 2 منتج جديد/);
  assert.match(m, /رُفض 2 صف/);
  assert.match(m, /لا يُعدَّل أي منتج موجود/);
  assert.match(m, /السطر 4 \(p1\): المعرّف موجود مسبقًا/);
  assert.match(m, /السطر 7 \(n1\): المعرّف مكرر في الملف/);
  const many = Array.from({ length: 25 }, (_, i) => ({ row: i + 2, id: `x${i}`, reason: 'EXISTS' }));
  assert.match(csvImportMessageAr(0, many), /و15 صفوف أخرى/);
  assert.doesNotMatch(csvImportMessageAr(3, []), /رُفض/);
});

// fake Firestore transaction: a Map of documents
function fakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial));
  let tx = 0;
  return {
    docs, txCount: () => tx,
    api: {
      doc: (_db, col, id) => `${col}/${id}`,
      runTransaction: async (_db, fn) => {
        tx++;
        const writes = [];
        await fn({ get: async (ref) => ({ exists: () => docs.has(ref) }), set: (ref, data) => writes.push([ref, data]) });
        for (const [ref, data] of writes) docs.set(ref, data);
      },
    },
  };
}

test('createProductsIfAbsent: existing products (incl. colour / size variants and ratings) are never touched; new ones created', async () => {
  const existing = { stock: 7, variants: [{ id: 'red', stock: 2 }, { id: 'size_m', stock: 1 }], ratingAvg: 4.5, ratingCount: 8 };
  const db = fakeDb({ 'products/p1': existing });
  const r = await createProductsIfAbsent(db.api, null, [{ id: 'p1', stock: 0, variants: [] }, { id: 'n1', stock: 3 }]);
  assert.deepEqual(r, { added: ['n1'], existing: ['p1'] });
  assert.equal(db.docs.get('products/p1'), existing, 'same object: not rewritten');
  assert.deepEqual(db.docs.get('products/n1'), { id: 'n1', stock: 3 });
});

test('createProductsIfAbsent: large files are written in chunks (<= 500 writes per transaction)', async () => {
  const db = fakeDb();
  const list = Array.from({ length: CREATE_CHUNK * 2 + 5 }, (_, i) => ({ id: `n${i}` }));
  const r = await createProductsIfAbsent(db.api, null, list);
  assert.equal(r.added.length, list.length);
  assert.equal(db.txCount(), 3);
  assert.ok(CREATE_CHUNK <= 500);
});

test('ProductExistsError (single "add product"): Arabic message naming the id, never an overwrite', () => {
  const e = new ProductExistsError(['p1']);
  assert.match(e.message, /p1/);
  assert.match(e.message, /لم يُعدَّل المنتج الموجود/);
});

// ------------------------------------------------------------------ incomplete rows (no placeholders)
const CATS = ['Stationery', 'Games', 'BabyGear', 'Gifts'];
const IMG = 'https://res.cloudinary.com/demo/image/upload/v1/a.webp';
const full = (x = {}) => ({ id: 'p-A017', nameAr: 'دفتر 100 ورقة', nameEn: 'Notebook', price: '1.25', stock: '12', category: 'Stationery', image: IMG, description: '', ...x });

test('a complete row is accepted exactly as written (no defaults added)', () => {
  const r = checkCsvRow(full({ images: `${IMG}|https://res.cloudinary.com/demo/image/upload/v1/b.webp`, subCategory: 'notebooks', originalPrice: '2' }), CATS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields, {
    id: 'p-A017', name: 'دفتر 100 ورقة', nameEn: 'Notebook', price: 1.25, stock: 12, category: 'Stationery', description: '',
    image: IMG, images: [IMG, 'https://res.cloudinary.com/demo/image/upload/v1/b.webp'], originalPrice: 2, subCategory: 'notebooks',
  });
  assert.equal(checkCsvRow(full({ stock: '0' }), CATS).ok, true, 'stock 0 is a real value');
});

test('missing / invalid id, name, price, stock, category or image -> refused, never filled in', () => {
  const errs = (x) => { const r = checkCsvRow(full(x), CATS); assert.equal(r.ok, false, JSON.stringify(x)); return r.errors; };
  assert.deepEqual(errs({ id: '' }), ['MISSING_ID'], 'no generated id: a re-import could duplicate');
  assert.deepEqual(errs({ nameAr: '', nameEn: '' }), ['MISSING_NAME']);
  assert.deepEqual(errs({ price: '' }), ['MISSING_PRICE']);
  for (const p of ['0', '-1', 'abc', '3,5', '1.2.3']) assert.deepEqual(errs({ price: p }), ['INVALID_PRICE'], p);
  assert.deepEqual(errs({ stock: '' }), ['MISSING_STOCK'], 'no default stock 0');
  for (const s of ['-2', '1.5', 'many']) assert.deepEqual(errs({ stock: s }), ['INVALID_STOCK'], s);
  assert.deepEqual(errs({ category: '' }), ['MISSING_CATEGORY'], 'no default Stationery');
  assert.deepEqual(errs({ category: 'Toys' }), ['UNKNOWN_CATEGORY']);
  assert.deepEqual(errs({ image: '' }), ['MISSING_IMAGE'], 'no demo picture');
  for (const u of ['https://picsum.photos/400/400', 'http://res.cloudinary.com/x.jpg', 'not a url', 'https://via.placeholder.com/300']) assert.deepEqual(errs({ image: u }), ['INVALID_IMAGE'], u);
  assert.deepEqual(errs({ id: '', price: '', image: '' }), ['MISSING_ID', 'MISSING_PRICE', 'MISSING_IMAGE'], 'every problem is reported');
});

test('the admin message lists every reason of an incomplete row in Arabic', () => {
  const m = csvImportMessageAr(1, [{ row: 3, id: 'p-A2', reason: 'MISSING_PRICE', details: ['MISSING_PRICE', 'MISSING_IMAGE'] }, { row: 5, id: '', reason: 'MISSING_ID', details: ['MISSING_ID'] }]);
  assert.match(m, /السطر 3 \(p-A2\): لا يوجد سعر، لا توجد صورة/);
  assert.match(m, /السطر 5: لا يوجد معرّف/);
});
