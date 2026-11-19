// Prize wheel (WHEEL_MODE=test) — pure parts: campaign validation, draw, production guard. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validCampaign, campaignOpen, drawPrize, secureRand, entitlement, phoneKey, NO_PRIZE } from '../../src/wheel.js';
import { loadConfig } from '../../src/config.js';

// TEST settings only — not real prizes, prices or probabilities
export const CAMPAIGN = {
  active: true, minOrderJod: 5, budgetJod: 10, noPrizeWeight: 60, giftOnCancel: 'return',
  startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z', terms: 'شروط تجريبية',
  prizes: [
    { id: 'test-a', label: 'جائزة تجريبية أ', productId: 'p-hundred', weight: 30, quantity: 3, unitCostJod: 1 },
    { id: 'test-b', label: 'جائزة تجريبية ب', productId: 'p-variants', variantId: 'var_blue', weight: 10, quantity: 1, unitCostJod: 2 },
  ],
};

test('valid test campaign is accepted', () => {
  const c = validCampaign(CAMPAIGN);
  assert.ok(c);
  assert.equal(c.prizes.length, 2);
  assert.equal(campaignOpen(c, Date.parse('2026-11-19')).ok, true);
});

test('campaign over budget / bad weights / duplicate ids / reserved id / bad dates are refused as a whole', () => {
  assert.equal(validCampaign({ ...CAMPAIGN, budgetJod: 4 }), null, '3*1 + 1*2 = 5 > 4');
  assert.equal(validCampaign({ ...CAMPAIGN, prizes: [{ ...CAMPAIGN.prizes[0], weight: -1 }] }), null);
  assert.equal(validCampaign({ ...CAMPAIGN, prizes: [{ ...CAMPAIGN.prizes[0], weight: 1.5 }] }), null);
  assert.equal(validCampaign({ ...CAMPAIGN, prizes: [CAMPAIGN.prizes[0], CAMPAIGN.prizes[0]] }), null);
  assert.equal(validCampaign({ ...CAMPAIGN, prizes: [{ ...CAMPAIGN.prizes[0], id: NO_PRIZE }] }), null);
  assert.equal(validCampaign({ ...CAMPAIGN, prizes: [{ ...CAMPAIGN.prizes[0], productId: 'a/b' }] }), null);
  assert.equal(validCampaign({ ...CAMPAIGN, endsAt: CAMPAIGN.startsAt }), null);
  assert.equal(validCampaign({ ...CAMPAIGN, giftOnCancel: 'keep' }), null);
  assert.equal(validCampaign({ ...CAMPAIGN, minOrderJod: '5' }), null);
  assert.equal(validCampaign(null), null);
});

test('timestamps stored as Firestore dates are accepted', () => {
  assert.ok(validCampaign({ ...CAMPAIGN, startsAt: new Date('2026-01-01'), endsAt: new Date('2027-01-01') }));
});

test('closed / not started / ended', () => {
  const c = validCampaign(CAMPAIGN);
  assert.equal(campaignOpen({ ...c, active: false }, Date.now()).code, 'CAMPAIGN_CLOSED');
  assert.equal(campaignOpen(c, Date.parse('2025-12-31')).code, 'CAMPAIGN_NOT_STARTED');
  assert.equal(campaignOpen(c, Date.parse('2027-01-01')).code, 'CAMPAIGN_ENDED');
  assert.equal(campaignOpen(null, Date.now()).code, 'CAMPAIGN_INVALID');
});

test('draw follows the weights exactly over the whole range, and never picks an exhausted prize', () => {
  const c = validCampaign(CAMPAIGN);
  const full = new Map([['test-a', 3], ['test-b', 1]]);
  const counts = {};
  for (let r = 0; r < 100; r++) { const id = drawPrize(c, full, () => r); counts[id] = (counts[id] || 0) + 1; }
  assert.deepEqual(counts, { 'test-a': 30, 'test-b': 10, [NO_PRIZE]: 60 });
  const noB = new Map([['test-a', 3], ['test-b', 0]]);
  for (let r = 0; r < 90; r++) assert.notEqual(drawPrize(c, noB, () => r), 'test-b');
  assert.equal(drawPrize(c, new Map(), () => 0), NO_PRIZE, 'pool empty -> no prize');
  assert.equal(drawPrize({ ...c, noPrizeWeight: 0 }, new Map(), () => 0), NO_PRIZE, 'nothing at all -> no prize');
});

