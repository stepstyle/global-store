// Smart auto-approval, phase 1: assessOrder() rules — pure, local, no network.
//   node --test test/unit/autoapproval.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessOrder, normaliseSettings, phoneFingerprint, reasonsText, REASON_AR, DEFAULT_AUTO_SETTINGS, ASSESSMENT_VERSION } from '../../src/autoapproval.js';

const ON = { enabled: true };
const LOCKS = { serverMode: 'on', approvalMode: 'telegram' };
const order = (o = {}) => ({
  items: [{ productId: 'p-simple', variantId: null, quantity: 2 }, { productId: 'p-variants', variantId: 'var_red', quantity: 1 }],
  address: { fullName: 'Test Buyer', phone: '+962791234567', city: 'عمّان - النزهة', street: 'شارع 1، عمارة 5' },
  addressMeta: { citySlug: 'amman', ammanAreaId: 'a1' },
  paymentMethod: 'cod',
  ...o,
});
/** a clean order that passes every check */
const input = ({ order: orderOverrides, ...o } = {}) => ({
  order: order(orderOverrides), status: 'new', warnings: [], serverTotal: 8.2, turnstileVerified: true, recentSamePhone: 0,
  phoneHash: 'a'.repeat(64), locks: LOCKS, settings: ON, ...o,
});
const codes = (r) => r.reasons.map((x) => x.code);
const review = (r, code) => {
  assert.equal(r.decision, 'manual_review', JSON.stringify(r));
  assert.ok(codes(r).includes(code), `${code} in ${codes(r)}`);
};

// ------------------------------------------------------------------ locks and defaults
test('defaults: the dashboard switch is OFF -> nothing is ever auto-accepted', () => {
  assert.equal(DEFAULT_AUTO_SETTINGS.enabled, false);
  for (const settings of [undefined, null, {}, { maxLineQty: 5 }]) {
    const r = assessOrder(input({ settings }));
    assert.equal(r.decision, 'disabled');
    assert.deepEqual(r.reasons, [{ code: 'AUTO_DISABLED', lock: 'dashboard' }]);
  }
});

test('three locks: server ceiling, approval mode and the dashboard switch must ALL be open', () => {
  assert.equal(assessOrder(input()).decision, 'auto_accept');
  assert.deepEqual(assessOrder(input({ locks: { ...LOCKS, serverMode: 'off' } })).reasons, [{ code: 'AUTO_DISABLED', lock: 'server' }]);
  assert.deepEqual(assessOrder(input({ locks: { ...LOCKS, serverMode: undefined } })).reasons[0].lock, 'server');
  assert.deepEqual(assessOrder(input({ locks: undefined })).reasons[0].lock, 'server');
  assert.deepEqual(assessOrder(input({ locks: { ...LOCKS, approvalMode: 'off' } })).reasons, [{ code: 'AUTO_DISABLED', lock: 'approval_mode' }]);
  assert.deepEqual(assessOrder(input({ settings: { enabled: false } })).reasons, [{ code: 'AUTO_DISABLED', lock: 'dashboard' }]);
});

test('a clean COD order inside every limit is auto-accepted, with the assessment version', () => {
  const r = assessOrder(input());
  assert.deepEqual(r, { decision: 'auto_accept', reasons: [], version: ASSESSMENT_VERSION });
});

// ------------------------------------------------------------------ data
test('data: missing / placeholder name, street, area, city and an invalid phone -> manual review', () => {
  for (const fullName of ['', ' ', 'x', 'Guest', 'guest']) review(assessOrder(input({ order: { address: { ...order().address, fullName } } })), 'NAME_MISSING');
  for (const street of ['', '   ', 'abc', 'لم يتم إدخال عنوان تفصيلي']) review(assessOrder(input({ order: { address: { ...order().address, street } } })), 'STREET_MISSING');
  for (const phone of ['', '0791234567', '+962612345678', '+96279123456', '+9627912345678']) review(assessOrder(input({ order: { address: { ...order().address, phone } } })), 'PHONE_INVALID');
  review(assessOrder(input({ order: { addressMeta: { citySlug: 'amman', ammanAreaId: '' } } })), 'AREA_MISSING');
  review(assessOrder(input({ order: { addressMeta: { citySlug: '' } } })), 'CITY_MISSING');
  assert.equal(assessOrder(input({ order: { addressMeta: { citySlug: 'irbid' } } })).decision, 'auto_accept', 'outside Amman needs no area');
});

