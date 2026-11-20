// Prize wheel v2 — campaign check and server-side draw (pure, no emulator).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCampaign, drawPrize, displaySlots, slotDrawable, secureRand, NO_PRIZE } from '../../src/wheel.js';

const base = (prizes, extra = {}) => ({ active: true, minOrderJod: 5, budgetJod: 1000, giftOnCancel: 'return', startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', prizes, ...extra });
const none = (i, w) => ({ id: `none-${i}`, type: 'none', label: 'حظ أوفر', weight: w });

test('the agreed prize types are accepted; legacy campaigns (product gifts, noPrizeWeight) still valid', () => {
  const c = checkCampaign(base([
    { id: 'ship', type: 'free_delivery', label: 'توصيل مجاني', valueJod: 3, weight: 10, quantity: 5 },
    { id: 'd1', type: 'discount', label: 'خصم دينار', valueJod: 1, weight: 10, quantity: 5 },
    { id: 'g2', type: 'gift', label: 'هدية بقيمة 2', valueJod: 2, weight: 5, quantity: 5 },
    { id: 'watch', type: 'gift', label: 'ساعة', productId: 'p-watch', unitCostJod: 8, minOrderJod: 15, weight: 1, quantity: 2 },
    { id: 'second', type: 'discount', label: 'خصم 4 على الثاني', valueJod: 4, minOrderJod: 15, appliesTo: 'next_order', weight: 1, quantity: 5 },
    none(1, 20), none(2, 20), none(3, 20),
  ]));
  assert.deepEqual(c.errors, []);
  assert.equal(c.campaign.prizes.length, 8);
  assert.equal(c.campaign.prizes.find((p) => p.id === 'watch').minOrderJod, 15);
  assert.equal(c.campaign.prizes.find((p) => p.id === 'd1').minOrderJod, 5, 'defaults to the campaign minimum');
  const legacy = checkCampaign({ active: true, minOrderJod: 5, budgetJod: 10, noPrizeWeight: 2, giftOnCancel: 'return', startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', prizes: [{ id: 'test-a', label: 'x', productId: 'p-hundred', weight: 1, quantity: 3, unitCostJod: 1 }] });
  assert.deepEqual(legacy.errors, []);
  assert.equal(legacy.campaign.prizes[0].type, 'gift');
});

test('refused with reasons: discount >= its minimum, next-order on a gift, unknown type, duplicate ids, budget exceeded, nothing drawable', () => {
  const bad = checkCampaign(base([
    { id: 'd5', type: 'discount', label: 'خصم 5', valueJod: 5, minOrderJod: 5, weight: 1, quantity: 1 },
    { id: 'g', type: 'gift', label: 'هدية', valueJod: 2, appliesTo: 'next_order', weight: 1, quantity: 1 },
    { id: 'x', type: 'cash', label: '?', weight: 1, quantity: 1 },
    { id: 'n', type: 'none', label: 'حظ أوفر', weight: 1 }, { id: 'n', type: 'none', label: 'حظ أوفر', weight: 1 },
  ]));
  assert.equal(bad.campaign, null);
  assert.ok(bad.errors.length >= 4, JSON.stringify(bad.errors));
  assert.equal(checkCampaign(base([{ id: 'g', type: 'gift', label: 'هدية', valueJod: 5, weight: 1, quantity: 10 }], { budgetJod: 49 })).campaign, null);
  assert.equal(checkCampaign(base([none(1, 0)])).campaign, null);
});

test('warnings (never block): 4-5 JOD prize under 15, fewer than 3 "حظ أوفر", high chance of an expensive prize, expected cost per spin', () => {
  const c = checkCampaign(base([
    { id: 'g5', type: 'gift', label: 'هدية 5', valueJod: 5, minOrderJod: 5, weight: 50, quantity: 5 },
    none(1, 50),
  ]));
  assert.ok(c.campaign);
  const w = c.warnings.join('\n');
  assert.ok(w.includes('هدية 5') && w.includes('15'), w);
  assert.ok(w.includes('حظ أوفر'), w);
  assert.ok(w.includes('50%'), w);
  assert.ok(w.includes('متوسط التكلفة'), w);
});

test('draw: weights respected (big sample), "حظ أوفر" returns ITS segment id, sold-out / inactive / out-of-date never drawn', () => {
  const c = checkCampaign(base([
    { id: 'a', type: 'discount', label: 'a', valueJod: 1, weight: 1, quantity: 9 },
    none(1, 2), none(2, 1),
    { id: 'gone', type: 'discount', label: 'gone', valueJod: 1, weight: 100, quantity: 9 },
    { id: 'off', type: 'discount', label: 'off', valueJod: 1, weight: 100, quantity: 9, active: false },
    { id: 'later', type: 'discount', label: 'later', valueJod: 1, weight: 100, quantity: 9, startsAt: '2098-01-01T00:00:00Z' },
  ])).campaign;
  const rem = new Map([['a', 5], ['gone', 0], ['off', 5], ['later', 5]]);
  const n = 40_000;
  const seen = {};
  for (let i = 0; i < n; i++) { const id = drawPrize(c, rem, secureRand); seen[id] = (seen[id] || 0) + 1; }
  assert.deepEqual(Object.keys(seen).sort(), ['a', 'none-1', 'none-2']);
  assert.ok(Math.abs(seen.a / n - 0.25) < 0.02, JSON.stringify(seen));
  assert.ok(Math.abs(seen['none-1'] / n - 0.5) < 0.02, JSON.stringify(seen));
  assert.deepEqual(displaySlots(c, rem).map((s) => s.id), ['a', 'none-1', 'none-2']);
  assert.equal(slotDrawable(c.prizes[0], new Map([['a', 0]]), Date.now()), false);
  // exact mapping of the random number to the slots (deterministic rand)
  assert.equal(drawPrize(c, rem, () => 0), 'a');
  assert.equal(drawPrize(c, rem, () => 1), 'none-1');
  assert.equal(drawPrize(c, rem, () => 3), 'none-2');
  assert.equal(drawPrize(checkCampaign(base([none(1, 0), { id: 'a', type: 'discount', label: 'a', valueJod: 1, weight: 1, quantity: 1 }])).campaign, new Map([['a', 0]]), () => 0), NO_PRIZE);
});

test('public segments never carry weights, quantities or costs', () => {
  const c = checkCampaign(base([{ id: 'a', type: 'discount', label: 'a', valueJod: 1, weight: 7, quantity: 9, unitCostJod: 1 }, none(1, 3)])).campaign;
  const raw = JSON.stringify(displaySlots(c, new Map([['a', 9]])));
  for (const k of ['weight', 'quantity', 'unitCostJod']) assert.ok(!raw.includes(k), k);
});
