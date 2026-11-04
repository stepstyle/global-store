// Firebase ID token verification (src/auth.js) — pure, no network.
// TEST keys only: generated here at run time (never Google's keys, never a real token). fetch is a local fake.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { verifyFirebaseIdToken, bearerToken, clearKeyCache, AuthError, GOOGLE_SECURETOKEN_JWKS_URL } from '../../src/auth.js';
import { loadConfig } from '../../src/config.js';
import { makeTestSigner } from '../token-signer.mjs';

const PROJECT = 'demo-dairsharaf-orders';
const JWKS = 'http://127.0.0.1:9/jwks'; // never actually contacted: fetch is faked below
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const nowSec = Math.floor(NOW / 1000);

let signer; // key "k1"
let other; // a DIFFERENT key pair that also calls itself "k1" (forgery)
let fetchCalls;
let jwksBody;
let fakeFetch;

beforeEach(async () => {
  clearKeyCache();
  signer ??= await makeTestSigner('k1');
  other ??= await makeTestSigner('k1');
  jwksBody = { keys: [signer.jwk] };
  fetchCalls = 0;
  fakeFetch = async (url) => {
    fetchCalls++;
    assert.equal(url, JWKS, 'only the configured key URL is fetched');
    return new Response(JSON.stringify(jwksBody), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
  };
});
afterEach(() => clearKeyCache());

const claims = (o = {}) => ({
  iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'alice-uid', auth_time: nowSec - 600, iat: nowSec - 60, exp: nowSec + 3000,
  email: 'alice@example.com', email_verified: true, ...o,
});
const verify = (token, o = {}) => verifyFirebaseIdToken(token, { projectId: PROJECT, jwksUrl: JWKS, fetch: fakeFetch, nowMs: NOW, ...o });
async function rejects(promise, code, reason) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof AuthError, `AuthError expected, got ${e}`);
    assert.equal(e.code, code);
    if (reason) assert.equal(e.reason, reason);
    return true;
  });
}

// ------------------------------------------------------------------ valid
test('valid token -> uid from sub (+ email flags)', async () => {
  const r = await verify(await signer.sign(claims()));
  assert.deepEqual(r, { uid: 'alice-uid', email: 'alice@example.com', emailVerified: true });
});

test('keys are cached (max-age): 3 verifications -> 1 key fetch', async () => {
  const t = await signer.sign(claims());
  await verify(t);
  await verify(t);
  await verify(t);
  assert.equal(fetchCalls, 1);
});

test('keys refetched after max-age expires', async () => {
  const t = await signer.sign(claims({ exp: nowSec + 2 * 3600 }));
  await verify(t);
  await verify(t, { nowMs: NOW + 3601 * 1000 });
  assert.equal(fetchCalls, 2);
});

test('key rotation: unknown kid -> one refetch (after >= 60s) finds the new key', async () => {
  await verify(await signer.sign(claims()));
  const rotated = await makeTestSigner('k2');
  jwksBody = { keys: [signer.jwk, rotated.jwk] };
  const later = NOW + 61_000;
  const r = await verify(await rotated.sign(claims({ iat: nowSec })), { nowMs: later });
  assert.equal(r.uid, 'alice-uid');
  assert.equal(fetchCalls, 2);
});

// ------------------------------------------------------------------ expired / forged / other project
test('expired token -> AUTH_EXPIRED (refreshable)', async () => {
  await rejects(verify(await signer.sign(claims({ exp: nowSec - 1 }))), 'AUTH_EXPIRED');
  await rejects(verify(await signer.sign(claims({ exp: nowSec }))), 'AUTH_EXPIRED');
});

test('forged signature (other key, same kid) -> AUTH_INVALID signature', async () => {
  await rejects(verify(await other.sign(claims())), 'AUTH_INVALID', 'signature');
});

test('forged AND expired -> AUTH_INVALID (never told "expired" for a forgery)', async () => {
  await rejects(verify(await other.sign(claims({ exp: nowSec - 100 }))), 'AUTH_INVALID', 'signature');
});

