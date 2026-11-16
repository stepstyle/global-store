// api/notify-customer.js (was an open e-mail relay) + the AdminDashboard call — LOCAL ONLY.
// Test-only signing key generated in memory; Google's key URL and SendGrid are answered by a fake fetch.
// Nothing is sent anywhere.
//   node --test tests/unit/notifyCustomer.test.mjs
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleNotify, buildEmail, adminUids, PROJECT_ID } from '../../api/notify-customer.js';
import { makeTestSigner } from '../../workers/order-worker/test/token-signer.mjs';
import { GOOGLE_SECURETOKEN_JWKS_URL } from '../../workers/order-worker/src/auth.js';

const ADMIN = 'AdminUid0123456789';
const ADMIN2 = 'SecondAdminUid012345';
const OTHER = 'OtherUid0123456789';
let signer, sent, origFetch;
const env = (o = {}) => ({ NOTIFY_ADMIN_UIDS: `${ADMIN},${ADMIN2}`, SENDGRID_API_KEY: 'SG.fake-for-tests', ...o });
const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end() { return r; } }; return r; };
const fakeFetch = async (url, init) => {
  if (String(url) === GOOGLE_SECURETOKEN_JWKS_URL) return new Response(JSON.stringify({ keys: [signer.jwk] }), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=3600' } });
  if (String(url) === 'https://api.sendgrid.com/v3/mail/send') { sent.push(JSON.parse(init.body)); return new Response(null, { status: 202 }); }
  throw new Error(`unexpected ${url}`);
};
beforeEach(async () => { signer ??= await makeTestSigner('test-kid-1'); sent = []; origFetch = globalThis.fetch; globalThis.fetch = fakeFetch; });
afterEach(() => { globalThis.fetch = origFetch; });
const call = async (body, { token, header, e = env(), method = 'POST' } = {}) => {
  const r = res();
  const headers = header !== undefined ? { authorization: header } : token ? { authorization: `Bearer ${token}` } : {};
  await handleNotify({ method, headers, body }, r, { env: e, fetchImpl: fakeFetch });
  return r;
};
const ok = { email: 'customer@example.com', name: 'Customer', orderId: 'ORD-ABCD1234-XYZ1', status: 'shipped' };

test('fail-closed when not configured (no admin list / no SendGrid key) — even for a valid admin', async () => {
  const t = await signer.idToken({ projectId: PROJECT_ID, uid: ADMIN });
  assert.equal((await call(ok, { token: t, e: env({ NOTIFY_ADMIN_UIDS: '' }) })).code, 503);
  assert.equal((await call(ok, { token: t, e: env({ NOTIFY_ADMIN_UIDS: 'not a uid!' }) })).code, 503, 'only malformed entries = empty list');
  assert.equal((await call(ok, { token: t, e: env({ SENDGRID_API_KEY: '' }) })).code, 503);
  assert.equal(sent.length, 0);
});

test('refused, nothing sent: no token, bad / foreign-project / expired / non-admin token, wrong scheme, GET', async () => {
  assert.equal((await call(ok)).code, 401, 'no token (the old open relay)');
  assert.equal((await call(ok, { token: 'not.a.jwt' })).code, 401, 'malformed');
  assert.equal((await call(ok, { header: 'Basic abc' })).code, 401, 'not a Bearer token');
  assert.equal((await call(ok, { token: await signer.idToken({ projectId: 'dairsharaf-staging', uid: ADMIN }) })).code, 401, 'token of another Firebase project');
  assert.equal((await call(ok, { token: await signer.idToken({ projectId: PROJECT_ID, uid: ADMIN, ttlSec: -10 }) })).code, 401, 'expired');
  assert.equal((await call(ok, { token: await signer.idToken({ projectId: PROJECT_ID, uid: OTHER }) })).code, 403, 'signed-in customer, not an admin');
  const forger = await makeTestSigner('test-kid-1'); // same key id, DIFFERENT key: a forged signature
  assert.equal((await call(ok, { token: await forger.idToken({ projectId: PROJECT_ID, uid: ADMIN }) })).code, 401, 'forged signature');
  assert.equal((await call(ok, { method: 'GET' })).code, 405);
  assert.equal(sent.length, 0, 'not a single e-mail');
});

test('a verified admin (any listed uid) sends exactly one e-mail; inputs validated and HTML-escaped', async () => {
  for (const uid of [ADMIN, ADMIN2]) {
    sent = [];
    const r = await call({ ...ok, name: '<img src=x onerror=alert(1)>"' }, { token: await signer.idToken({ projectId: PROJECT_ID, uid }) });
    assert.equal(r.code, 200, uid);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].personalizations, [{ to: [{ email: 'customer@example.com' }] }]);
    const html = sent[0].content[0].value;
    assert.ok(!html.includes('<img'), 'name escaped');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;'));
  }
  const t = await signer.idToken({ projectId: PROJECT_ID, uid: ADMIN });
  sent = [];
  for (const b of [{ ...ok, email: 'a@b' }, { ...ok, email: 'x"<y>@e.com' }, { ...ok, orderId: '<script>' }, { ...ok, orderId: 'a'.repeat(80) }, { ...ok, name: { x: 1 } }]) {
    assert.equal((await call(b, { token: t })).code, 400, JSON.stringify(b).slice(0, 60));
  }
  assert.equal(sent.length, 0);
  assert.match(buildEmail({ name: 'n', orderId: 'ORD-1-2', status: 'shipped' }).html, /tracking\?orderId=ORD-1-2/);
});

