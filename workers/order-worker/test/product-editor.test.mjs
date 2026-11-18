// The admin product editor + CSV import vs. stock on delivery — LOCAL ONLY: Firestore EMULATOR (demo- project) under
// firebase/firestore.rules.on-delivery, the REAL browser functions (src/services/stockMerge.ts saveProductGuarded,
// src/services/csvImport.ts createProductsIfAbsent) through the Firebase SDK as a signed-in admin, and the REAL Worker
// (src/index.js) for orders / deliveries. Synthetic products only.
//   firebase emulators:exec --only firestore --project demo-dairsharaf-orders --config test/firebase.json \
//     "node --test --test-concurrency=1 test/product-editor.test.mjs"
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, runTransaction } from 'firebase/firestore';
import {
  startMockServices, makeEnv, callWorker, createOrderReq, clearDb, seedProducts, putDoc, getDecoded,
  productStock, variantStock, emulatorHost, PROJECT_ID,
} from './helpers.mjs';
import { checkoutOrder, line, makeOrderId, PRODUCTS } from './fixtures.mjs';
import { makeTestSigner } from './token-signer.mjs';
import { saveProductGuarded, StaleStockError } from '../../../src/services/stockMerge.ts';
import { createProductsIfAbsent } from '../../../src/services/csvImport.ts';

const RULES = readFileSync(new URL('../../../firebase/firestore.rules.on-delivery', import.meta.url), 'utf8');
const OWNER = 'owner-uid-0001';
const ADMIN = 'admin-uid-0002';
const SIZES = { name: 'قميص', price: 4, stock: 0, variants: [{ id: 'size_s', label: 'S', type: 'size', price: 4, stock: 3 }, { id: 'size_m', label: 'M', type: 'size', price: 4, stock: 1 }] };
const sizeLine = (vid, q) => ({ productId: 'p-sizes', name: 'قميص', price: 4, quantity: q, image: '', selectedVariant: { ...SIZES.variants.find((v) => v.id === vid) } });
const api = { runTransaction, doc };
let mock, signer, rulesEnv;
const env = () => makeEnv(mock.url, { STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply' });

before(async () => {
  mock = await startMockServices();
  signer = await makeTestSigner('kid-editor');
  const [host, port] = emulatorHost().split(':');
  rulesEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: RULES, host, port: Number(port) } });
});
after(async () => { await rulesEnv?.cleanup(); await mock?.close(); });
beforeEach(async () => {
  mock.reset();
  mock.state.jwks = { keys: [signer.jwk] };
  await clearDb();
  await seedProducts();
  await putDoc('products/p-sizes', SIZES);
  await putDoc('config/roles', { ownerUid: OWNER });
  await putDoc(`admins/${ADMIN}`, { active: true });
});

const adminDb = () => rulesEnv.authenticatedContext(ADMIN).firestore();
/** what the editor page holds: the product as it was when the page was opened */
const openEditor = async (id) => ({ id, ...(await getDoc(doc(adminDb(), 'products', id))).data() });
const save = (product, baseline) => saveProductGuarded(api, adminDb(), product, baseline);
async function newOrder(items) {
  const o = checkoutOrder({ id: makeOrderId(), items });
  const r = await createOrderReq(env(), o);
  assert.equal(r.status, 200, r.text);
  return o;
}
async function tryOrder(items) {
  return createOrderReq(env(), checkoutOrder({ id: makeOrderId(), items }));
}
async function setStatus(id, status) {
  const t = await signer.idToken({ projectId: PROJECT_ID, uid: OWNER });
  return callWorker(env(), { method: 'POST', path: `/admin/orders/${id}/status`, headers: { authorization: `Bearer ${t}` }, body: { status } });
}
const reserved = async (pid, vid = null) => {
  const r = await getDecoded(`stockReservations/${pid}`);
  return r ? (vid ? r.variants?.[vid] : r.product) || 0 : 0;
};

// E1 ---------------------------------------------------------------------------------------------------------------
test('E1. editor opened BEFORE a delivery, saved AFTER it (name changed only): the deduction is kept (simple product)', async () => {
  const o = await newOrder([line('p-simple', 3)]);
  const editor = await openEditor('p-simple');
  assert.equal(editor.stock, 10);
  assert.equal((await setStatus(o.id, 'delivered')).status, 200);
  assert.equal(await productStock('p-simple'), 7);
  await save({ ...editor, name: 'دفتر جديد' }, editor);
  assert.equal(await productStock('p-simple'), 7, 'delivery not undone');
  assert.equal((await getDecoded('products/p-simple')).name, 'دفتر جديد');
});

