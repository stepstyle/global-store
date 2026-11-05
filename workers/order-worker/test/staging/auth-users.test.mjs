// Staging test users (staging/auth-users.mjs) + the Firebase Auth part of guardedFetch — LOCAL ONLY.
// Firebase Auth (Identity Toolkit REST) is SIMULATED by an in-process fake behind the real guardedFetch:
// no network, no real user. Fake keys live in the OS temp dir.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertStagingConfig, guardedFetch, StagingGuardError, IDENTITY_TOOLKIT_PATHS } from '../../staging/guard.mjs';
import { makeStagingUsers, StagingAuthError, assertStagingToken, TEST_EMAIL_DOMAIN } from '../../staging/auth-users.mjs';
import { runWithTestUsers } from '../../staging/run-tests.mjs';

const PROD = 'antastore1-82b50';
const FAKE_KEY = '-----BEGIN PRIVATE KEY-----\nFAKEFAKEFAKE\n-----END PRIVATE KEY-----\n';
const STAGING_API_KEY = 'staging-fake-api-key';
let dir;
let st;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'staging-auth-test-'));
  const keyPath = join(dir, 'staging-key.json');
  writeFileSync(keyPath, JSON.stringify({ type: 'service_account', project_id: 'dairsharaf-staging', client_email: 'order-worker-staging@dairsharaf-staging.iam.gserviceaccount.com', private_key: FAKE_KEY }));
  st = assertStagingConfig({
    projectId: 'dairsharaf-staging',
    workerUrl: 'https://anta-order-notify-staging.acme.workers.dev',
    sinkUrl: 'https://anta-notify-sink-staging.acme.workers.dev',
    serviceAccountKeyPath: keyPath,
    firebaseWebConfig: { apiKey: STAGING_API_KEY, authDomain: 'dairsharaf-staging.firebaseapp.com', projectId: 'dairsharaf-staging', appId: '1:000:web:staging' },
    cloudflareAccountId: '0123456789abcdef0123456789abcdef',
    cloudflareLoginEmail: 'staging-owner@example.com',
    firebaseAccountEmail: 'staging-owner@example.com',
  }, { env: {} });
});
after(() => rmSync(dir, { recursive: true, force: true }));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = ({ aud = 'dairsharaf-staging', sub }) => `${b64({ alg: 'RS256', kid: 'k' })}.${b64({ aud, iss: `https://securetoken.google.com/${aud}`, sub, iat: 1, exp: 9e9 })}.sig`;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * In-process fake of Firebase Auth REST. Records every call (path, body) and every password it received.
 * opts: aud (project the tokens claim), signUpError, deleteError(n) -> [status, code] | null, signInError
 */
