// The landing product read on its own (an ad link straight to a product page): the rules, without a browser.
//   - only a real product link starts it; the id is checked; production = Firestore REST GET with the public key,
//     local tests = the emulator on 127.0.0.1 only
//   - the document is decoded EXACTLY as the SDK gives it, or not at all (a Timestamp / reference / GeoPoint / bytes,
//     a missing or foreign document, a network / rules error -> null = the page waits for the catalogue as before)
//   - started once per page load; another product id never gets it
//   node --test tests/unit/productEarly.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const E = await import('../../src/services/productEarly.ts');
beforeEach(() => E.__resetEarlyProduct());

const cloud = { kind: 'cloud', projectId: 'antastore1-82b50', apiKey: 'AIzaSyTESTkey_0123456789abcdef' };
const docName = (id) => `projects/antastore1-82b50/databases/(default)/documents/products/${id}`;

test('only a product link starts it, with a checked id', () => {
  assert.equal(E.landingProductId('#/product/p-1790801257923-752'), 'p-1790801257923-752');
  assert.equal(E.landingProductId('#/product/p-1?utm_source=facebook&fbclid=x'), 'p-1');
  assert.equal(E.landingProductId('#/product/p-1/'), 'p-1');
  for (const h of ['', '#/', '#/shop', '#/product/', '#/product/a%2Fb', '#/product/<x>', '#/checkout', '#/product/' + 'x'.repeat(200)]) {
    assert.equal(E.landingProductId(h), null, h);
  }
});

test('the address: Firestore REST GET + public key (cloud), the local emulator only (tests); nothing odd', () => {
  assert.equal(E.productDocUrl(cloud, 'p-1'), 'https://firestore.googleapis.com/v1/projects/antastore1-82b50/databases/(default)/documents/products/p-1?key=AIzaSyTESTkey_0123456789abcdef');
  assert.equal(E.productDocUrl({ kind: 'emulator', projectId: 'demo-x', host: '127.0.0.1', port: 8080 }, 'p-1'), 'http://127.0.0.1:8080/v1/projects/demo-x/databases/(default)/documents/products/p-1');
  assert.equal(E.productDocUrl({ kind: 'emulator', projectId: 'demo-x', host: 'evil.example', port: 8080 }, 'p-1'), null);
  assert.equal(E.productDocUrl({ ...cloud, apiKey: 'a b' }, 'p-1'), null);
  assert.equal(E.productDocUrl({ ...cloud, projectId: '../x' }, 'p-1'), null);
  assert.equal(E.productDocUrl(cloud, '../orders/x'), null);
});

test('decoded exactly like the SDK: strings, numbers, booleans, null, maps, arrays, + the id', () => {
  const json = {
    name: docName('p-1'),
    fields: {
      name: { stringValue: 'سكويشي' }, price: { doubleValue: 3.5 }, stock: { integerValue: '12' }, isNew: { booleanValue: true },
      note: { nullValue: null }, images: { arrayValue: { values: [{ stringValue: 'https://res.cloudinary.com/a.webp' }] } },
      emptyList: { arrayValue: {} }, emptyMap: { mapValue: {} },
      variants: { arrayValue: { values: [{ mapValue: { fields: { id: { stringValue: 'v1' }, stock: { integerValue: '0' }, price: { integerValue: '4' } } } }] } },
      imagePosition: { mapValue: { fields: { x: { integerValue: '50' }, y: { doubleValue: 40.5 }, zoom: { doubleValue: 1 } } } },
      nan: { doubleValue: 'NaN' }, inf: { doubleValue: 'Infinity' },
    },
    createTime: '2026-11-01T00:00:00Z', updateTime: '2026-11-02T00:00:00Z',
  };
  const p = E.decodeProductDocument(json, 'p-1');
  assert.deepEqual({ ...p, nan: undefined }, {
    name: 'سكويشي', price: 3.5, stock: 12, isNew: true, note: null, images: ['https://res.cloudinary.com/a.webp'], emptyList: [], emptyMap: {},
    variants: [{ id: 'v1', stock: 0, price: 4 }], imagePosition: { x: 50, y: 40.5, zoom: 1 }, nan: undefined, inf: Infinity, id: 'p-1',
  });
  assert.ok(Number.isNaN(p.nan));
  assert.equal(Object.getPrototypeOf(p.imagePosition), Object.prototype, 'plain objects, like the catalogue read');
});