test('E1-control. the OLD save (plain set merge of the stale form) WOULD undo the delivery — proves E1 tests something', async () => {
  const o = await newOrder([line('p-simple', 3)]);
  const editor = await openEditor('p-simple');
  await setStatus(o.id, 'delivered');
  await setDoc(doc(adminDb(), 'products', 'p-simple'), { ...editor, name: 'x' }, { merge: true });
  assert.equal(await productStock('p-simple'), 10, 'the bug the guard prevents');
});

test('E2. colours and sizes: the whole variants array is rewritten by the editor, yet every delivered variant keeps its deduction', async () => {
  const o = await newOrder([line('p-variants', 2, { variantId: 'var_red' }), sizeLine('size_s', 2)]);
  const colours = await openEditor('p-variants');
  const sizes = await openEditor('p-sizes');
  assert.equal((await setStatus(o.id, 'delivered')).status, 200);
  // admin changes a label / price of OTHER variants only and saves the whole array
  await save({ ...colours, variants: colours.variants.map((v) => (v.id === 'var_blue' ? { ...v, label: 'أزرق غامق', price: 3.75 } : v)) }, colours);
  await save({ ...sizes, variants: sizes.variants.map((v) => (v.id === 'size_m' ? { ...v, label: 'Medium' } : v)) }, sizes);
  assert.equal(await variantStock('p-variants', 'var_red'), 3, 'red: 5 - 2 kept');
  assert.equal(await variantStock('p-sizes', 'size_s'), 1, 'S: 3 - 2 kept');
  assert.equal((await getDecoded('products/p-variants')).variants.find((v) => v.id === 'var_blue').label, 'أزرق غامق');
});

test('E3. the admin changed the SAME stock number that a delivery changed meanwhile: refused (StaleStockError), nothing written', async () => {
  const o = await newOrder([line('p-simple', 3), line('p-variants', 1, { variantId: 'var_red' }), sizeLine('size_s', 1)]);
  const simple = await openEditor('p-simple');
  const colours = await openEditor('p-variants');
  const sizes = await openEditor('p-sizes');
  await setStatus(o.id, 'delivered');
  const attempts = [
    ['simple', () => save({ ...simple, stock: 50, name: 'x' }, simple), 'p-simple', 7],
    ['colour', () => save({ ...colours, variants: colours.variants.map((v) => (v.id === 'var_red' ? { ...v, stock: 50 } : v)) }, colours), 'p-variants', 4],
    ['size', () => save({ ...sizes, variants: sizes.variants.map((v) => (v.id === 'size_s' ? { ...v, stock: 50 } : v)) }, sizes), 'p-sizes', 2],
  ];
  for (const [name, run, pid, expected] of attempts) {
    await assert.rejects(run, StaleStockError, name);
    const p = await getDecoded(`products/${pid}`);
    const now = pid === 'p-simple' ? p.stock : p.variants.find((v) => v.id === (pid === 'p-variants' ? 'var_red' : 'size_s')).stock;
    assert.equal(now, expected, `${name}: unchanged`);
    assert.notEqual(p.name, 'x');
  }
  // reopened (fresh baseline): the admin's correction is accepted
  const fresh = await openEditor('p-simple');
  await save({ ...fresh, stock: 50 }, fresh);
  assert.equal(await productStock('p-simple'), 50);
});

// E4 ---------------------------------------------------------------------------------------------------------------
test('E4. editing a product never touches its reservations: the last piece / last size stays protected after a save', async () => {
  const a = await newOrder([line('p-last-one', 1)]);
  const b = await newOrder([sizeLine('size_m', 1)]);
  for (const id of ['p-last-one', 'p-sizes']) {
    const e = await openEditor(id);
    await save({ ...e, name: `${e.name} (معدّل)`, ...(e.variants ? { variants: e.variants.map((v) => ({ ...v })) } : {}) }, e);
  }
  assert.equal(await reserved('p-last-one'), 1);
  assert.equal(await reserved('p-sizes', 'size_m'), 1);
  assert.equal((await tryOrder([line('p-last-one', 1)])).body.code, 'OUT_OF_STOCK', 'still sold out');
  assert.equal((await tryOrder([sizeLine('size_m', 1)])).body.code, 'OUT_OF_STOCK', 'size M still sold out');
  // and the browser cannot touch the reservations themselves
  await assertFails(setDoc(doc(adminDb(), 'stockReservations', 'p-last-one'), { product: 0 }));
  assert.equal((await setStatus(a.id, 'delivered')).status, 200);
  assert.equal((await setStatus(b.id, 'delivered')).status, 200);
  assert.equal(await productStock('p-last-one'), 0);
  assert.equal(await variantStock('p-sizes', 'size_m'), 0);
});

