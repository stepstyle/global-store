// Prize wheel — the OPENING CAMPAIGN (owner's decision 2026-11-21): 50 JOD available from the start for 30 days, no
// 12-per-100 growth, no renewal; every agreed prize kept (unknown costs inactive), three "حظ أوفر", conservative
// chances with a better chance for loyal customers. Checked with the WORKER's own functions (the ones a save and a spin use).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchCampaign, agreedTemplate, LAUNCH_PLAN, projectBudget, slotShares, TIERS } from '../../src/services/wheelAdmin.ts';
import { checkCampaign, campaignOpen, budgetState, affordable, costMils, drawPrize } from '../../workers/order-worker/src/wheel.js';

const NOW = new Date('2026-12-01T09:00:00Z');
const raw = launchCampaign(NOW);
const checked = checkCampaign(raw);
const c = checked.campaign;

test('the opening campaign passes the Worker check (no errors) and keeps every agreed prize', () => {
  assert.deepEqual(checked.errors, []);
  assert.ok(c);
  assert.deepEqual(raw.prizes.map((p) => p.id), agreedTemplate().prizes.map((p) => p.id), 'same prizes, same order');
  assert.equal(raw.prizes.filter((p) => p.type === 'none' && p.active).length, 3, 'three "حظ أوفر"');
});

test('budget: 50 JOD from the start, hard cap 50, no growth with delivered orders, no renewal', () => {
  assert.equal(c.budgetJod, 50);
  assert.equal(c.budgetStartJod, 50);
  assert.equal(c.budgetPer100Jod, 0);
  assert.equal(budgetState(c, { exists: false }).availableMils, 50_000, 'available on day one');
  const later = { exists: true, fields: { deliveredOrders: { integerValue: '5000' }, heldMils: { integerValue: '0' }, spentMils: { integerValue: '0' } } };
  assert.equal(budgetState(c, later).allowanceMils, 50_000, 'never more than 50, however many orders');
  // every quantity at its cost adds up to EXACTLY the budget: the Worker refuses a save above it
  const worst = c.prizes.reduce((s, p) => s + (p.type === 'none' ? 0 : p.quantity * costMils(p)), 0);
  assert.equal(worst, 50_000);
  const over = structuredClone(raw); over.prizes.find((p) => p.id === 'disc-1').quantity += 1;
  assert.ok(checkCampaign(over).errors.some((e) => /يتجاوز الميزانية/.test(e)), 'one more unit is refused');
});

test('30 days from activation: open now, closed at the 30-day mark', () => {
  assert.equal(c.endsAt - c.startsAt, 30 * 86_400_000);
  assert.equal(campaignOpen(c, NOW.getTime()).ok, true);
  assert.equal(campaignOpen(c, NOW.getTime() + 30 * 86_400_000 - 1).ok, true);
  assert.equal(campaignOpen(c, NOW.getTime() + 30 * 86_400_000).code, 'CAMPAIGN_ENDED');
});

test('unknown-cost prizes (watch, toy, accessories) stay in the dashboard, inactive, weight 0, quantity 0, not confirmed', () => {
  for (const id of ['watch-1', 'toy-1', 'acc-1']) {
    const p = raw.prizes.find((x) => x.id === id);
    assert.ok(p, id);
    assert.equal(p.active, false, id);
    assert.equal(p.quantity, 0, id);
    assert.equal(p.costConfirmed, false, id);
    for (const t of TIERS) assert.equal(p.weights[t], 0, `${id} ${t}`);
  }
  for (const id of Object.keys(LAUNCH_PLAN)) assert.ok(raw.prizes.some((p) => p.id === id), `plan id ${id} exists`);
});

test('chances: conservative, small prizes first, loyal customers better on EVERY prize; never a prize that cannot be won', () => {
  const shares = Object.fromEntries(raw.prizes.map((p) => [p.id, Object.fromEntries(TIERS.map((t) => [t, slotShares(raw, t)[p.id]]))]));
  for (const t of TIERS) {
    const win = raw.prizes.filter((p) => p.type !== 'none' && p.active).reduce((s, p) => s + (shares[p.id]?.[t] ?? 0), 0);
    assert.ok(win > 0.15 && win < 0.4, `${t}: win chance ${win}`);
    const small = raw.prizes.filter((p) => p.type !== 'none' && p.active && p.unitCostJod <= 1).reduce((s, p) => s + shares[p.id][t], 0);
    assert.ok(small / win >= 0.39, `${t}: the 1 JOD discount is the most common prize`);
    for (const p of raw.prizes.filter((x) => x.type !== 'none' && x.active && x.unitCostJod >= 4)) assert.ok(shares[p.id][t] <= 0.025, `${p.id} ${t} rare`);
  }
  for (const p of raw.prizes.filter((x) => x.type !== 'none' && x.active)) {
    assert.ok(p.weights.loyal > p.weights.returning && p.weights.returning >= p.weights.new, p.id);
    assert.ok(shares[p.id].loyal > shares[p.id].new, `${p.id} share`);
  }
  const proj = projectBudget(raw);
  assert.ok(proj.perSpin.new < proj.perSpin.returning && proj.perSpin.returning < proj.perSpin.loyal);
  assert.ok(proj.perSpin.loyal < 1, 'below 1 JOD per spin even for loyal customers');
});

test('simulation: 20000 spins, every prize taken until stock / budget runs out — never more than 50 JOD, never negative', () => {
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const left = new Map(c.prizes.filter((p) => p.type !== 'none').map((p) => [p.id, p.quantity]));
  let spent = 0;
  const won = {};
  for (let i = 0; i < 20_000; i++) {
    const tier = TIERS[i % 3];
    const b = { availableMils: 50_000 - spent };
    const id = drawPrize(c, affordable(c, left, b), rand, NOW.getTime(), tier);
    const p = c.prizes.find((x) => x.id === id);
    if (!p || p.type === 'none') continue;
    left.set(id, left.get(id) - 1);
    spent += costMils(p);
    won[id] = (won[id] || 0) + 1;
    assert.ok(left.get(id) >= 0 && spent <= 50_000, `spin ${i}`);
  }
  assert.equal(spent, 50_000, 'the whole budget is reachable (every planned prize can really be won)');
  for (const id of ['watch-1', 'toy-1', 'acc-1']) assert.equal(won[id], undefined, `${id} never drawn`);
});