test('anything the SDK gives as a special object -> null (the page waits for the catalogue)', () => {
  for (const v of [{ timestampValue: '2026-11-01T00:00:00Z' }, { referenceValue: docName('x') }, { geoPointValue: { latitude: 1, longitude: 2 } }, { bytesValue: 'AA==' }, { integerValue: '9007199254740993' }, { somethingNew: 1 }]) {
    assert.equal(E.decodeProductDocument({ name: docName('p-1'), fields: { a: v } }, 'p-1'), null, JSON.stringify(v));
    assert.equal(E.decodeProductDocument({ name: docName('p-1'), fields: { m: { mapValue: { fields: { deep: { arrayValue: { values: [v] } } } } } } }, 'p-1'), null, 'deep ' + JSON.stringify(v));
  }
  assert.equal(E.decodeProductDocument({ name: docName('p-2'), fields: {} }, 'p-1'), null, 'another document');
  assert.equal(E.decodeProductDocument({ error: { code: 403 } }, 'p-1'), null);
  assert.equal(E.decodeProductDocument(null, 'p-1'), null);
});

test('started once per page load, for the landing product only; errors / 404 / non-product links -> null or nothing', async () => {
  let calls = 0; let lastUrl = '';
  const ok = { fetch: async (u) => { calls++; lastUrl = u; return { status: 200, json: async () => ({ name: docName('p-1'), fields: { name: { stringValue: 'x' }, price: { integerValue: '5' } } }) }; } };
  E.startEarlyProduct(cloud, '#/product/p-1?fbclid=1', ok);
  E.startEarlyProduct(cloud, '#/product/p-1', ok);
  assert.equal(calls, 1, 'one request');
  assert.match(lastUrl, /documents\/products\/p-1\?key=/);
  assert.deepEqual(await E.earlyProduct('p-1'), { name: 'x', price: 5, id: 'p-1' });
  assert.equal(E.earlyProduct('p-2'), null, 'another product never gets it');

  for (const [hash, deps] of [
    ['#/product/p-1', { fetch: async () => ({ status: 404, json: async () => ({}) }) }],
    ['#/product/p-1', { fetch: async () => { throw new TypeError('offline'); } }],
    ['#/product/p-1', { fetch: async () => ({ status: 200, json: async () => { throw new SyntaxError('html'); } }) }],
  ]) {
    E.__resetEarlyProduct();
    E.startEarlyProduct(cloud, hash, deps);
    assert.equal(await E.earlyProduct('p-1'), null);
  }
  E.__resetEarlyProduct();
  calls = 0;
  E.startEarlyProduct(cloud, '#/shop', ok);
  E.startEarlyProduct(null, '#/product/p-1', ok);
  assert.equal(calls, 0);
  assert.equal(E.earlyProduct('p-1'), null);
});

test('samePlainData: key order ignored; any real difference (price, stock, a variant) is a difference', () => {
  const a = { id: 'p', price: 5, stock: 3, variants: [{ id: 'v', stock: 1 }], img: { x: 1, y: 2 } };
  assert.equal(E.samePlainData(a, { img: { y: 2, x: 1 }, variants: [{ stock: 1, id: 'v' }], stock: 3, price: 5, id: 'p' }), true);
  assert.equal(E.samePlainData(a, { ...a, price: 4 }), false);
  assert.equal(E.samePlainData(a, { ...a, stock: 2 }), false);
  assert.equal(E.samePlainData(a, { ...a, variants: [{ id: 'v', stock: 0 }] }), false);
  assert.equal(E.samePlainData(a, { ...a, extra: 1 }), false);
  assert.equal(E.samePlainData([1, 2], [2, 1]), false);
  assert.equal(E.samePlainData({ a: undefined, b: 1 }, { b: 1 }), true);
});

// ---- the same read started by index.html (scripts/product-early.mjs) and taken over by the app
const { productEarlyScript, publicFirebaseIds } = await import('../../scripts/product-early.mjs');
const { readFileSync } = await import('node:fs');

