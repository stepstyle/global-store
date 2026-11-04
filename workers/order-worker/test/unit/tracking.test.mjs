// Tracking key + order summary projection (src/tracking.js) — pure, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrackingKey, hashTrackingKey, sameHex, projectSummary, TRACKING_KEY_HASH_RE } from '../../src/tracking.js';

const KEY = '7K3M9P2Q4R6T8V0W1X5Y7Z9A';

test('normalizeTrackingKey: groups, case, Crockford look-alikes; rejects anything else', () => {
  assert.equal(normalizeTrackingKey(KEY), KEY);
  assert.equal(normalizeTrackingKey('7k3m-9p2q-4r6t-8v0w-1x5y-7z9a'), KEY);
  assert.equal(normalizeTrackingKey(' 7K3M 9P2Q 4R6T 8V0W 1X5Y 7Z9A '), KEY);
  assert.equal(normalizeTrackingKey('7K3M9P2Q4R6T8VOW1X5Y7Z9A'), KEY, 'O read as 0');
  assert.equal(normalizeTrackingKey('7K3M9P2Q4R6T8V0WIX5Y7Z9A'), '7K3M9P2Q4R6T8V0W1X5Y7Z9A', 'I read as 1');
  for (const bad of [null, undefined, 42, '', 'short', KEY + 'A', KEY.slice(1), '7K3M9P2Q4R6T8V0W1X5Y7Z9U', 'x'.repeat(100), '7K3M9P2Q4R6T8V0W1X5Y7Z9!']) {
    assert.equal(normalizeTrackingKey(bad), null, String(bad));
  }
});

test('hashTrackingKey: deterministic sha256 hex, domain-separated (never the bare key hash)', async () => {
  const h = await hashTrackingKey(KEY);
  assert.match(h, TRACKING_KEY_HASH_RE);
  assert.equal(h, await hashTrackingKey(KEY));
  const bare = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(KEY)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.notEqual(h, bare);
  assert.notEqual(h, await hashTrackingKey(KEY.replace(/A$/, 'B')));
});

test('sameHex: equal 64-hex only', async () => {
  const h = await hashTrackingKey(KEY);
  assert.equal(sameHex(h, h), true);
  assert.equal(sameHex(h, h.replace(/.$/, h.endsWith('0') ? '1' : '0')), false);
  assert.equal(sameHex('', ''), false);
  assert.equal(sameHex('ab', 'ab'), false);
});

test('projectSummary: ONLY the allow-listed fields — no name, phone, address, e-mail, note, CliQ reference, uid', () => {
  const order = {
    id: 'ORD-AAAA1111-BBBB', userId: 'aliceUid000000000000000000A1', claimedUserId: 'x', userIdVerified: true, status: 'shipped',
    date: '2026-11-04', createdAt: new Date('2026-11-04T10:00:00Z'), createdAtMs: 1,
    items: [
      { productId: 'p-simple', name: 'دفتر', price: 2.5, quantity: 2, image: 'https://example.invalid/a.jpg', selectedVariant: null },
      { productId: 'p-var', name: 'قلم - أحمر', price: 3, quantity: 1, image: 'javascript:alert(1)', selectedVariant: { id: 'var_red', label: 'أحمر', stock: 5, price: 3 } },
    ],
    subtotal: 8, discountAmount: 0, shippingCost: 3, total: 11, shippingMethodId: 'standard', shippingMethod: 'توصيل عادي',
    paymentMethod: 'cliq', paymentDetails: { cliqReference: 'CLIQ-SECRET-REF-1234', isPaid: true },
    customerEmail: 'alice.secret@example.com', note: 'call my sister 0799999999',
    address: { fullName: 'Alice Secretname', phone: '+962791112233', city: 'Amman', street: 'Hidden Street 5' },
    addressMeta: { citySlug: 'amman', ammanAreaId: 'a1', phoneLocal: '0791112233' },
    consents: { acceptedStorePolicies: true }, workerCheck: { warnings: [] }, source: 'worker-v2', seenByAdmin: true,
  };
  const s = projectSummary(order.id, order);
  assert.deepEqual(Object.keys(s).sort(), ['date', 'discountAmount', 'id', 'items', 'paid', 'paymentMethod', 'shippingCost', 'shippingMethod', 'status', 'subtotal', 'total'].sort());
  for (const it of s.items) assert.deepEqual(Object.keys(it).sort(), ['image', 'name', 'price', 'quantity', 'variant']);
  const json = JSON.stringify(s);
  for (const secret of ['Alice Secretname', '791112233', 'Hidden Street', 'alice.secret', 'CLIQ-SECRET', '0799999999', 'aliceUid', 'Amman', 'amman', 'a1"', 'var_red', 'p-simple', 'workerCheck', 'seenByAdmin']) {
    assert.equal(json.includes(secret), false, `summary leaks ${secret}`);
  }
  assert.equal(s.status, 'shipped');
  assert.equal(s.paid, true);
  assert.equal(s.items[1].image, '', 'non-http image dropped');
  assert.equal(s.items[1].variant, 'أحمر');
  assert.equal(s.total, 11);
});

test('projectSummary: unknown/odd statuses (e.g. fraud) are reported as "unknown"; garbage is neutralised', () => {
  assert.equal(projectSummary('ORD-AAAA1111-BBBB', { status: 'fraud' }).status, 'unknown');
  const s = projectSummary('ORD-AAAA1111-BBBB', { status: 'new', items: 'x', total: '5', paymentMethod: 'card', createdAt: new Date('2026-01-02T00:00:00Z') });
  assert.deepEqual([s.items, s.total, s.paymentMethod, s.date], [[], 0, '', '2026-01-02']);
});
