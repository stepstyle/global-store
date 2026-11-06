// Build target + staging/production configuration guards (pure, no network).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, buildTarget } from '../../src/config.js';
import worker from '../../src/index.js';

const FAKE_KEY = '-----BEGIN PRIVATE KEY-----\nFAKEFAKEFAKE\n-----END PRIVATE KEY-----\n';
const SINK = 'https://anta-notify-sink-staging.acme.workers.dev';

const STAGING = {
  ENVIRONMENT: 'staging',
  FIREBASE_PROJECT_ID: 'dairsharaf-staging',
  FIRESTORE_AUTH: 'service-account',
  FIREBASE_CLIENT_EMAIL: 'order-worker-staging@dairsharaf-staging.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: FAKE_KEY,
  TELEGRAM_API_BASE: `${SINK}/telegram`,
  SENDGRID_API_BASE: `${SINK}/sendgrid`,
  TURNSTILE_MODE: 'enforce',
  TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
  ALLOWED_ORIGINS: 'http://localhost:3000',
};

const PRODUCTION = {
  ENVIRONMENT: 'production',
  FIREBASE_PROJECT_ID: 'antastore1-82b50',
  FIRESTORE_AUTH: 'service-account',
  FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk-abcde@antastore1-82b50.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: FAKE_KEY,
  TURNSTILE_SECRET: '0x4AAAAAAAREALLOOKINGSECRET',
  PRICE_CHECK_MODE: 'enforce', // production launch requirement (config.js)
  TURNSTILE_MODE: 'enforce',
};

const withTarget = (t) => {
  if (t === undefined) delete globalThis.__DEPLOY_TARGET__;
  else globalThis.__DEPLOY_TARGET__ = t;
};
afterEach(() => withTarget(undefined));

test('default (unbundled) build target is local', () => {
  assert.equal(buildTarget(), 'local');
});

test('staging build + staging env -> ok', () => {
  withTarget('staging');
  const c = loadConfig(STAGING);
  assert.equal(c.ok, true, c.errors.join('; '));
  assert.equal(c.urls.firestore, 'https://firestore.googleapis.com/v1');
});

test('production build + production env -> ok (only reachable with a production build)', () => {
  withTarget('production');
  const c = loadConfig(PRODUCTION);
  assert.equal(c.ok, true, c.errors.join('; '));
});

test('flipping ENVIRONMENT alone never switches target', () => {
  withTarget('staging');
  assert.equal(loadConfig(PRODUCTION).ok, false, 'staging build cannot run as production');
  assert.equal(loadConfig({ ...STAGING, ENVIRONMENT: 'production' }).ok, false);
  withTarget('local');
  assert.equal(loadConfig(PRODUCTION).ok, false, 'local build cannot run as production');
  assert.equal(loadConfig(STAGING).ok, false, 'local build cannot run as staging');
  withTarget('production');
  assert.equal(loadConfig(STAGING).ok, false, 'production build cannot run as staging');
  withTarget('prod');
  assert.equal(loadConfig(PRODUCTION).ok, false, 'unknown build target');
});