test('index.html script: production only, ids read from firebase.ts like the guards; nothing odd is written', () => {
  const ids = publicFirebaseIds(readFileSync(new URL('../../src/services/firebase.ts', import.meta.url), 'utf8'));
  assert.ok(ids && ids.apiKey && ids.projectId, 'read from the Option B config');
  const html = productEarlyScript({ deployEnv: 'production', ids });
  assert.match(html, /^<script>try\{/);
  assert.ok(html.includes(`/v1/projects/${ids.projectId}/databases/(default)/documents/products/`));
  assert.ok(!/POST|headers|credentials:'include'/.test(html), 'a plain GET without credentials');
  for (const env of ['sandbox', 'local-test']) assert.equal(productEarlyScript({ deployEnv: env, ids }), '', env);
  assert.equal(productEarlyScript({ deployEnv: 'production', ids: null }), '');
  assert.equal(productEarlyScript({ deployEnv: 'production', ids: { apiKey: 'x"</script>', projectId: 'p' } }), '');
  assert.equal(publicFirebaseIds('const cfg = { apiKey: "x" }'), null, 'no Option B block -> nothing');
});

test('index.html script runs the SAME id rule as the app, and hands over one promise', async () => {
  const ids = { apiKey: 'AIzaSyTESTkey_0123456789abcdef', projectId: 'antastore1-82b50' };
  const body = productEarlyScript({ deployEnv: 'production', ids }).replace(/^<script>/, '').replace(/<\/script>$/, '');
  for (const hash of ['#/product/p-1?fbclid=1', '#/product/p-1/', '#/shop', '#/product/a%2Fb', '#/product/<x>', '']) {
    const win = {}; let url = null;
    new Function('window', 'location', 'fetch', body)(win, { hash }, (u) => { url = u; return Promise.resolve({ status: 200, json: async () => ({}) }); });
    const expected = E.landingProductId(hash);
    assert.equal(win.__productEarly ? win.__productEarly.id : null, expected, hash);
    if (expected) assert.equal(url, E.productDocUrl({ kind: 'cloud', ...ids }, expected), 'same address as the app');
    else assert.equal(url, null);
  }
});

test('handover: same product + same project -> no second request; otherwise / failed -> the app asks itself', async () => {
  const docJson = { name: docName('p-1'), fields: { name: { stringValue: 'early' } } };
  const appFetch = () => { let n = 0; return { get n() { return n; }, fetch: async () => { n++; return { status: 200, json: async () => ({ name: docName('p-1'), fields: { name: { stringValue: 'app' } } }) }; } }; };

  let f = appFetch(); let win = { __productEarly: { id: 'p-1', projectId: cloud.projectId, r: Promise.resolve(docJson) } };
  E.startEarlyProduct(cloud, '#/product/p-1', { fetch: f.fetch, win });
  assert.equal((await E.earlyProduct('p-1')).name, 'early'); assert.equal(f.n, 0); assert.equal(win.__productEarly, undefined, 'taken once');

  for (const handed of [
    { id: 'p-1', projectId: 'another-project', r: Promise.resolve(docJson) }, // an admin's project override
    { id: 'p-2', projectId: cloud.projectId, r: Promise.resolve(docJson) },   // another product
    { id: 'p-1', projectId: cloud.projectId, r: Promise.resolve(null) },      // the page's request failed
    { id: 'p-1', projectId: cloud.projectId, r: Promise.reject(new Error('x')) },
  ]) {
    E.__resetEarlyProduct(); f = appFetch();
    E.startEarlyProduct(cloud, '#/product/p-1', { fetch: f.fetch, win: { __productEarly: handed } });
    assert.equal((await E.earlyProduct('p-1')).name, 'app'); assert.equal(f.n, 1);
  }
  E.__resetEarlyProduct(); f = appFetch(); // the emulator (local tests) never takes a page answer
  E.startEarlyProduct({ kind: 'emulator', projectId: 'antastore1-82b50', host: '127.0.0.1', port: 8080 }, '#/product/p-1', { fetch: f.fetch, win: { __productEarly: { id: 'p-1', projectId: 'antastore1-82b50', r: Promise.resolve(docJson) } } });
  assert.equal((await E.earlyProduct('p-1')).name, 'app');
});