function fakeAuth(opts = {}) {
  const users = new Map(); // uid -> { email, password }
  const calls = [];
  const passwords = [];
  let deletes = 0;
  const f = async (input, init) => {
    const url = new URL(String(input));
    const body = JSON.parse(init?.body || '{}');
    calls.push({ path: url.pathname, key: url.searchParams.get('key') });
    if (body.password) passwords.push(body.password);
    const step = url.pathname.split(':')[1];
    if (step === 'signUp') {
      if (opts.signUpError) return json(opts.signUpError[0], { error: { message: opts.signUpError[1] } });
      const uid = `uid${users.size + 1}xxxxxxxxxxxxxxxxxxxxxx`;
      users.set(uid, { email: body.email, password: body.password });
      return json(200, { localId: uid, idToken: idToken({ aud: opts.aud, sub: uid }), email: body.email });
    }
    if (step === 'signInWithPassword') {
      if (opts.signInError) return json(400, { error: { message: opts.signInError } });
      const hit = [...users.entries()].find(([, u]) => u.email === body.email && u.password === body.password);
      return hit ? json(200, { localId: hit[0], idToken: idToken({ aud: opts.aud, sub: hit[0] }) }) : json(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
    }
    if (step === 'delete') {
      deletes += 1;
      const e = opts.deleteError?.(deletes, body);
      if (e) return json(e[0], { error: { message: e[1] } });
      const sub = JSON.parse(Buffer.from(String(body.idToken).split('.')[1], 'base64url').toString()).sub;
      if (!users.has(sub)) return json(400, { error: { message: 'USER_NOT_FOUND' } });
      users.delete(sub);
      return json(200, {});
    }
    return json(404, {});
  };
  return { fetch: f, users, calls, passwords, deletes: () => deletes };
}
const guarded = (fake) => guardedFetch(st, fake.fetch);
const noSleep = async () => {};
const secretsIn = (text, fake) => fake.passwords.some((p) => text.includes(p)) || /eyJ[A-Za-z0-9_-]{10,}\./.test(text);

test('happy path: synthetic users in dairsharaf-staging, tokens checked, all deleted; nothing secret left or shown', async () => {
  const fake = fakeAuth();
  const users = makeStagingUsers(st, { fetch: guarded(fake), runId: 'abc123', sleep: noSleep });
  const a = await users.create('a');
  const b = await users.create('b');
  assert.match(a.email, new RegExp(`^stg-abc123-a-1@${TEST_EMAIL_DOMAIN.replace('.', '\\.')}$`));
  assert.match(b.email, /^stg-abc123-b-2@example\.invalid$/);
  assert.equal(assertStagingToken(a.idToken, { uid: a.uid }).aud, 'dairsharaf-staging');
  assert.equal(fake.users.size, 2);
  assert.ok(fake.calls.every((c) => c.key === STAGING_API_KEY), 'only the staging web key');
  const r = await users.cleanup();
  assert.deepEqual(r, { deleted: 2, failed: [] });
  assert.equal(fake.users.size, 0, 'every test user deleted');
  assert.equal(secretsIn(JSON.stringify(r) + users.emails().join(','), fake), false);
});

test('WRONG PROJECT: a token for another project (e.g. production) is refused — and that user is still deleted', async () => {
  for (const aud of [PROD, 'other-staging']) {
    const fake = fakeAuth({ aud });
    const users = makeStagingUsers(st, { fetch: guarded(fake), runId: 'wrong1', sleep: noSleep });
    await assert.rejects(users.create('a'), (e) => e instanceof StagingGuardError && /audience/.test(e.message), aud);
    assert.equal(fake.users.size, 1, 'the call happened (wrong key/project)');
    const r = await users.cleanup();
    assert.equal(r.deleted, 1, `${aud}: cleaned up anyway`);
    assert.equal(fake.users.size, 0);
  }
});

test('WRONG PROJECT in the config: no user is created anywhere (refused before any request)', async () => {
  let calls = 0;
  const spy = async () => { calls += 1; return json(200, {}); };
  for (const projectId of ['other-staging', PROD, '']) {
    assert.throws(() => makeStagingUsers({ ...st, projectId }, { fetch: spy }), StagingGuardError, projectId || 'empty');
  }
  // guardedFetch itself also refuses Firebase Auth for a config of another project
  const f = guardedFetch({ ...st, projectId: 'other-staging' }, spy);
  await assert.rejects(f(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${STAGING_API_KEY}`, { method: 'POST', body: '{}' }), StagingGuardError);
  assert.equal(calls, 0);
});

test('WRONG ACCOUNT / KEY and non-test endpoints: guardedFetch blocks every Firebase Auth call except the three, with exactly the staging key', async () => {
  let calls = 0;
  const spy = async () => { calls += 1; return json(200, {}); };
  const f = guardedFetch(st, spy);
  const base = 'https://identitytoolkit.googleapis.com';
  const blocked = {
    'another API key (another project / account)': [`${base}/v1/accounts:signUp?key=other-key`, 'POST'],
    'no key': [`${base}/v1/accounts:signUp`, 'POST'],
    'two keys': [`${base}/v1/accounts:signUp?key=${STAGING_API_KEY}&key=x`, 'POST'],
    'extra parameter': [`${base}/v1/accounts:signUp?key=${STAGING_API_KEY}&tenantId=x`, 'POST'],
    'admin: project accounts batchDelete': [`${base}/v1/projects/${PROD}/accounts:batchDelete?key=${STAGING_API_KEY}`, 'POST'],
    'lookup (not needed)': [`${base}/v1/accounts:lookup?key=${STAGING_API_KEY}`, 'POST'],
    'update (not needed)': [`${base}/v1/accounts:update?key=${STAGING_API_KEY}`, 'POST'],
    'GET': [`${base}/v1/accounts:signUp?key=${STAGING_API_KEY}`, 'GET'],
    'http': [`http://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${STAGING_API_KEY}`, 'POST'],
    'securetoken (not needed)': [`https://securetoken.googleapis.com/v1/token?key=${STAGING_API_KEY}`, 'POST'],
    'look-alike host': [`https://identitytoolkit.googleapis.com.evil.example/v1/accounts:signUp?key=${STAGING_API_KEY}`, 'POST'],
  };
  for (const [name, [url, method]] of Object.entries(blocked)) {
    await assert.rejects(f(url, { method, body: '{}' }), StagingGuardError, name);
  }
  assert.equal(calls, 0, 'nothing reached the network');
  // the three allowed calls pass (to the spy), and only these
  for (const p of IDENTITY_TOOLKIT_PATHS) await f(`${base}${p}?key=${STAGING_API_KEY}`, { method: 'POST', body: '{}' });
  assert.equal(calls, 3);
  assert.deepEqual([...IDENTITY_TOOLKIT_PATHS].sort(), ['/v1/accounts:delete', '/v1/accounts:signInWithPassword', '/v1/accounts:signUp']);
});

test('AUTH FAILURE: sign-up refused (e.g. e-mail/password disabled) -> clear error without secrets; nothing to clean', async () => {
  for (const [status, code] of [[400, 'OPERATION_NOT_ALLOWED'], [400, 'API_KEY_INVALID'], [403, 'PERMISSION_DENIED'], [429, 'TOO_MANY_ATTEMPTS_TRY_LATER']]) {
    const fake = fakeAuth({ signUpError: [status, code] });
    const users = makeStagingUsers(st, { fetch: guarded(fake), runId: 'fail01', sleep: noSleep });
    await assert.rejects(users.create('a'), (e) => e instanceof StagingAuthError && e.code === code && e.status === status && !secretsIn(e.message, fake), code);
    assert.deepEqual(await users.cleanup(), { deleted: 0, failed: [] });
  }
});

test('expired token at cleanup: signs in again (password kept in memory) and deletes', async () => {
  const fake = fakeAuth({ deleteError: (n) => (n === 1 ? [400, 'INVALID_ID_TOKEN'] : null) });
  const users = makeStagingUsers(st, { fetch: guarded(fake), runId: 'exp001', sleep: noSleep });
  await users.create('a');
  assert.deepEqual(await users.cleanup(), { deleted: 1, failed: [] });
  assert.equal(fake.users.size, 0);
  assert.ok(fake.calls.some((c) => c.path === '/v1/accounts:signInWithPassword'));
});

test('a user already gone counts as deleted', async () => {
  const fake = fakeAuth();
  const users = makeStagingUsers(st, { fetch: guarded(fake), runId: 'gone01', sleep: noSleep });
  const a = await users.create('a');
  fake.users.delete(a.uid); // removed elsewhere
  assert.deepEqual(await users.cleanup(), { deleted: 1, failed: [] });
});

test('CLEANUP FAILURE: retried, then REPORTED by e-mail (no password/token); the run fails; the error of a crashed run is kept', async () => {
  const fake = fakeAuth({ deleteError: () => [500, 'INTERNAL_ERROR'] });
  const users = makeStagingUsers(st, { fetch: guarded(fake), runId: 'clean1', retries: 3, sleep: noSleep });
  await users.create('a');
  await users.create('b');
  const log = [];
  const out = await runWithTestUsers(users, async () => [{ id: 'S40', ok: true }], (l) => log.push(l));
  assert.equal(out.code, 1, 'a test user left behind fails the run');
  assert.equal(out.cleanup.deleted, 0);
  assert.deepEqual(out.cleanup.failed.map((x) => x.email), ['stg-clean1-a-1@example.invalid', 'stg-clean1-b-2@example.invalid']);
  assert.equal(fake.deletes(), 6, '3 attempts per user');
  const text = log.join('\n');
  assert.match(text, /TEST USERS NOT DELETED \(2\)/);
  assert.match(text, /stg-clean1-a-1@example\.invalid/);
  assert.equal(secretsIn(text + JSON.stringify(out), fake), false, 'no password / token in the report');

  // a run that CRASHES still cleans up, and its error is not swallowed
  const fake2 = fakeAuth();
  const users2 = makeStagingUsers(st, { fetch: guarded(fake2), runId: 'crash1', sleep: noSleep });
  await users2.create('a');
  await assert.rejects(runWithTestUsers(users2, async () => { throw new Error('scenario crashed'); }, () => {}), /scenario crashed/);
  assert.equal(fake2.users.size, 0, 'deleted although the run crashed');

  // all good -> code 0; a failed scenario alone -> code 1
  const fake3 = fakeAuth();
  const users3 = makeStagingUsers(st, { fetch: guarded(fake3), runId: 'okrun1', sleep: noSleep });
  await users3.create('a');
  assert.equal((await runWithTestUsers(users3, async () => [{ ok: true }], () => {})).code, 0);
  const users4 = makeStagingUsers(st, { fetch: guarded(fakeAuth()), runId: 'okrun2', sleep: noSleep });
  assert.equal((await runWithTestUsers(users4, async () => [{ ok: false }], () => {})).code, 1);
});

test('DELETION SCOPE: cleanup only deletes the users THIS run created (self-delete with their own token); any other account is untouched', async () => {
  const fake = fakeAuth();
  // an account that exists in the project but was NOT created by this run (e.g. a real tester, another run)
  fake.users.set('otherUidxxxxxxxxxxxxxxxxxxx', { email: 'someone@example.com', password: 'unknown' });
  const users = makeStagingUsers(st, { fetch: guarded(fake), runId: 'scope1', sleep: noSleep });
  const a = await users.create('a');
  const b = await users.create('b');
  const deleteCalls = [];
  const spyFake = { ...fake, fetch: async (input, init) => {
    if (String(input).includes('accounts:delete')) deleteCalls.push(JSON.parse(Buffer.from(String(JSON.parse(init.body).idToken).split('.')[1], 'base64url').toString()).sub);
    return fake.fetch(input, init);
  } };
  const users2 = makeStagingUsers(st, { fetch: guardedFetch(st, spyFake.fetch), runId: 'scope2', sleep: noSleep });
  const c = await users2.create('c');
  assert.deepEqual(await users2.cleanup(), { deleted: 1, failed: [] });
  assert.deepEqual(deleteCalls, [c.uid], 'run 2 deleted only its own user');
  assert.ok(fake.users.has(a.uid) && fake.users.has(b.uid), "run 1's users are not touched by run 2");
  assert.deepEqual(await users.cleanup(), { deleted: 2, failed: [] });
  assert.deepEqual([...fake.users.keys()], ['otherUidxxxxxxxxxxxxxxxxxxx'], 'the other account is still there');
  assert.equal(fake.calls.some((x) => !['/v1/accounts:signUp', '/v1/accounts:signInWithPassword', '/v1/accounts:delete'].includes(x.path)), false, 'no listing / admin endpoint used');
});

test('forged token: token-shaped, claims the staging project, but cannot be a valid Google signature', () => {
  const users = makeStagingUsers(st, { fetch: async () => json(500, {}), runId: 'forge1' });
  const t = users.forged();
  assert.equal(t.split('.').length, 3);
  assert.equal(assertStagingToken(t).aud, 'dairsharaf-staging');
  assert.notEqual(users.forged(), t, 'random each time');
});
