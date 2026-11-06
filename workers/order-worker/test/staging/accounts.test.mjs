// Account checks for staging deploys — LOCAL ONLY. wrangler / firebase are replaced by a fake CLI that answers
// like the real ones (`wrangler whoami --json`, `firebase projects:list --json --account …`); nothing is spawned.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertStagingConfig, assertWranglerFile, StagingGuardError, REPO_ROOT } from '../../staging/guard.mjs';
import { verifyCloudflareAccount, verifyFirebaseAccount, wranglerEnv, firebaseEnv } from '../../staging/accounts.mjs';
import { main as deployWorkersMain } from '../../staging/deploy-workers.mjs';
import { main as deployRulesMain } from '../../staging/deploy-rules.mjs';
import { main as checkAccountsMain } from '../../staging/check-accounts.mjs';
import { main as seedMain } from '../../staging/seed.mjs';
import { main as runTestsMain } from '../../staging/run-tests.mjs';

const PROD = 'antastore1-82b50';
const CF_STAGING = '0123456789abcdef0123456789abcdef';
const CF_OTHER = 'fedcba9876543210fedcba9876543210';
const EMAIL = 'staging-owner@example.com';
const OTHER_EMAIL = 'store-owner@example.com';
const FAKE_KEY = '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n';
let dir;
let good;
let st;
let orderToml;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'staging-accounts-test-'));
  const keyPath = join(dir, 'k.json');
  writeFileSync(keyPath, JSON.stringify({ type: 'service_account', project_id: 'dairsharaf-staging', client_email: 'w@dairsharaf-staging.iam.gserviceaccount.com', private_key: FAKE_KEY }));
  good = {
    projectId: 'dairsharaf-staging',
    cloudflareAccountId: CF_STAGING,
    cloudflareLoginEmail: EMAIL,
    firebaseAccountEmail: EMAIL,
    workerUrl: 'https://anta-order-notify-staging.acme.workers.dev',
    sinkUrl: 'https://anta-notify-sink-staging.acme.workers.dev',
    serviceAccountKeyPath: keyPath,
    firebaseWebConfig: { apiKey: 'staging-fake', authDomain: 'dairsharaf-staging.firebaseapp.com', projectId: 'dairsharaf-staging', appId: '1:0:web:s' },
  };
  st = assertStagingConfig(good, { env: {} });
  orderToml = join(dir, 'order.toml');
  // the COMMITTED file (git HEAD): a locally filled-in working copy must not change these tests
  const committed = execFileSync('git', ['show', 'HEAD:workers/order-worker/wrangler.staging.toml'], { cwd: REPO_ROOT, encoding: 'utf8' });
  writeFileSync(orderToml, committed.replaceAll('REPLACE_WITH_WORKERS_SUBDOMAIN', 'acme'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Fake CLI. cf: whoami JSON (null = not logged in). fb: Firebase accounts logged in to firebase-tools,
 * { email: [projectIds] }; fbDefault = the CLI's default account (used when --account is NOT passed).
 */
function fakeCli({ cf = { loggedIn: true, authType: 'OAuth Token', email: EMAIL, accounts: [{ id: CF_STAGING, name: 'Staging' }] },
  fb = { [EMAIL]: ['dairsharaf-staging'] }, fbDefault = OTHER_EMAIL, fbDefaultProjects = [PROD], deployStatus = 0 } = {}) {
  const s = (cmd, args, opts = {}) => {
    s.calls.push({ cmd, args: [...args], env: opts.env });
    if (args.includes('whoami')) {
      return cf ? { status: 0, stdout: JSON.stringify(cf) } : { status: 1, stdout: JSON.stringify({ loggedIn: false }) };
    }
    if (args[0] === 'projects:list') {
      const i = args.indexOf('--account');
      const who = i >= 0 ? args[i + 1] : fbDefault;
      const list = i >= 0 ? fb[who] : fbDefaultProjects;
      if (!list) return { status: 1, stdout: JSON.stringify({ status: 'error', error: `Account ${who} not found` }) };
      return { status: 0, stdout: `${JSON.stringify({ status: 'success', result: list.map((projectId) => ({ projectId })) })}\n` };
    }
    return { status: deployStatus };
  };
  s.calls = [];
  s.deploys = () => s.calls.filter((c) => c.args.includes('deploy') && !c.args.includes('--dry-run'));
  return s;
}
const refused = (fn, re) => assert.throws(fn, (e) => e instanceof StagingGuardError && (!re || re.test(e.message)));

// ------------------------------------------------------------------ config: missing / malformed account values
test('config: every missing or malformed account value stops the script (no default account)', () => {
  const bad = {
    'cloudflareAccountId missing': { cloudflareAccountId: undefined },
    'cloudflareAccountId placeholder': { cloudflareAccountId: 'REPLACE_WITH_STAGING_CLOUDFLARE_ACCOUNT_ID' },
    'cloudflareAccountId too short': { cloudflareAccountId: CF_STAGING.slice(1) },
    'cloudflareAccountId upper/other chars': { cloudflareAccountId: CF_STAGING.toUpperCase().replace('A', 'Z') },
    'cloudflareLoginEmail missing': { cloudflareLoginEmail: '' },
    'firebaseAccountEmail missing': { firebaseAccountEmail: undefined },
    'firebaseAccountEmail placeholder': { firebaseAccountEmail: 'REPLACE_WITH_STAGING_EMAIL' },
    'firebaseAccountEmail with shell characters': { firebaseAccountEmail: 'a@b.com & firebase deploy' },
    'firebaseAccountEmail with quotes': { firebaseAccountEmail: '"a"@b.com' },
  };
  for (const [name, patch] of Object.entries(bad)) {
    assert.throws(() => assertStagingConfig({ ...good, ...patch }, { env: {} }), StagingGuardError, name);
  }
});

test('every staging script refuses a config without account values BEFORE any spawn or request', async () => {
  const noAccounts = { ...good };
  delete noAccounts.cloudflareAccountId;
  delete noAccounts.firebaseAccountEmail;
  const cli = fakeCli();
  const fetchCalls = [];
  const realFetch = async () => { fetchCalls.push(1); return new Response('{}'); };
  const env = { STAGING_SINK_READ_TOKEN: 'r'.repeat(32), STAGING_WORKER_AUTH_TOKEN: 'w'.repeat(32), STAGING_ACCESS_TOKEN: 'g'.repeat(32) };
  const deps = { config: noAccounts, env, spawn: cli, tomlOverride: orderToml, realFetch };
  await assert.rejects(deployWorkersMain(['--which', 'order', '--execute', '--confirm', 'anta-order-notify-staging'], deps), /cloudflareAccountId/);
  await assert.rejects(deployRulesMain(['--rules', 'final', '--execute', '--confirm', 'dairsharaf-staging'], deps), /firebaseAccountEmail/);
  await assert.rejects(checkAccountsMain(['--cloudflare', '--firebase'], deps), StagingGuardError);
  await assert.rejects(seedMain([], deps), StagingGuardError);
  await assert.rejects(runTestsMain([], deps), StagingGuardError);
  assert.equal(cli.calls.length, 0);
  assert.equal(fetchCalls.length, 0);
});

// ------------------------------------------------------------------ Cloudflare
test('Cloudflare: correct single staging account passes; account id pinned in the env', () => {
  const cli = fakeCli();
  const r = verifyCloudflareAccount(st, { env: {}, spawn: cli });
  assert.equal(r.accountId, CF_STAGING);
  assert.equal(cli.calls[0].env.CLOUDFLARE_ACCOUNT_ID, CF_STAGING);
  assert.deepEqual(cli.calls[0].args.slice(1), ['whoami', '--json']);
});

test('Cloudflare: not logged in -> refused', () => {
  refused(() => verifyCloudflareAccount(st, { env: {}, spawn: fakeCli({ cf: null }) }), /not logged in/);
  refused(() => verifyCloudflareAccount(st, { env: {}, spawn: () => ({ status: 0, stdout: 'garbage' }) }), /not logged in/);
});

test('Cloudflare: WRONG account (e.g. the store account) -> refused', () => {
  const cli = fakeCli({ cf: { loggedIn: true, email: OTHER_EMAIL, accounts: [{ id: CF_OTHER, name: 'Store' }] } });
  refused(() => verifyCloudflareAccount(st, { env: {}, spawn: cli }), /not for the configured staging account/);
});

test('Cloudflare: right account id but different login e-mail -> refused', () => {
  const cli = fakeCli({ cf: { loggedIn: true, email: OTHER_EMAIL, accounts: [{ id: CF_STAGING, name: 'Staging' }] } });
  refused(() => verifyCloudflareAccount(st, { env: {}, spawn: cli }), /e-mail differs/);
  const noEmail = fakeCli({ cf: { loggedIn: true, authType: 'Account API Token', accounts: [{ id: CF_STAGING, name: 'Staging' }] } });
  refused(() => verifyCloudflareAccount(st, { env: {}, spawn: noEmail }), /e-mail not reported/);
});

test('Cloudflare: MULTIPLE accounts on the same credentials (staging + store) -> refused even though staging is among them', () => {
  const cli = fakeCli({ cf: { loggedIn: true, email: EMAIL, accounts: [{ id: CF_STAGING, name: 'Staging' }, { id: CF_OTHER, name: 'Store' }] } });
  refused(() => verifyCloudflareAccount(st, { env: {}, spawn: cli }), /2 account\(s\)/);
  const none = fakeCli({ cf: { loggedIn: true, email: EMAIL, accounts: [] } });
  refused(() => verifyCloudflareAccount(st, { env: {}, spawn: none }), /0 account\(s\)/);
});

test('Cloudflare: environment pointing to another account or using a Global API Key -> refused before spawning', () => {
  for (const env of [{ CLOUDFLARE_ACCOUNT_ID: CF_OTHER }, { CF_ACCOUNT_ID: CF_OTHER }, { CLOUDFLARE_API_KEY: 'k', CLOUDFLARE_EMAIL: OTHER_EMAIL }, { CF_API_KEY: 'k' }]) {
    const cli = fakeCli();
    refused(() => verifyCloudflareAccount(st, { env, spawn: cli }));
    assert.equal(cli.calls.length, 0, JSON.stringify(Object.keys(env)));
  }
  assert.equal(wranglerEnv(st, { CLOUDFLARE_ACCOUNT_ID: CF_STAGING }).CLOUDFLARE_ACCOUNT_ID, CF_STAGING, 'same id is fine');
});

test('wrangler file: account_id of another account refused; none or the same allowed', () => {
  const base = readFileSync(orderToml, 'utf8');
  const opts = { expectName: 'anta-order-notify-staging', expectTarget: 'staging', projectId: st.projectId, sinkHost: st.sinkHost, accountId: CF_STAGING };
  const at = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };
  assertWranglerFile(at('a0.toml', base), opts);
  assertWranglerFile(at('a1.toml', `account_id = "${CF_STAGING}"\n${base}`), opts);
  refused(() => assertWranglerFile(at('a2.toml', `account_id = "${CF_OTHER}"\n${base}`), opts), /account_id/);
});

test('deploy-workers: every wrong-account case stops BEFORE the real deploy; dry-run never needs a login', async () => {
  const cases = {
    'not logged in': { cf: null },
    'store account': { cf: { loggedIn: true, email: OTHER_EMAIL, accounts: [{ id: CF_OTHER, name: 'Store' }] } },
    'two accounts': { cf: { loggedIn: true, email: EMAIL, accounts: [{ id: CF_STAGING }, { id: CF_OTHER }] } },
    'other e-mail': { cf: { loggedIn: true, email: OTHER_EMAIL, accounts: [{ id: CF_STAGING }] } },
  };
  for (const [name, o] of Object.entries(cases)) {
    const cli = fakeCli(o);
    await assert.rejects(deployWorkersMain(['--which', 'order', '--execute', '--confirm', 'anta-order-notify-staging'], { config: good, env: {}, spawn: cli, tomlOverride: orderToml }), StagingGuardError, name);
    assert.equal(cli.deploys().length, 0, `${name}: no real deploy`);
    for (const c of cli.calls) assert.equal(c.env.CLOUDFLARE_ACCOUNT_ID, CF_STAGING, `${name}: every wrangler call pinned`);
  }
  // dry-run (no --execute) does not call whoami at all
  const dryOnly = fakeCli({ cf: null });
  assert.equal(await deployWorkersMain(['--which', 'order'], { config: good, env: {}, spawn: dryOnly, tomlOverride: orderToml }), 0);
  assert.equal(dryOnly.calls.length, 1);
  // happy path: dry-run -> whoami -> deploy, all pinned
  const ok = fakeCli();
  assert.equal(await deployWorkersMain(['--which', 'order', '--execute', '--confirm', 'anta-order-notify-staging'], { config: good, env: {}, spawn: ok, tomlOverride: orderToml }), 0);
  assert.deepEqual(ok.calls.map((c) => (c.args.includes('--dry-run') ? 'dry-run' : c.args.includes('whoami') ? 'whoami' : 'deploy')), ['dry-run', 'whoami', 'deploy']);
  assert.ok(ok.calls.every((c) => c.env.CLOUDFLARE_ACCOUNT_ID === CF_STAGING));
});

test('deploy-workers: output never shows a Cloudflare account id, login e-mail or key — on success AND on every refusal', async () => {
  const SECRETS = [CF_STAGING, CF_OTHER, EMAIL, OTHER_EMAIL, 'BEGIN PRIVATE KEY', FAKE_KEY.trim()];
  const run = async (argv, deps) => {
    const out = [];
    const orig = { log: console.log, error: console.error, warn: console.warn };
    console.log = console.error = console.warn = (...a) => out.push(a.join(' '));
    let result;
    try {
      result = await deployWorkersMain(argv, { config: good, env: {}, tomlOverride: orderToml, ...deps });
    } catch (e) {
      out.push(e.message); // what runCli prints for a refusal / error
      result = e;
    } finally {
      Object.assign(console, orig);
    }
    return { result, text: out.join('\n') };
  };
  const EXEC = ['--which', 'order', '--execute', '--confirm', 'anta-order-notify-staging'];
  const cases = {
    'dry-run only': [['--which', 'order'], { spawn: fakeCli() }, 0],
    'deploy OK': [EXEC, { spawn: fakeCli() }, 0],
    'wrong --confirm': [['--which', 'order', '--execute', '--confirm', 'anta-order-notify'], { spawn: fakeCli() }, StagingGuardError],
    'not logged in': [EXEC, { spawn: fakeCli({ cf: null }) }, StagingGuardError],
    'store account': [EXEC, { spawn: fakeCli({ cf: { loggedIn: true, email: OTHER_EMAIL, accounts: [{ id: CF_OTHER, name: 'Store' }] } }) }, StagingGuardError],
    'two accounts': [EXEC, { spawn: fakeCli({ cf: { loggedIn: true, email: EMAIL, accounts: [{ id: CF_STAGING }, { id: CF_OTHER }] } }) }, StagingGuardError],
    'other e-mail': [EXEC, { spawn: fakeCli({ cf: { loggedIn: true, email: OTHER_EMAIL, accounts: [{ id: CF_STAGING }] } }) }, StagingGuardError],
    'env points to another account': [EXEC, { spawn: fakeCli(), env: { CLOUDFLARE_ACCOUNT_ID: CF_OTHER } }, StagingGuardError],
    'dry-run fails': [EXEC, { spawn: fakeCli({ deployStatus: 1 }) }, Error],
    'production project config': [EXEC, { spawn: fakeCli(), config: { ...good, projectId: PROD } }, StagingGuardError],
    'wrangler file of another account': [EXEC, { spawn: fakeCli(), tomlOverride: (() => { const p = join(dir, 'acct.toml'); writeFileSync(p, `account_id = "${CF_OTHER}"\n${readFileSync(orderToml, 'utf8')}`); return p; })() }, StagingGuardError],
  };
  for (const [name, [argv, deps, expected]] of Object.entries(cases)) {
    const { result, text } = await run(argv, deps);
    if (expected === 0) assert.equal(result, 0, name);
    else assert.ok(result instanceof expected, `${name}: refused (${result?.message ?? result})`);
    assert.ok(text.length > 0, `${name}: something was reported`);
    for (const s of SECRETS) assert.equal(text.includes(s), false, `${name}: output must not contain account data / keys`); // value never printed
    for (const c of deps.spawn.calls) assert.notEqual(c.env?.CLOUDFLARE_ACCOUNT_ID, CF_OTHER, `${name}: never pinned to another account`);
    if (expected !== 0) assert.equal(deps.spawn.deploys().length, 0, `${name}: no real deploy`);
  }
});

// ------------------------------------------------------------------ Firebase
test('Firebase: staging account with --account passes; FIREBASE_TOKEN and project overrides stripped', () => {
  const cli = fakeCli();
  verifyFirebaseAccount(st, { env: { GOOGLE_APPLICATION_CREDENTIALS: 'x', GCLOUD_PROJECT: PROD, CLOUDSDK_CORE_ACCOUNT: OTHER_EMAIL }, spawn: cli });
  const c = cli.calls[0];
  assert.deepEqual(c.args, ['projects:list', '--json', '--account', EMAIL]);
  for (const v of ['GOOGLE_APPLICATION_CREDENTIALS', 'GCLOUD_PROJECT', 'CLOUDSDK_CORE_ACCOUNT', 'FIREBASE_TOKEN']) assert.equal(c.env[v], undefined, v);
  assert.equal(firebaseEnv({ PATH: 'p' }).PATH, 'p');
});

test('Firebase: FIREBASE_TOKEN set (would override --account) -> refused before spawning', async () => {
  const cli = fakeCli();
  refused(() => verifyFirebaseAccount(st, { env: { FIREBASE_TOKEN: 't' }, spawn: cli }), /FIREBASE_TOKEN/);
  await assert.rejects(deployRulesMain(['--rules', 'final', '--execute', '--confirm', 'dairsharaf-staging'], { config: good, env: { FIREBASE_TOKEN: 't' }, spawn: cli }), /FIREBASE_TOKEN/);
  assert.equal(cli.calls.length, 0);
});

test('Firebase: staging account NOT logged in (only the store account is) -> refused, never falls back to the default', () => {
  const cli = fakeCli({ fb: { [OTHER_EMAIL]: [PROD] } });
  refused(() => verifyFirebaseAccount(st, { env: {}, spawn: cli }), /not logged in/);
});

test('Firebase: WRONG account configured (it sees production) -> refused', () => {
  const cli = fakeCli({ fb: { [EMAIL]: ['dairsharaf-staging', PROD] } });
  refused(() => verifyFirebaseAccount(st, { env: {}, spawn: cli }), /PRODUCTION/);
});

test('Firebase: account that cannot see the staging project -> refused', () => {
  const cli = fakeCli({ fb: { [EMAIL]: ['some-other-project'] } });
  refused(() => verifyFirebaseAccount(st, { env: {}, spawn: cli }), /cannot see project dairsharaf-staging/);
});

test('Firebase: MULTIPLE accounts logged in (store account is the CLI default) -> only the staging account is used', async () => {
  // Without --account the fake CLI would answer as the store account (sees production) and the check would refuse.
  const cli = fakeCli({ fb: { [EMAIL]: ['dairsharaf-staging'], [OTHER_EMAIL]: [PROD] }, fbDefault: OTHER_EMAIL, fbDefaultProjects: [PROD] });
  assert.equal(await deployRulesMain(['--rules', 'final', '--execute', '--confirm', 'dairsharaf-staging'], { config: good, env: {}, spawn: cli }), 0);
  assert.equal(cli.calls.length, 2);
  for (const c of cli.calls) {
    const i = c.args.indexOf('--account');
    assert.ok(i >= 0 && c.args[i + 1] === EMAIL, `--account ${EMAIL} on: ${c.args.join(' ')}`);
    assert.equal(c.args.includes(PROD), false);
  }
  const deploy = cli.calls[1].args;
  assert.equal(deploy[deploy.indexOf('--project') + 1], 'dairsharaf-staging');
});

test('deploy-rules: every wrong-account case stops BEFORE the deploy; plan mode spawns nothing', async () => {
  const cases = {
    'not logged in': { fb: {} },
    'account sees production': { fb: { [EMAIL]: ['dairsharaf-staging', PROD] } },
    'account lacks staging': { fb: { [EMAIL]: [] } },
  };
  for (const [name, o] of Object.entries(cases)) {
    const cli = fakeCli(o);
    await assert.rejects(deployRulesMain(['--rules', 'final', '--execute', '--confirm', 'dairsharaf-staging'], { config: good, env: {}, spawn: cli }), StagingGuardError, name);
    assert.equal(cli.deploys().length, 0, name);
  }
  const plan = fakeCli();
  assert.equal(await deployRulesMain(['--rules', 'final'], { config: good, env: {}, spawn: plan }), 0);
  assert.equal(plan.calls.length, 0);
});

// ------------------------------------------------------------------ check-accounts (read-only helper)
test('check-accounts: needs an explicit choice; reports OK / refuses like the deploy scripts', async () => {
  await assert.rejects(checkAccountsMain([], { config: good, env: {}, spawn: fakeCli() }), /--cloudflare and\/or --firebase/);
  assert.equal(await checkAccountsMain(['--cloudflare', '--firebase'], { config: good, env: {}, spawn: fakeCli() }), 0);
  await assert.rejects(checkAccountsMain(['--cloudflare'], { config: good, env: {}, spawn: fakeCli({ cf: { loggedIn: true, email: EMAIL, accounts: [{ id: CF_STAGING }, { id: CF_OTHER }] } }) }), StagingGuardError);
  const cli = fakeCli();
  await checkAccountsMain(['--cloudflare', '--firebase'], { config: good, env: {}, spawn: cli });
  assert.equal(cli.deploys().length, 0, 'read-only');
});