const stagingMisdirections = {
  'production project id': { FIREBASE_PROJECT_ID: 'antastore1-82b50' },
  'demo- project': { FIREBASE_PROJECT_ID: 'demo-x-staging' },
  'project without -staging suffix': { FIREBASE_PROJECT_ID: 'dairsharaf-test' },
  'service account of production': { FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk-abcde@antastore1-82b50.iam.gserviceaccount.com' },
  'service account of another staging project': { FIREBASE_CLIENT_EMAIL: 'x@other-staging.iam.gserviceaccount.com' },
  'service account lookalike domain': { FIREBASE_CLIENT_EMAIL: 'x@dairsharaf-staging.iam.gserviceaccount.com.evil.com' },
  'missing private key': { FIREBASE_PRIVATE_KEY: '' },
  'emulator auth': { FIRESTORE_AUTH: 'emulator' },
  'real Telegram': { TELEGRAM_API_BASE: 'https://api.telegram.org' },
  'real SendGrid': { SENDGRID_API_BASE: 'https://api.sendgrid.com' },
  'sink lookalike host': { TELEGRAM_API_BASE: 'https://anta-notify-sink-staging.acme.workers.dev.evil.com/telegram' },
  'sink over http': { SENDGRID_API_BASE: 'http://anta-notify-sink-staging.acme.workers.dev/sendgrid' },
  'Firestore lookalike host': { FIRESTORE_BASE_URL: 'https://firestore.googleapis.com.evil.com/v1' },
  'Firestore with port': { FIRESTORE_BASE_URL: 'https://firestore.googleapis.com:8443/v1' },
  'Firestore with credentials': { FIRESTORE_BASE_URL: 'https://user:pw@firestore.googleapis.com/v1' },
  'OAuth elsewhere': { OAUTH_TOKEN_URL: 'https://evil.example/token' },
  'local emulator URL': { FIRESTORE_BASE_URL: 'http://127.0.0.1:8086/v1' },
  'real Turnstile secret': { TURNSTILE_SECRET: '0x4AAAAAAAREALLOOKINGSECRET' },
  'production site origin': { ALLOWED_ORIGINS: 'http://localhost:3000,https://dairsharaf.com' },
  'production www origin': { ALLOWED_ORIGINS: 'https://www.dairsharaf.com' },
};
for (const [name, o] of Object.entries(stagingMisdirections)) {
  test(`staging guard blocks: ${name}`, () => {
    withTarget('staging');
    assert.equal(loadConfig({ ...STAGING, ...o }).ok, false);
  });
}

const productionMisdirections = {
  'staging project': { FIREBASE_PROJECT_ID: 'dairsharaf-staging' },
  'staging service account': { FIREBASE_CLIENT_EMAIL: 'order-worker-staging@dairsharaf-staging.iam.gserviceaccount.com' },
  'sink as Telegram': { TELEGRAM_API_BASE: `${SINK}/telegram` },
  'Turnstile test secret': { TURNSTILE_SECRET: '1x0000000000000000000000000000000AA' },
  'demo project': { FIREBASE_PROJECT_ID: 'demo-x' },
  'http origin': { ALLOWED_ORIGINS: 'http://dairsharaf.com' },
};
for (const [name, o] of Object.entries(productionMisdirections)) {
  test(`production guard blocks: ${name}`, () => {
    withTarget('production');
    assert.equal(loadConfig({ ...PRODUCTION, ...o }).ok, false);
  });
}

test('misconfigured staging Worker answers CONFIG_ERROR and makes ZERO outbound requests', async () => {
  withTarget('staging');
  const original = globalThis.fetch;
  let outbound = 0;
  globalThis.fetch = async () => {
    outbound += 1;
    throw new Error('outbound blocked in test');
  };
  try {
    for (const env of [PRODUCTION, { ...STAGING, FIREBASE_PROJECT_ID: 'antastore1-82b50' }, { ...STAGING, TELEGRAM_API_BASE: 'https://api.telegram.org' }]) {
      const res = await worker.fetch(new Request('https://w.test/create-order', { method: 'POST', body: '{}' }), env, { waitUntil() {} });
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { ok: false, code: 'CONFIG_ERROR' });
      assert.equal(await worker.scheduled({}, env, { waitUntil() {} }), undefined);
    }
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(outbound, 0);
});

test('production refuses the transitional modes: PRICE_CHECK_MODE and TURNSTILE_MODE must both be enforce', () => {
  withTarget('production');
  assert.equal(loadConfig(PRODUCTION).ok, true);
  for (const [k, v] of [['PRICE_CHECK_MODE', 'log'], ['PRICE_CHECK_MODE', undefined], ['TURNSTILE_MODE', 'log'], ['TURNSTILE_MODE', 'off'], ['TURNSTILE_MODE', undefined]]) {
    const env = { ...PRODUCTION, [k]: v };
    if (v === undefined) delete env[k];
    const c = loadConfig(env);
    assert.equal(c.ok, false, `${k}=${v}`);
    assert.ok(c.errors.some((e) => e.includes(`production requires ${k}=enforce`)), c.errors.join('; '));
  }
  // staging keeps its own (log) price mode unchanged
  withTarget('staging');
  assert.equal(loadConfig({ ...STAGING, PRICE_CHECK_MODE: 'log' }).ok, true);
});
