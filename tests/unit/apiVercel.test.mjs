// Vercel functions api/notify-customer.js + api/create-order.js — LOCAL ONLY: test-only signing key generated in
// memory, Google's key URL and SendGrid answered by a fake fetch. Nothing is sent anywhere.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleNotify, buildEmail, adminUids, PROJECT_ID } from '../../api/notify-customer.js';
import createOrder from '../../api/create-order.js';
import { makeTestSigner } from '../../workers/order-worker/test/token-signer.mjs';
import { GOOGLE_SECURETOKEN_JWKS_URL } from '../../workers/order-worker/src/auth.js';

const ADMIN = 'AdminUid0123456789';
const OTHER = 'OtherUid0123456789';
let signer, sent, origFetch;
const env = (o = {}) => ({ NOTIFY_ADMIN_UIDS: ADMIN, SENDGRID_API_KEY: 'SG.fake-for-tests', ...o });
const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end() { return r; } }; return r; };
const fakeFetch = async (url, init) => {
  if (String(url) === GOOGLE_SECURETOKEN_JWKS_URL) return new Response(JSON.stringify({ keys: [signer.jwk] }), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' } });
  if (String(url) === 'https://api.sendgrid.com/v3/mail/send') { sent.push(JSON.parse(init.body)); return new Response(null, { status: 202 }); }
  throw new Error(`unexpected ${url}`);
};
beforeEach(async () => { signer ??= await makeTestSigner('test-kid-1'); sent = []; origFetch = globalThis.fetch; globalThis.fetch = fakeFetch; });
afterEach(() => { globalThis.fetch = origFetch; });
const call = async (body, { token, e = env(), method = 'POST' } = {}) => {
  const r = res();
  await handleNotify({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, r, { env: e, fetchImpl: fakeFetch });
  return r;
};
const ok = { email: 'customer@example.com', name: 'Customer', orderId: 'ORD-ABCD1234-XYZ1', status: 'accepted' };

test('notify-customer: fail-closed when not configured (no admin list / no SendGrid key)', async () => {
  const t = await signer.idToken({ projectId: PROJECT_ID, uid: ADMIN });
  assert.equal((await call(ok, { token: t, e: env({ NOTIFY_ADMIN_UIDS: '' }) })).code, 503);
  assert.equal((await call(ok, { token: t, e: env({ SENDGRID_API_KEY: '' }) })).code, 503);
  assert.equal(sent.length, 0);
});

test('notify-customer: no / bad / foreign-project / non-admin token -> refused, nothing sent (was an open relay)', async () => {
  assert.equal((await call(ok)).code, 401, 'no token');
  assert.equal((await call(ok, { token: 'not.a.jwt' })).code, 401);
  assert.equal((await call(ok, { token: await signer.idToken({ projectId: 'dairsharaf-staging', uid: ADMIN }) })).code, 401, 'staging token');
  assert.equal((await call(ok, { token: await signer.idToken({ projectId: PROJECT_ID, uid: OTHER }) })).code, 403, 'signed-in non-admin');
  assert.equal((await call(ok, { token: await signer.idToken({ projectId: PROJECT_ID, uid: ADMIN, ttlSec: -10 }) })).code, 401, 'expired');
  assert.equal((await call(ok, { method: 'GET' })).code, 405);
  assert.equal(sent.length, 0);
});

test('notify-customer: a verified admin sends the e-mail; inputs validated and HTML-escaped', async () => {
  const t = await signer.idToken({ projectId: PROJECT_ID, uid: ADMIN });
  const r = await call({ ...ok, name: '<img src=x onerror=alert(1)>"' }, { token: t });
  assert.equal(r.code, 200);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].personalizations, [{ to: [{ email: 'customer@example.com' }] }]);
  const html = sent[0].content[0].value;
  assert.ok(!html.includes('<img'), 'name escaped');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;'));
  for (const b of [{ ...ok, email: 'a@b' }, { ...ok, email: 'x"<y>@e.com' }, { ...ok, orderId: '<script>' }, { ...ok, orderId: 'a'.repeat(80) }, { ...ok, name: { x: 1 } }]) {
    assert.equal((await call(b, { token: t })).code, 400, JSON.stringify(b).slice(0, 60));
  }
  assert.equal((await call({ ...ok, status: 'delivered' }, { token: t })).body.message, 'No email needed for this status');
  assert.equal(sent.length, 1);
  assert.match(buildEmail({ name: 'n', orderId: 'ORD-1-2', status: 'shipped' }).html, /tracking\?orderId=ORD-1-2/);
});

test('notify-customer: no CORS grant (same-origin only); admin list parsing', () => {
  const src = readFileSync(new URL('../../api/notify-customer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Access-Control-Allow-Origin/);
  assert.deepEqual([...adminUids({ NOTIFY_ADMIN_UIDS: ` ${ADMIN} , bad uid!, ${OTHER}` })], [ADMIN, OTHER]);
});

test('create-order (retired): 410, never forwards, never uses WORKER_AUTH_TOKEN', async () => {
  const r = res();
  createOrder({ method: 'POST', body: { order: {} } }, r);
  assert.equal(r.code, 410);
  const src = readFileSync(new URL('../../api/create-order.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /fetch\(|process\.env|Access-Control-Allow-Origin/);
});

test('reviews.ts: no silent local save when Firebase is active; no e-mail written into public reviews', () => {
  const src = readFileSync(new URL('../../src/services/reviews.ts', import.meta.url), 'utf8');
  const blocks = src.split('// Local Fallback').slice(0, -1);
  const mutations = blocks.filter((b) => /Firebase (upsert|toggleLike|setStatus|setAdminReply|remove) failed/.test(b.slice(-400)));
  assert.equal(mutations.length, 5, 'upsert, like, status, reply, remove');
  for (const b of mutations) assert.match(b.slice(-400), /if \(isFirebaseInitialized && firebaseDb\) throw error;/);
  assert.doesNotMatch(src, /userEmail,/, 'userEmail never written');
  const pd = readFileSync(new URL('../../src/pages/ProductDetails.tsx', import.meta.url), 'utf8');
  assert.match(pd, /reviewFailed', 'فشل حفظ التقييم، جرب مرة أخرى'/, 'the customer is told it failed');
});