// ------------------------------------------------------------------ delivery / price / stock / bots
test('delivery, price and stock warnings of the server\'s own pricing / inventory plan -> manual review', () => {
  for (const c of ['SHIPPING_UNKNOWN', 'FAST_OUTSIDE_AMMAN']) review(assessOrder(input({ warnings: [{ code: c }] })), 'DELIVERY_UNKNOWN');
  for (const c of ['PRICE_MISMATCH', 'PRICE_UNKNOWN']) review(assessOrder(input({ warnings: [{ code: c }] })), 'PRICE_PROBLEM');
  for (const c of ['STOCK_SHORTFALL', 'PRODUCT_NOT_FOUND', 'VARIANT_NOT_FOUND', 'DUPLICATE_VARIANT_ID', 'AMBIGUOUS_VARIANT', 'STOCK_UNTRACKED', 'STOCK_NOT_DEDUCTED']) {
    const r = assessOrder(input({ warnings: [{ code: c }] }));
    review(r, 'STOCK_PROBLEM');
    assert.deepEqual(r.reasons.find((x) => x.code === 'STOCK_PROBLEM').codes, [c]);
  }
  assert.equal(assessOrder(input({ warnings: [{ code: 'STOCK_STRING_NORMALIZED' }] })).decision, 'auto_accept', 'harmless normalisation');
});

test('bots: anything but a verified Turnstile token -> manual review', () => {
  for (const turnstileVerified of [false, undefined, null, 'true', 1]) review(assessOrder(input({ turnstileVerified })), 'BOT_CHECK_MISSING');
});

// ------------------------------------------------------------------ duplicates (24 h, same phone)
test('duplicates: another pending/accepted order of the same phone in the window -> manual review (never rejected)', () => {
  const r = assessOrder(input({ recentSamePhone: 1 }));
  review(r, 'DUPLICATE_PHONE');
  assert.deepEqual(r.reasons.find((x) => x.code === 'DUPLICATE_PHONE'), { code: 'DUPLICATE_PHONE', count: 1, windowHours: 24 });
  // the lookup failed / was not possible: fail safe
  for (const recentSamePhone of [null, undefined, -1, 0.5, '0']) review(assessOrder(input({ recentSamePhone })), 'DUPLICATE_CHECK_UNAVAILABLE');
});

// ------------------------------------------------------------------ quantities and value (boundaries)
test('quantity per line: 5 auto, 6 review', () => {
  assert.equal(assessOrder(input({ order: { items: [{ productId: 'p', quantity: 5 }] } })).decision, 'auto_accept');
  review(assessOrder(input({ order: { items: [{ productId: 'p', quantity: 6 }] } })), 'LINE_QTY_HIGH');
});

test('total pieces: 15 auto, 16 review', () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => ({ productId: `p${i}`, quantity: 1 }));
  assert.equal(assessOrder(input({ order: { items: [...lines(10), { productId: 'q', quantity: 5 }] } })).decision, 'auto_accept', '15');
  review(assessOrder(input({ order: { items: [...lines(11), { productId: 'q', quantity: 5 }] } })), 'TOTAL_QTY_HIGH');
});

test('order value: 50.00 JOD auto, 50.01 review; unknown total review', () => {
  assert.equal(assessOrder(input({ serverTotal: 50 })).decision, 'auto_accept');
  review(assessOrder(input({ serverTotal: 50.01 })), 'ORDER_TOTAL_HIGH');
  for (const serverTotal of [null, undefined, NaN, '8.2', Infinity]) review(assessOrder(input({ serverTotal })), 'TOTAL_UNKNOWN');
});

test('items: empty list or a non-integer quantity -> review', () => {
  review(assessOrder(input({ order: { items: [] } })), 'LINE_QTY_HIGH');
  review(assessOrder(input({ order: { items: [{ productId: 'p', quantity: 1.5 }] } })), 'LINE_QTY_HIGH');
});

// ------------------------------------------------------------------ payment, review list, status
test('CliQ is never automatic (payment not verified); unknown payment -> review', () => {
  review(assessOrder(input({ order: { paymentMethod: 'cliq' } })), 'CLIQ_NEEDS_VERIFICATION');
  review(assessOrder(input({ order: { paymentMethod: 'card' } })), 'PAYMENT_UNKNOWN');
});

