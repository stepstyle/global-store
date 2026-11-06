// wrangler.production.toml draft + production/check-config.mjs + config.js production refusals — LOCAL, no network.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkProductionConfig, DEFAULT_TOML } from '../../production/check-config.mjs';
import { loadConfig } from '../../src/config.js';

const DRAFT = readFileSync(DEFAULT_TOML, 'utf8');
const FILLED = DRAFT
  .replace('REPLACE_WITH_PRODUCTION_WORKER_NAME', 'anta-order-v2')
  .replace('REPLACE_WITH_PRODUCTION_CLOUDFLARE_ACCOUNT_ID', '0123456789abcdef0123456789abcdef')
  .replace('REPLACE_WITH_TELEGRAM_CHAT_ID', '-1001234567890')
  .replace('REPLACE_WITH_ADMIN_NOTIFICATION_EMAIL', 'admin@example.com')
  .replace('REPLACE_WITH_VERIFIED_SENDGRID_SENDER', 'orders@example.com');
afterEach(() => { delete globalThis.__DEPLOY_TARGET__; });

test('the draft breaks no rule but is BLOCKED by its unfilled production values (nothing invented)', async () => {
  const r = await checkProductionConfig(DRAFT);
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.placeholders.sort(), ['ADMIN_EMAIL', 'EMAIL_FROM', 'TELEGRAM_CHAT_ID', 'account_id', 'name']);
  assert.equal(r.deployable, false);
  assert.match(DRAFT, /^account_id = "REPLACE_WITH_/m, 'wrangler itself refuses a non-hex account id');
});

test('once filled in (fake values here), the shape is deployable and config.js (production build) accepts it', async () => {
  const r = await checkProductionConfig(FILLED);
  assert.deepEqual(r.violations, []);
  assert.equal(r.deployable, true);
});

test('every unsafe variant is a VIOLATION', async () => {
  const bad = {
    'staging project': FILLED.replace('FIREBASE_PROJECT_ID = "antastore1-82b50"', 'FIREBASE_PROJECT_ID = "dairsharaf-staging"'),
    'price log': FILLED.replace('PRICE_CHECK_MODE = "enforce"', 'PRICE_CHECK_MODE = "log"'),
    'turnstile log': FILLED.replace('TURNSTILE_MODE = "enforce"', 'TURNSTILE_MODE = "log"'),
    'turnstile test secret in vars': FILLED.replace('[vars]', '[vars]\nTURNSTILE_SECRET = "1x0000000000000000000000000000000AA"'),
    'local origin': FILLED.replace('https://www.dairsharaf.com"', 'https://www.dairsharaf.com,http://localhost:3000"'),
    'extra origin': FILLED.replace('https://www.dairsharaf.com"', 'https://www.dairsharaf.com,https://evil.example"'),
    'staging sink': FILLED.replace('[vars]', '[vars]\nTELEGRAM_API_BASE = "https://anta-notify-sink-staging.hopemohmmed.workers.dev/telegram"'),
    'old worker name': FILLED.replace('name = "anta-order-v2"', 'name = "anta-order-notify"'),
    'staging name': FILLED.replace('name = "anta-order-v2"', 'name = "anta-order-notify-staging"'),
    'staging build target': FILLED.replace(`__DEPLOY_TARGET__ = "'production'"`, `__DEPLOY_TARGET__ = "'staging'"`),
    'secret in vars': FILLED.replace('[vars]', '[vars]\nSENDGRID_API_KEY = "SG.fake"'),
    'emulator': FILLED.replace('[vars]', '[vars]\nFIRESTORE_BASE_URL = "http://127.0.0.1:8080/v1"'),
  };
  for (const [name, text] of Object.entries(bad)) {
    const r = await checkProductionConfig(text);
    assert.ok(r.violations.length > 0, `${name}: must be refused`);
    assert.equal(r.deployable, false, name);
  }
});

test('config.js: a production Worker with any REPLACE_WITH_ value never runs (CONFIG_ERROR)', () => {
  globalThis.__DEPLOY_TARGET__ = 'production';
  const env = {
    ENVIRONMENT: 'production', FIREBASE_PROJECT_ID: 'antastore1-82b50', FIRESTORE_AUTH: 'service-account',
    FIREBASE_CLIENT_EMAIL: 'sa@antastore1-82b50.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----',
    TURNSTILE_SECRET: '0x4AAAAAAAFAKE', PRICE_CHECK_MODE: 'enforce', TURNSTILE_MODE: 'enforce', ALLOWED_ORIGINS: 'https://dairsharaf.com',
  };
  assert.equal(loadConfig(env).ok, true);
  const c = loadConfig({ ...env, TELEGRAM_CHAT_ID: 'REPLACE_WITH_TELEGRAM_CHAT_ID' });
  assert.equal(c.ok, false);
  assert.ok(c.errors.some((e) => e.includes('TELEGRAM_CHAT_ID')));
});