test('payload tampered after signing (uid swapped) -> AUTH_INVALID signature', async () => {
  const [h, , s] = (await signer.sign(claims())).split('.');
  const p = Buffer.from(JSON.stringify(claims({ sub: 'mallory-uid' }))).toString('base64url');
  await rejects(verify(`${h}.${p}.${s}`), 'AUTH_INVALID', 'signature');
});

test('token of ANOTHER Firebase project -> AUTH_INVALID aud / iss', async () => {
  await rejects(verify(await signer.sign(claims({ aud: 'other-project', iss: 'https://securetoken.google.com/other-project' }))), 'AUTH_INVALID', 'aud');
  await rejects(verify(await signer.sign(claims({ iss: 'https://securetoken.google.com/other-project' }))), 'AUTH_INVALID', 'iss');
  await rejects(verify(await signer.sign(claims({ iss: 'https://accounts.google.com' }))), 'AUTH_INVALID', 'iss');
  await rejects(verify(await signer.sign(claims({ aud: [PROJECT] }))), 'AUTH_INVALID', 'aud');
});

// ------------------------------------------------------------------ algorithm / header
test('alg "none" (unsigned, e.g. an Auth-emulator token) -> AUTH_INVALID alg', async () => {
  const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', kid: 'k1' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims())).toString('base64url');
  await rejects(verify(`${h}.${p}.x`), 'AUTH_INVALID', 'alg');
  await rejects(verify(`${h}.${p}.`), 'AUTH_INVALID', 'malformed');
});

test('alg HS256 / RS512 / ES256 -> AUTH_INVALID alg', async () => {
  for (const alg of ['HS256', 'RS512', 'ES256', 'PS256', 'rs256']) {
    await rejects(verify(await signer.sign(claims(), { alg })), 'AUTH_INVALID', 'alg');
  }
});

test('missing / unknown kid -> AUTH_INVALID', async () => {
  await rejects(verify(await signer.sign(claims(), { kid: undefined })), 'AUTH_INVALID', 'kid');
  await rejects(verify(await signer.sign(claims(), { kid: 'nope' })), 'AUTH_INVALID', 'unknown_kid');
});

test('typ other than JWT -> AUTH_INVALID', async () => {
  await rejects(verify(await signer.sign(claims(), { typ: 'at+jwt' })), 'AUTH_INVALID', 'typ');
});

// ------------------------------------------------------------------ time / subject claims
test('issued in the future (iat / auth_time beyond 60s skew) -> AUTH_INVALID', async () => {
  await rejects(verify(await signer.sign(claims({ iat: nowSec + 120 }))), 'AUTH_INVALID', 'iat');
  await rejects(verify(await signer.sign(claims({ auth_time: nowSec + 120 }))), 'AUTH_INVALID', 'auth_time');
  await verify(await signer.sign(claims({ iat: nowSec + 30 }))); // within skew
});

test('missing / non-numeric time claims -> AUTH_INVALID', async () => {
  await rejects(verify(await signer.sign(claims({ iat: undefined }))), 'AUTH_INVALID', 'iat');
  await rejects(verify(await signer.sign(claims({ auth_time: '1' }))), 'AUTH_INVALID', 'auth_time');
  await rejects(verify(await signer.sign(claims({ exp: undefined }))), 'AUTH_INVALID', 'exp');
});

test('subject: empty / too long / not a string -> AUTH_INVALID sub', async () => {
  await rejects(verify(await signer.sign(claims({ sub: '' }))), 'AUTH_INVALID', 'sub');
  await rejects(verify(await signer.sign(claims({ sub: 'u'.repeat(129) }))), 'AUTH_INVALID', 'sub');
  await rejects(verify(await signer.sign(claims({ sub: 42 }))), 'AUTH_INVALID', 'sub');
  await verify(await signer.sign(claims({ sub: 'u'.repeat(128) })));
});

// ------------------------------------------------------------------ malformed
test('malformed tokens -> AUTH_INVALID malformed', async () => {
  for (const t of ['', 'abc', 'a.b', 'a.b.c.d', '!!.??.**', 'x'.repeat(5000)]) {
    await rejects(verify(t), 'AUTH_INVALID', 'malformed');
  }
});