test('E5. the editor sets a stock LOWER than what is reserved: no overselling — new orders refused, the delivery refused, nothing goes negative', async () => {
  const o = await newOrder([line('p-simple', 3), line('p-variants', 4, { variantId: 'var_red' })]);
  const simple = await openEditor('p-simple');
  const colours = await openEditor('p-variants');
  await save({ ...simple, stock: 2 }, simple); // 3 reserved
  await save({ ...colours, variants: colours.variants.map((v) => (v.id === 'var_red' ? { ...v, stock: 1 } : v)) }, colours); // 4 reserved
  assert.equal((await tryOrder([line('p-simple', 1)])).body.code, 'OUT_OF_STOCK');
  assert.equal((await tryOrder([line('p-variants', 1, { variantId: 'var_red' })])).body.code, 'OUT_OF_STOCK');
  const d = await setStatus(o.id, 'delivered');
  assert.equal(d.status, 409);
  assert.equal(d.body.code, 'INSUFFICIENT_STOCK');
  assert.equal(await productStock('p-simple'), 2);
  assert.equal(await variantStock('p-variants', 'var_red'), 1);
  // a real restock (raised again) lets the delivery through, once
  const s2 = await openEditor('p-simple');
  const c2 = await openEditor('p-variants');
  await save({ ...s2, stock: 5 }, s2);
  await save({ ...c2, variants: c2.variants.map((v) => (v.id === 'var_red' ? { ...v, stock: 6 } : v)) }, c2);
  assert.equal((await setStatus(o.id, 'delivered')).status, 200);
  assert.equal(await productStock('p-simple'), 2);
  assert.equal(await variantStock('p-variants', 'var_red'), 2);
  assert.equal(await reserved('p-simple'), 0);
});

// E6 ---------------------------------------------------------------------------------------------------------------
test('E6. CSV import (real function, signed-in admin): existing products — simple, colours, sizes — stay EXACTLY as they were; new ones are created', async () => {
  await newOrder([line('p-simple', 2)]);
  const before = {};
  for (const id of ['p-simple', 'p-variants', 'p-sizes']) before[id] = JSON.stringify((await getDecoded(`products/${id}`)).__raw.fields);
  await putDoc('products/p-rated', { name: 'مقيّم', price: 1, stock: 4, ratingAvg: 4.5, ratingCount: 12 });
  const ratedBefore = JSON.stringify((await getDecoded('products/p-rated')).__raw.fields);
  const csv = [
    { id: 'p-simple', name: 'csv', price: 9, stock: 0, rating: 0, reviews: 0 },
    { id: 'p-variants', name: 'csv', price: 9, stock: 100, images: [] },
    { id: 'p-sizes', name: 'csv', price: 9, stock: 7 },
    { id: 'p-rated', name: 'csv', price: 9, stock: 0, ratingAvg: 0, ratingCount: 0 },
    { id: 'csv-new-1', name: 'جديد', price: 2, stock: 5 },
    { id: 'csv-new-2', name: 'جديد ٢', price: 3, stock: 0 },
  ];
  const r = await createProductsIfAbsent(api, adminDb(), csv);
  assert.deepEqual(r.added.sort(), ['csv-new-1', 'csv-new-2']);
  assert.deepEqual(r.existing.sort(), ['p-rated', 'p-simple', 'p-sizes', 'p-variants']);
  for (const id of ['p-simple', 'p-variants', 'p-sizes']) assert.equal(JSON.stringify((await getDecoded(`products/${id}`)).__raw.fields), before[id], `${id} untouched`);
  assert.equal(JSON.stringify((await getDecoded('products/p-rated')).__raw.fields), ratedBefore, 'ratings untouched');
  assert.equal((await getDecoded('products/csv-new-1')).stock, 5);
  assert.equal(await reserved('p-simple'), 2, 'reservation untouched');
  // a customer cannot use the same path
  await assert.rejects(createProductsIfAbsent(api, rulesEnv.authenticatedContext('someone').firestore(), [{ id: 'csv-new-3', price: 1 }]));
});