test('review list by phone fingerprint; only status "new" may be auto-accepted', () => {
  const h = 'b'.repeat(64);
  review(assessOrder(input({ phoneHash: h, settings: { ...ON, blockedPhoneHashes: [h] } })), 'PHONE_BLOCKED');
  assert.equal(assessOrder(input({ phoneHash: h, settings: { ...ON, blockedPhoneHashes: ['c'.repeat(64)] } })).decision, 'auto_accept');
  for (const status of ['processing', 'cancelled', 'fraud', undefined]) review(assessOrder(input({ status })), 'NOT_NEW');
});

test('several problems are all reported, each once (Arabic summary for Telegram)', () => {
  const r = assessOrder(input({ order: { paymentMethod: 'cliq', items: [{ productId: 'p', quantity: 9 }] }, warnings: [{ code: 'STOCK_SHORTFALL' }, { code: 'STOCK_SHORTFALL' }], recentSamePhone: 2 }));
  assert.deepEqual(codes(r).sort(), ['CLIQ_NEEDS_VERIFICATION', 'DUPLICATE_PHONE', 'LINE_QTY_HIGH', 'STOCK_PROBLEM'].sort());
  const txt = reasonsText(r.reasons);
  assert.ok(txt.includes('دفع CliQ يحتاج تحققًا') && txt.includes('مشكلة في المخزون'));
  for (const c of codes(r)) assert.ok(REASON_AR[c], `Arabic text for ${c}`);
  assert.ok(!/Test Buyer|962791234567|شارع/.test(txt), 'no customer data in the summary');
});

// ------------------------------------------------------------------ settings
test('settings: custom limits apply; any malformed value disables auto-approval (fail-safe, never looser)', () => {
  assert.equal(assessOrder(input({ settings: { ...ON, maxLineQty: 2 } })).decision, 'auto_accept', 'qty 2 is fine');
  review(assessOrder(input({ settings: { ...ON, maxLineQty: 1 } })), 'LINE_QTY_HIGH');
  review(assessOrder(input({ settings: { ...ON, maxOrderTotal: 5 } })), 'ORDER_TOTAL_HIGH');
  assert.equal(assessOrder(input({ order: { paymentMethod: 'cliq' }, settings: { ...ON, allowCliq: true } })).decision, 'auto_accept', 'only if explicitly allowed');
  for (const bad of [{ enabled: 'yes' }, { maxLineQty: 0 }, { maxLineQty: '5' }, { maxTotalQty: 1e9 }, { maxOrderTotal: -1 }, { duplicateWindowHours: NaN }, { allowCliq: 1 }, { blockedPhoneHashes: ['+962791234567'] }, { blockedPhoneHashes: 'x' }]) {
    const r = assessOrder(input({ settings: { ...ON, ...bad } }));
    assert.equal(r.decision, 'disabled', JSON.stringify(bad));
    assert.equal(r.reasons[0].code, 'SETTINGS_INVALID');
  }
  assert.deepEqual(normaliseSettings(undefined), { ok: true, settings: { ...DEFAULT_AUTO_SETTINGS, blockedPhoneHashes: [] } });
});

test('purity: the input is not modified', () => {
  const i = input({ warnings: [{ code: 'PRICE_MISMATCH' }] });
  const before = JSON.stringify(i);
  assessOrder(i);
  assert.equal(JSON.stringify(i), before);
});

// ------------------------------------------------------------------ phone fingerprint
test('phone fingerprint: HMAC-SHA-256 hex, stable, secret-dependent, refuses bad input', async () => {
  const S1 = 's'.repeat(32), S2 = 't'.repeat(32);
  const a = await phoneFingerprint('+962791234567', S1);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(await phoneFingerprint('+962791234567', S1), a, 'stable');
  assert.notEqual(await phoneFingerprint('+962791234568', S1), a, 'other phone');
  assert.notEqual(await phoneFingerprint('+962791234567', S2), a, 'other secret');
  assert.ok(!a.includes('962791234567'));
  await assert.rejects(phoneFingerprint('0791234567', S1), TypeError);
  await assert.rejects(phoneFingerprint('+962791234567', 'short'), TypeError);
});