test('Authorization header parsing', () => {
  assert.equal(bearerToken(null), undefined);
  assert.equal(bearerToken(undefined), undefined);
  assert.equal(bearerToken('Bearer a.b.c'), 'a.b.c');
  for (const bad of ['', 'Bearer', 'Bearer ', 'Basic dXNlcjpwYXNz', 'bearer a.b.c', 'Bearer a b', 'Token a.b.c']) {
    assert.throws(() => bearerToken(bad), (e) => e instanceof AuthError && e.code === 'AUTH_INVALID', bad);
  }
});

// ------------------------------------------------------------------ key source failures
test('keys unavailable (network error / HTTP 500 / no usable keys) -> AUTH_UNAVAILABLE', async () => {
  const t = await signer.sign(claims());
  await rejects(verify(t, { fetch: async () => { throw new TypeError('fetch failed'); } }), 'AUTH_UNAVAILABLE');
  clearKeyCache();
  await rejects(verify(t, { fetch: async () => new Response('x', { status: 500 }) }), 'AUTH_UNAVAILABLE');
  clearKeyCache();
  await rejects(verify(t, { fetch: async () => new Response(JSON.stringify({ keys: [{ ...signer.jwk, alg: 'RS512' }] }), { status: 200 }) }), 'AUTH_UNAVAILABLE');
  clearKeyCache();
  await rejects(verify(t, { jwksUrl: '' }), 'AUTH_UNAVAILABLE');
});

// ------------------------------------------------------------------ config: where keys may come from
const FAKE_KEY = '-----BEGIN PRIVATE KEY-----\nFAKEFAKEFAKE\n-----END PRIVATE KEY-----\n';
const PRODUCTION = {
  ENVIRONMENT: 'production', FIREBASE_PROJECT_ID: 'antastore1-82b50', FIRESTORE_AUTH: 'service-account',
  FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk-abcde@antastore1-82b50.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: FAKE_KEY,
  TURNSTILE_SECRET: '0x4AAAAAAAREALLOOKINGSECRET',
};
const LOCAL = {
  ENVIRONMENT: 'local', FIREBASE_PROJECT_ID: 'demo-x', FIRESTORE_AUTH: 'emulator', FIRESTORE_BASE_URL: 'http://127.0.0.1:1/v1',
  OAUTH_TOKEN_URL: 'http://127.0.0.1:1/o', TELEGRAM_API_BASE: 'http://127.0.0.1:1/t', SENDGRID_API_BASE: 'http://127.0.0.1:1/s', TURNSTILE_VERIFY_URL: 'http://127.0.0.1:1/v',
};

test('config: production uses ONLY Google\'s official key URL and refuses any override', () => {
  globalThis.__DEPLOY_TARGET__ = 'production';
  try {
    const c = loadConfig(PRODUCTION);
    assert.equal(c.ok, true, c.errors.join('; '));
    assert.equal(c.authJwksUrl, GOOGLE_SECURETOKEN_JWKS_URL);
    for (const u of ['http://127.0.0.1:8789/jwks', 'https://evil.example/jwks', 'https://www.googleapis.com/other']) {
      assert.equal(loadConfig({ ...PRODUCTION, AUTH_JWKS_URL: u }).ok, false, u);
    }
  } finally {
    delete globalThis.__DEPLOY_TARGET__;
  }
});

test('config: local accepts only a loopback key URL (or none)', () => {
  assert.equal(loadConfig(LOCAL).ok, true, loadConfig(LOCAL).errors.join('; '));
  assert.equal(loadConfig(LOCAL).authJwksUrl, '');
  assert.equal(loadConfig({ ...LOCAL, AUTH_JWKS_URL: 'http://127.0.0.1:8789/jwks' }).ok, true);
  assert.equal(loadConfig({ ...LOCAL, AUTH_JWKS_URL: GOOGLE_SECURETOKEN_JWKS_URL }).ok, false, 'local never contacts Google');
});