test('no CORS grant (same-origin only); admin list parsing', () => {
  const src = readFileSync(new URL('../../api/notify-customer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Access-Control-Allow-Origin/);
  assert.deepEqual([...adminUids({ NOTIFY_ADMIN_UIDS: ` ${ADMIN} , bad uid!, ${OTHER}` })], [ADMIN, OTHER]);
});

// ------------------------------------------------------------------ AdminDashboard -> API (the real call site)
const DASH = readFileSync(new URL('../../src/pages/AdminDashboard.tsx', import.meta.url), 'utf8');
const callSite = DASH.slice(DASH.indexOf("fetch('/api/notify-customer'") - 400, DASH.indexOf("fetch('/api/notify-customer'") + 600);

test('AdminDashboard sends the signed-in admin\'s Firebase ID token, and nothing is sent without one', () => {
  assert.match(DASH, /import \{[^}]*\bgetFirebaseAuth\b[^}]*\} from '\.\.\/services\/firebase'/);
  assert.match(callSite, /getFirebaseAuth\(\)\?\.currentUser\?\.getIdToken\(\)/);
  // no token (signed out) -> the admin is warned and the block RETURNS before any request
  const noToken = callSite.slice(callSite.indexOf('if (!idToken)'), callSite.indexOf("fetch('/api/notify-customer'"));
  assert.match(noToken, /^if \(!idToken\) \{[^}]*\breturn;\s*\}/, 'no token (signed out) -> no request at all');
  // a refused / failed send is reported to the admin instead of being silent (S1.1)
  assert.match(callSite, /if \(!r\.ok\)/);
  assert.match(DASH, /لم يُرسل البريد للزبون/);
  // the e-mail is never attempted from a sandbox (preview) build
  assert.match(DASH, /if \(IS_LIVE && orderToNotify && orderToNotify\.customerEmail\)/);
  assert.match(callSite, /Authorization: `Bearer \$\{idToken\}`/);
  // the body is unchanged: the same four fields as before the fix
  for (const f of ['email: orderToNotify.customerEmail', "name: orderToNotify.address?.fullName || 'عميلنا العزيز'", 'orderId: id', 'status: newStatus']) assert.ok(callSite.includes(f), f);
  assert.equal((DASH.match(/\/api\/notify-customer/g) || []).length, 1, 'one call site');
});

test('contract: the dashboard\'s exact request is accepted for an admin and refused for anyone else; behaviour per status unchanged', async () => {
  // what the dashboard sends for an order (fields as in the call site), with the admin's ID token
  const order = { id: 'ORD-4CB740C0-MW5PPKHT', customerEmail: 'buyer@example.com', address: { fullName: 'Test Buyer' } };
  const dashboardBody = (status) => ({ email: order.customerEmail, name: order.address?.fullName || 'عميلنا العزيز', orderId: order.id, status });
  const adminT = await signer.idToken({ projectId: PROJECT_ID, uid: ADMIN });
  const shipped = await call(dashboardBody('shipped'), { token: adminT });
  assert.equal(shipped.code, 200);
  assert.equal(sent.length, 1, 'shipping e-mail sent once');
  assert.match(sent[0].subject, /في الطريق/);
  // unchanged on purpose (reviewed separately): the dashboard's accept sends status "processing" — no e-mail, as before
  for (const s of ['processing', 'delivered', 'cancelled']) {
    const r = await call(dashboardBody(s), { token: adminT });
    assert.equal(r.code, 200, s);
    assert.equal(r.body.message, 'No email needed for this status', s);
  }
  assert.equal(sent.length, 1);
  // the same request by a signed-in non-admin / with no token
  assert.equal((await call(dashboardBody('shipped'), { token: await signer.idToken({ projectId: PROJECT_ID, uid: OTHER }) })).code, 403);
  assert.equal((await call(dashboardBody('shipped'))).code, 401);
  assert.equal(sent.length, 1);
});
