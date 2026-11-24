// The plain-JS SHA-256 used when a browser (some iPhone in-app WebViews) has no crypto.subtle must be bit-identical
// to crypto.subtle and to the Worker's hashing — otherwise tracking keys / attempt keys would not match.
//   node --test tests/unit/sha256Fallback.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sha256HexJs, utf8 } from '../../src/services/sha256.ts';
import { trackingKeyHash, attemptKey, newTrackingKey, newOrderId, ORDER_ID_RE } from '../../src/services/orderSubmit.ts';
import { hashTrackingKey } from '../../workers/order-worker/src/tracking.js';

const node = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

test('sha256HexJs = node/crypto.subtle on edge lengths, Arabic, emoji and random strings', () => {
  const cases = ['', 'a', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'x'.repeat(1000),
    'مكتبة دير شرف العلمية', 'trk1:ABCDEFGHJKMNPQRSTVWXYZ0', '🎡💸 حظ أوفر', 'content-v1|{"a":[1,2,3]}'];
  for (let i = 0; i < 200; i++) cases.push(randomBytes(1 + (i % 150)).toString('base64') + 'ع'.repeat(i % 7));
  for (const s of cases) assert.equal(sha256HexJs(s), node(s), JSON.stringify(s.slice(0, 30)));
});

test('utf8 fallback (no TextEncoder) = TextEncoder, including surrogate pairs', () => {
  const real = globalThis.TextEncoder;
  const samples = ['abc', 'دير شرف', '🎡x😀', 'éࠀ￿'];
  const want = samples.map((s) => [...new TextEncoder().encode(s)]);
  try {
    globalThis.TextEncoder = undefined;
    assert.deepEqual(samples.map((s) => [...utf8(s)]), want);
  } finally {
    globalThis.TextEncoder = real;
  }
});

test('a browser WITHOUT crypto.subtle: tracking-key hash still equals the Worker\'s, attempt keys unchanged, ids still valid', async () => {
  const key = newTrackingKey();
  const order = { id: 'x', items: [{ productId: 'p1', quantity: 2, price: 3 }], total: 9, address: { phone: '+962791234567' } };
  const withSubtle = [await trackingKeyHash(key), await attemptKey(order)];
  const workerHash = await hashTrackingKey(key); // the Worker runs with crypto.subtle
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const { getRandomValues } = globalThis.crypto;
  try {
    // keep only getRandomValues (what every iPhone browser has), drop subtle + randomUUID
    Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: (a) => getRandomValues.call(desc.get ? desc.get.call(globalThis) : desc.value, a) }, configurable: true });
    assert.equal(globalThis.crypto.subtle, undefined);
    const without = [await trackingKeyHash(key), await attemptKey(order)];
    assert.deepEqual(without, withSubtle);
    assert.equal(without[0], workerHash, 'the Worker recognises the key');
    assert.match(newOrderId(), ORDER_ID_RE);
    assert.match(newTrackingKey(), /^[0-9A-HJKMNP-TV-Z]{24}$/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', desc);
  }
});
