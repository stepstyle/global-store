// «طلباتي» for guests + linking: device list per identity, Worker-checked summaries, claim results.
//   node --test tests/unit/myOrders.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackingKeys } from '../../src/services/checkoutFlow.ts';
import { deviceOrderIds, loadDeviceOrders, claimOrder, DEVICE_ORDERS_MAX } from '../../src/services/myOrders.ts';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const KEY = (c) => c.repeat(24);
const opts = { workerUrl: 'https://worker.test', timeoutMs: 2000 };
const resp = (status, body) => ({ status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) });

test('the device list is per identity: a guest never sees an account\'s orders and vice versa; reassign moves one entry', () => {
  const s = trackingKeys(mem());
  s.add('ORD-AAAA1111-0001', KEY('A'), 'guest');
  s.add('ORD-BBBB2222-0002', KEY('B'), 'uid-alice');
  s.add('ORD-CCCC3333-0003', KEY('C'), 'guest');
  assert.deepEqual(deviceOrderIds(s, 'guest').map((x) => x.orderId), ['ORD-CCCC3333-0003', 'ORD-AAAA1111-0001']);
  assert.deepEqual(deviceOrderIds(s, 'uid-alice').map((x) => x.orderId), ['ORD-BBBB2222-0002']);
  assert.deepEqual(deviceOrderIds(s, 'uid-mallory'), []);
  s.reassign('ORD-AAAA1111-0001', 'guest', 'uid-alice');
  assert.deepEqual(deviceOrderIds(s, 'guest').map((x) => x.orderId), ['ORD-CCCC3333-0003']);
  assert.equal(s.get('ORD-AAAA1111-0001', 'uid-alice'), KEY('A'));
  assert.equal(s.get('ORD-AAAA1111-0001', 'guest'), null, 'no longer readable as a guest on this device');
  s.reassign('ORD-CCCC3333-0003', 'uid-mallory', 'uid-alice'); // wrong "from": nothing moves
  assert.equal(s.get('ORD-CCCC3333-0003', 'guest'), KEY('C'));
});

test('summaries come from the Worker; the key goes in a header, never in the URL; offline / refused are reported, not guessed', async () => {
  const calls = [];
  const deps = {
    fetch: async (url, init) => {
      calls.push({ url, headers: init.headers });
      if (url.includes('ORD-AAAA1111-0001')) return resp(200, { ok: true, order: { id: 'ORD-AAAA1111-0001', status: 'shipped', date: '2026-11-19', items: [{ name: 'دفتر', quantity: 2, price: 1, variant: '', image: '' }], subtotal: 2, discountAmount: 0, shippingCost: 1, total: 3, paymentMethod: 'cod', shippingMethod: '', paid: false } });
      if (url.includes('ORD-BBBB2222-0002')) return resp(404, { ok: false, code: 'NOT_FOUND' });
      throw new TypeError('Failed to fetch');
    },
  };
  const rows = await loadDeviceOrders([
    { orderId: 'ORD-AAAA1111-0001', key: KEY('A') }, { orderId: 'ORD-BBBB2222-0002', key: KEY('B') }, { orderId: 'ORD-CCCC3333-0003', key: KEY('C') },
  ], opts, deps);
  assert.deepEqual(rows.map((r) => [r.orderId, r.state]), [['ORD-AAAA1111-0001', 'ok'], ['ORD-BBBB2222-0002', 'denied'], ['ORD-CCCC3333-0003', 'unavailable']]);
  assert.equal(rows[0].summary.status, 'shipped');
  for (const c of calls) {
    assert.ok(!c.url.includes(KEY('A')) && !c.url.includes(KEY('B')), 'key never in the URL');
    assert.match(c.headers['x-tracking-key'], /^[0-9A-Z]{24}$/);
  }
});

test('at most 30 orders are checked from one device', () => {
  const s = trackingKeys(mem());
  for (let i = 0; i < 40; i++) s.add(`ORD-AAAA${String(1000 + i)}-${String(i).padStart(4, '0')}`, KEY('D'), 'guest');
  assert.ok(deviceOrderIds(s, 'guest').length <= DEVICE_ORDERS_MAX);
});

test('claim: every Worker answer maps to a clear result; nothing is sent without sign-in or 4 digits', async () => {
  const sent = [];
  const deps = (status, body) => ({ fetch: async (url, init) => { sent.push({ url, init }); return resp(status, body); } });
  assert.deepEqual(await claimOrder('ORD-AAAA1111-0001', KEY('A'), '4567', 't', opts, deps(200, { ok: true, linked: true })), { kind: 'linked' });
  assert.deepEqual(await claimOrder('ORD-AAAA1111-0001', KEY('A'), '4567', 't', opts, deps(200, { ok: true, linked: false, alreadyYours: true })), { kind: 'already_yours' });
  assert.deepEqual(await claimOrder('ORD-AAAA1111-0001', KEY('A'), '4567', 't', opts, deps(409, { ok: false, code: 'ALREADY_LINKED' })), { kind: 'already_linked' });
  assert.deepEqual(await claimOrder('ORD-AAAA1111-0001', KEY('A'), '4567', 't', opts, deps(404, { ok: false, code: 'NOT_FOUND' })), { kind: 'not_matching' });
  assert.deepEqual(await claimOrder('ORD-AAAA1111-0001', KEY('A'), '4567', 't', opts, deps(401, { ok: false, code: 'AUTH_INVALID' })), { kind: 'sign_in_required' });
  assert.deepEqual(await claimOrder('ORD-AAAA1111-0001', KEY('A'), '4567', 't', opts, deps(503, {})), { kind: 'unavailable' });
  const last = sent.at(-1);
  assert.equal(last.init.headers['x-tracking-key'], KEY('A'));
  assert.ok(!last.url.includes(KEY('A')), 'key never in the URL');
  assert.deepEqual(JSON.parse(last.init.body), { phoneLast4: '4567' });
  const before = sent.length;
  assert.deepEqual(await claimOrder('ORD-AAAA1111-0001', KEY('A'), '4567', null, opts, deps(200, {})), { kind: 'sign_in_required' });
  assert.deepEqual(await claimOrder('ORD-AAAA1111-0001', KEY('A'), '45', 't', opts, deps(200, {})), { kind: 'not_matching' });
  assert.equal(sent.length, before, 'nothing sent');
});
