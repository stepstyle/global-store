// Prize wheel — loyalty tiers, dashboard side (pure parts): shares per tier like the Worker, the SUGGESTED weights.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotShares, suggestedWeights, tierW, TIERS } from '../../src/services/wheelAdmin.ts';
import { checkCampaign, drawPrize, tierWeight } from '../../workers/order-worker/src/wheel.js';

const slot = (o) => ({ type: 'discount', label: 'x', valueJod: 1, minOrderJod: 5, quantity: 10, unitCostJod: 1, weight: 0, ...o });
const base = { active: true, minOrderJod: 5, budgetJod: 1000, giftOnCancel: 'return', startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', terms: '' };

test('a missing tier weight falls back to "weight" — the same rule in the dashboard and in the Worker', () => {
  const p = { weight: 7, weights: { loyal: 3 } };
  for (const t of TIERS) assert.equal(tierW(p, t), tierWeight(p, t), t);
  assert.deepEqual(TIERS.map((t) => tierW(p, t)), [7, 7, 3]);
});

test('shares per tier = what the Worker would draw with those weights (counted over the whole weight space)', () => {
  const prizes = [
    slot({ id: 'small', weights: { new: 60, returning: 65, loyal: 70 } }),
    slot({ id: 'big', type: 'gift', unitCostJod: 9, valueJod: 9, minOrderJod: 15, weights: { new: 1, returning: 2, loyal: 4 } }),
    ...[1, 2, 3].map((i) => ({ id: `none-${i}`, type: 'none', label: 'حظ أوفر', weight: 0, weights: { new: 100, returning: 95, loyal: 90 } })),
  ];
  const c = checkCampaign({ ...base, prizes }).campaign;
  const rem = new Map([['small', 10], ['big', 10]]);
  for (const t of TIERS) {
    const shares = slotShares({ prizes }, t);
    const total = prizes.reduce((s, p) => s + tierW(p, t), 0);
    const counts = {};
    for (let r = 0; r < total; r++) { const id = drawPrize(c, rem, () => r, Date.now(), t); counts[id] = (counts[id] || 0) + 1; }
    for (const p of prizes) assert.ok(Math.abs((counts[p.id] || 0) / total - shares[p.id]) < 1e-9, `${t} ${p.id}`);
  }
  assert.ok(slotShares({ prizes }, 'loyal').big > slotShares({ prizes }, 'new').big, 'measured edge for loyal customers');
});

test('the SUGGESTED weights (a starting point, never applied by itself): cheap common, costly rare, loyal slightly better, three "حظ أوفر" dominant', () => {
  const s = (cost, type = 'gift') => suggestedWeights(slot({ type, unitCostJod: cost }));
  for (const t of TIERS) {
    assert.ok(s(1)[t] > s(2)[t] && s(2)[t] > s(3)[t] && s(3)[t] > s(5)[t] && s(5)[t] >= s(9)[t], `${t}: cheaper = more common`);
    assert.ok(s(9)[t] <= 2, `${t}: costly prizes rare`);
  }
  for (const cost of [1, 2, 3, 5, 9]) assert.ok(s(cost).loyal >= s(cost).new, `loyal edge for cost ${cost}`);
  const none = suggestedWeights({ id: 'none-1', type: 'none', label: 'حظ أوفر', weight: 0 });
  assert.ok(none.new >= none.loyal, 'loyal customers get "حظ أوفر" a little less often');
});