test('secureRand stays in range', () => {
  for (const n of [1, 2, 7, 100, 1000]) for (let i = 0; i < 200; i++) { const x = secureRand(n); assert.ok(Number.isInteger(x) && x >= 0 && x < n); }
});

test('entitlement: one free chance by default', () => {
  assert.deepEqual(entitlement({ exists: false }), { granted: 1, used: 0 });
});

test('config: wheel off by default; test needs a campaign id and on_delivery; production refuses it', () => {
  const L = 'http://127.0.0.1:9';
  const base = { ENVIRONMENT: 'local', FIREBASE_PROJECT_ID: 'demo-x', FIRESTORE_AUTH: 'emulator', FIRESTORE_BASE_URL: `${L}/v1`, OAUTH_TOKEN_URL: `${L}/t`, TELEGRAM_API_BASE: `${L}/tg`, SENDGRID_API_BASE: `${L}/sg`, TURNSTILE_VERIFY_URL: `${L}/ts`, AUTH_JWKS_URL: `${L}/j` };
  assert.equal(loadConfig(base).ok, true, loadConfig(base).errors?.join('; '));
  assert.equal(loadConfig(base).wheelMode, 'off');
  assert.equal(loadConfig({ ...base, WHEEL_MODE: 'test' }).ok, false, 'no campaign');
  assert.equal(loadConfig({ ...base, WHEEL_MODE: 'test', WHEEL_CAMPAIGN: 'test-1' }).ok, false, 'not on_delivery');
  assert.equal(loadConfig({ ...base, WHEEL_MODE: 'test', WHEEL_CAMPAIGN: 'test-1', STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', WHEEL_PHONE_SECRET: 'short' }).ok, false, 'HMAC secret too short');
  const weak = loadConfig({ ...base, WHEEL_MODE: 'test', WHEEL_CAMPAIGN: 'test-1', STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', WHEEL_PHONE_SECRET: 'x'.repeat(40) });
  assert.equal(weak.ok, false, 'placeholder secret refused');
  assert.ok(!weak.errors.join(' ').includes('xxxx'), 'the secret value is never echoed in errors');
  const ok = loadConfig({ ...base, WHEEL_MODE: 'test', WHEEL_CAMPAIGN: 'test-1', STOCK_POLICY: 'on_delivery', STOCK_MODE: 'apply', WHEEL_PHONE_SECRET: 'Zq8Lr2Vt6Wn0Pb4Hc9Kd1Mf5Jg3Xs7Ye-unit' });
  assert.equal(ok.ok, true, ok.errors?.join('; '));
  assert.equal(ok.wheelMode, 'test');
  assert.equal(loadConfig({ ...base, WHEEL_MODE: 'on' }).ok, false);
});

test('defaults keep the welcome chance; anti-abuse knobs validated', () => {
  const c = validCampaign(CAMPAIGN);
  assert.equal(c.freeFirstChance, true);
  assert.equal(c.openGiftsPerPhone, 1);
  assert.equal(c.prizeValidDays, 30);
  assert.equal(validCampaign({ ...CAMPAIGN, openGiftsPerPhone: 0 }), null);
  assert.equal(validCampaign({ ...CAMPAIGN, prizeValidDays: 0 }), null);
  assert.equal(validCampaign({ ...CAMPAIGN, prizeValidDays: 400 }), null);
  assert.deepEqual(entitlement({ exists: false }, 0), { granted: 0, used: 0 });
});

test('phone key: HMAC with the server secret (not a guessable plain hash), same number in any format, no digits inside', async () => {
  const S1 = 'a'.repeat(32);
  const k1 = await phoneKey(S1, 'c1', '+962 79 123 4567');
  assert.equal(k1, await phoneKey(S1, 'c1', '0791234567'), 'same number, other format');
  assert.notEqual(k1, await phoneKey('b'.repeat(32), 'c1', '0791234567'), 'other secret -> other key');
  assert.notEqual(k1, await phoneKey(S1, 'c2', '0791234567'), 'other campaign -> other key');
  const plain = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('wph1:c1:791234567')))].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.ok(!k1.endsWith(plain), 'not the plain sha-256 an attacker could compute');
  assert.ok(!k1.includes('791234567'));
  assert.equal(await phoneKey('', 'c1', '0791234567'), null, 'no secret -> no key (refused)');
  assert.equal(await phoneKey(S1, 'c1', '12'), null);
});
