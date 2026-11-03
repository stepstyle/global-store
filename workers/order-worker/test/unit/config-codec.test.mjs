import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';
import { encode, decode, encodeFields, decodeFields, rawNumber } from '../../src/firestore.js';

const local = {
  ENVIRONMENT: 'local',
  FIREBASE_PROJECT_ID: 'demo-x',
  FIRESTORE_AUTH: 'emulator',
  FIRESTORE_BASE_URL: 'http://127.0.0.1:8086/v1',
  OAUTH_TOKEN_URL: 'http://127.0.0.1:1/o',
  TELEGRAM_API_BASE: 'http://127.0.0.1:1/t',
  SENDGRID_API_BASE: 'http://127.0.0.1:1/s',
  TURNSTILE_VERIFY_URL: 'http://127.0.0.1:1/v',
};

test('valid local config passes', () => assert.equal(loadConfig(local).ok, true));

const guards = [
  ['production project id', { FIREBASE_PROJECT_ID: 'antastore1-82b50' }],
  ['non-demo project', { FIREBASE_PROJECT_ID: 'my-staging' }],
  ['real Firestore URL', { FIRESTORE_BASE_URL: 'https://firestore.googleapis.com/v1' }],
  ['real Telegram URL', { TELEGRAM_API_BASE: 'https://api.telegram.org' }],
  ['real SendGrid URL', { SENDGRID_API_BASE: 'https://api.sendgrid.com' }],
  ['real OAuth URL', { OAUTH_TOKEN_URL: 'https://oauth2.googleapis.com/token' }],
  ['real Turnstile URL', { TURNSTILE_VERIFY_URL: 'https://challenges.cloudflare.com/turnstile/v0/siteverify' }],
  ['missing URL falls back to nothing in local', { TELEGRAM_API_BASE: '' }],
  ['service-account auth in local', { FIRESTORE_AUTH: 'service-account' }],
  ['missing ENVIRONMENT', { ENVIRONMENT: '' }],
  ['ENVIRONMENT=staging on a local build', { ENVIRONMENT: 'staging' }],
  ['ENVIRONMENT=production on a local build', { ENVIRONMENT: 'production' }],
  ['localhost lookalike host', { FIRESTORE_BASE_URL: 'http://127.0.0.1.evil.com/v1' }],
  ['PRICE_CHECK_MODE=enforce not available in phase 1', { PRICE_CHECK_MODE: 'enforce' }],
];
for (const [name, o] of guards) {
  test(`guard blocks: ${name}`, () => assert.equal(loadConfig({ ...local, ...o }).ok, false));
}

test('production rejects demo project and emulator auth', () => {
  assert.equal(loadConfig({ ENVIRONMENT: 'production', FIREBASE_PROJECT_ID: 'demo-x', FIRESTORE_AUTH: 'service-account' }).ok, false);
  assert.equal(loadConfig({ ENVIRONMENT: 'production', FIREBASE_PROJECT_ID: 'real-proj', FIRESTORE_AUTH: 'emulator' }).ok, false);
});

test('defaults: reconcile disabled, stock log, turnstile log', () => {
  const c = loadConfig(local);
  assert.equal(c.reconcileEnabled, false);
  assert.equal(c.stockMode, 'log');
  assert.equal(c.turnstileMode, 'log');
});

test('codec round-trip keeps ints, doubles, nulls, nested maps/arrays, dates', () => {
  const obj = { i: 3, d: 2.5, s: 'x', b: true, n: null, a: [1, 2.5, 'z', null], m: { k: { deep: 1 } }, t: new Date('2026-11-03T10:00:00.000Z') };
  const back = decodeFields(encodeFields(obj));
  assert.deepEqual(back, obj);
  assert.deepEqual(encode(3), { integerValue: '3' });
  assert.deepEqual(encode(2.5), { doubleValue: 2.5 });
  assert.equal(decode({ integerValue: '7' }), 7);
});

test('rawNumber: numeric strings flagged, junk rejected', () => {
  assert.deepEqual(rawNumber({ stringValue: ' 8 ' }), { value: 8, fromString: true });
  assert.deepEqual(rawNumber({ stringValue: 'eight' }), { value: null, fromString: false });
  assert.deepEqual(rawNumber(undefined), { value: null, fromString: false });
});
