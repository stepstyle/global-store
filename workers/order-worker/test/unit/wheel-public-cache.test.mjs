// GET /wheel/public kept briefly in the Worker's memory (what every new visitor asks first: 3 Firestore reads, 1-3 s
// measured live) + the campaign id / start sent to the browser (once-per-campaign popup).
//   node --test test/unit/wheel-public-cache.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wheelPublicCached, forgetWheelPublic } from '../../src/wheel.js';
import { loadConfig } from '../../src/config.js';

const fakeFs = () => {
  const f = { reads: 0, async get() { f.reads++; return { exists: false }; }, async batchGet(paths) { f.reads++; return paths.map(() => ({ exists: false })); } };
  return f;
};
const cfg = (o = {}) => ({ wheelMode: 'live', wheelCampaignId: 'launch-1', wheelPrizeHoldMinutes: 60, wheelPublicCacheMs: 15_000, ...o });

test('the same Worker isolate answers from memory within the time limit, then reads again', async () => {
  const env = {};
  const fs = fakeFs();
  const a = await wheelPublicCached(env, fs, cfg(), { now: 1_000 });
  const b = await wheelPublicCached(env, fs, cfg(), { now: 15_999 });
  assert.equal(fs.reads, 1, 'one read for both visitors');
  assert.deepEqual(b.body, a.body);
  assert.equal(b.cached, true);
  await wheelPublicCached(env, fs, cfg(), { now: 16_000 });
  assert.equal(fs.reads, 2, 'read again after 15 s');
});

test('never shared: another env object (each test call / another Worker), another campaign id, or a cache of 0 s', async () => {
  const fs = fakeFs();
  const env = {};
  await wheelPublicCached(env, fs, cfg(), { now: 0 });
  await wheelPublicCached({}, fs, cfg(), { now: 1 });
  await wheelPublicCached(env, fs, cfg({ wheelCampaignId: 'launch-2' }), { now: 2 });
  const off = {};
  await wheelPublicCached(off, fs, cfg({ wheelPublicCacheMs: 0 }), { now: 3 });
  await wheelPublicCached(off, fs, cfg({ wheelPublicCacheMs: 0 }), { now: 4 });
  assert.equal(fs.reads, 5);
});

test('an admin save clears it at once; an error / wheel-off answer is never kept', async () => {
  const fs = fakeFs();
  const env = {};
  await wheelPublicCached(env, fs, cfg(), { now: 0 });
  forgetWheelPublic(env);
  await wheelPublicCached(env, fs, cfg(), { now: 1 });
  assert.equal(fs.reads, 2);
  const offEnv = {};
  const r = await wheelPublicCached(offEnv, fs, cfg({ wheelMode: 'off' }), { now: 0 });
  assert.equal(r.status, 404);
  const r2 = await wheelPublicCached(offEnv, fs, cfg(), { now: 1 });
  assert.equal(r2.status, 200, 'the 404 was not served from memory');
});

test('the answer names the campaign (id; start date when the campaign is valid) — no weight, quantity or cost', async () => {
  const r = await wheelPublicCached({}, fakeFs(), cfg(), { now: 0 });
  assert.equal(r.body.campaignId, 'launch-1');
  assert.equal(r.body.startsAt, null, 'no valid campaign document = no start date');
  assert.ok(!/weight|quantity|cost|budget/i.test(JSON.stringify(r.body)));
});

test('config: WHEEL_PUBLIC_CACHE_SECONDS defaults to 15, limited to 0..60', () => {
  const L = 'http://127.0.0.1:1';
  const base = { ENVIRONMENT: 'local', FIREBASE_PROJECT_ID: 'demo-x', FIRESTORE_AUTH: 'emulator', FIRESTORE_BASE_URL: `${L}/v1`, OAUTH_TOKEN_URL: `${L}/t`, TELEGRAM_API_BASE: `${L}/tg`, SENDGRID_API_BASE: `${L}/sg`, TURNSTILE_VERIFY_URL: `${L}/ts`, AUTH_JWKS_URL: `${L}/j` };
  const c = (v) => loadConfig(v === undefined ? base : { ...base, WHEEL_PUBLIC_CACHE_SECONDS: v });
  assert.equal(c().ok, true, c().errors?.join('; '));
  assert.equal(c().wheelPublicCacheMs, 15_000);
  assert.equal(c('0').wheelPublicCacheMs, 0);
  assert.equal(c('999').wheelPublicCacheMs, 60_000);
  assert.equal(c('-5').wheelPublicCacheMs, 15_000, 'an invalid value = the default (like every number setting)');
});
