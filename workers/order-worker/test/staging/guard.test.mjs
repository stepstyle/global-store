// Staging script guards — LOCAL ONLY. Fake keys live in the OS temp dir (outside the repo).
// Network and process spawning are replaced by spies: every refusal must happen before them.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import {
  assertStagingConfig, assertWranglerFile, guardedFetch, productionWebIdentifiers, StagingGuardError, REPO_ROOT,
} from '../../staging/guard.mjs';
import { main as seedMain } from '../../staging/seed.mjs';
import { main as runTestsMain } from '../../staging/run-tests.mjs';
import { main as deployRulesMain } from '../../staging/deploy-rules.mjs';
import { main as deployWorkersMain, TARGETS, planWorkerDeploy } from '../../staging/deploy-workers.mjs';

const PROD = 'antastore1-82b50';
const FAKE_KEY = '-----BEGIN PRIVATE KEY-----\nFAKEFAKEFAKE\n-----END PRIVATE KEY-----\n';
let dir;
let keyPath;
let prodKeyPath;
let good;
const TOKENS = { STAGING_SINK_READ_TOKEN: 'r'.repeat(32), STAGING_WORKER_AUTH_TOKEN: 'w'.repeat(32), STAGING_ACCESS_TOKEN: 'g'.repeat(32) };
const STAGING_CF = '0123456789abcdef0123456789abcdef';
const STAGING_EMAIL = 'staging-owner@example.com';
// Answers the read-only account queries as a correctly logged-in staging setup would; records every call.
const cliSpy = (status = 0) => {
  const s = (cmd, args) => {
    s.calls.push([cmd, ...args]);
    if (args.includes('whoami')) return { status: 0, stdout: JSON.stringify({ loggedIn: true, authType: 'OAuth Token', email: STAGING_EMAIL, accounts: [{ id: STAGING_CF, name: 'staging' }] }) };
    if (args[0] === 'projects:list') return { status: 0, stdout: JSON.stringify({ status: 'success', result: [{ projectId: 'dairsharaf-staging' }] }) };
    return { status };
  };
  s.calls = [];
  return s;
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'staging-guard-test-'));
  keyPath = join(dir, 'staging-key.json');
  prodKeyPath = join(dir, 'prod-like-key.json');
  writeFileSync(keyPath, JSON.stringify({ type: 'service_account', project_id: 'dairsharaf-staging', client_email: 'order-worker-staging@dairsharaf-staging.iam.gserviceaccount.com', private_key: FAKE_KEY }));
  writeFileSync(prodKeyPath, JSON.stringify({ type: 'service_account', project_id: PROD, client_email: `x@${PROD}.iam.gserviceaccount.com`, private_key: FAKE_KEY }));
  good = {
    projectId: 'dairsharaf-staging',
    workerUrl: 'https://anta-order-notify-staging.acme.workers.dev',
    sinkUrl: 'https://anta-notify-sink-staging.acme.workers.dev',
    serviceAccountKeyPath: keyPath,
    firebaseWebConfig: { apiKey: 'staging-fake-api-key', authDomain: 'dairsharaf-staging.firebaseapp.com', projectId: 'dairsharaf-staging', appId: '1:000:web:staging' },
    cloudflareAccountId: STAGING_CF,
    cloudflareLoginEmail: STAGING_EMAIL,
    firebaseAccountEmail: STAGING_EMAIL,
  };
});
after(() => rmSync(dir, { recursive: true, force: true }));

const refuses = (cfg, opts = {}) => assert.throws(() => assertStagingConfig(cfg, { env: {}, ...opts }), StagingGuardError);
const fetchSpy = () => {
  const s = async () => {
    s.calls += 1;
    return new Response('{}');
  };
  s.calls = 0;
  return s;
};
const spawnSpy = (status = 0) => {
  const s = (cmd, args) => {
    s.calls.push([cmd, ...args]);
    return { status };
  };
  s.calls = [];
  return s;
};

// ---------------------------------------------------------------------------
test('valid staging config passes', () => {
  const st = assertStagingConfig(good, { env: TOKENS, requireTokens: true });
  assert.equal(st.projectId, 'dairsharaf-staging');
  assert.equal(st.workerHost, 'anta-order-notify-staging.acme.workers.dev');
});

test('production web identifiers are read from the local app source (no network)', () => {
  const ids = productionWebIdentifiers();
  assert.ok(ids.includes(PROD));
  assert.ok(ids.length >= 3, 'apiKey/appId/senderId found in src/services/firebase.ts');
});

const badConfigs = {
  'project = production': (c) => ({ ...c, projectId: PROD }),
  'production id hidden in another field': (c) => ({ ...c, note: `copy of ${PROD}` }),
  'demo- project': (c) => ({ ...c, projectId: 'demo-dairsharaf-staging' }),
  'project without -staging': (c) => ({ ...c, projectId: 'dairsharaf-test' }),
  'worker = production Worker': (c) => ({ ...c, workerUrl: 'https://anta-order-notify.acme.workers.dev' }),
  'worker lookalike domain': (c) => ({ ...c, workerUrl: 'https://anta-order-notify-staging.acme.workers.dev.evil.com' }),
  'worker on other domain': (c) => ({ ...c, workerUrl: 'https://anta-order-notify-staging.evil.com' }),
  'worker over http': (c) => ({ ...c, workerUrl: 'http://anta-order-notify-staging.acme.workers.dev' }),
  'worker with credentials': (c) => ({ ...c, workerUrl: 'https://u:p@anta-order-notify-staging.acme.workers.dev' }),
  'worker with path': (c) => ({ ...c, workerUrl: 'https://anta-order-notify-staging.acme.workers.dev/create-order' }),
  'worker = production site': (c) => ({ ...c, workerUrl: 'https://dairsharaf.com' }),
  'sink on another subdomain': (c) => ({ ...c, sinkUrl: 'https://anta-notify-sink-staging.other.workers.dev' }),
  'sink = Telegram': (c) => ({ ...c, sinkUrl: 'https://api.telegram.org' }),
  'web config of another project': (c) => ({ ...c, firebaseWebConfig: { ...c.firebaseWebConfig, projectId: 'x-staging' } }),
  'web authDomain = production custom domain': (c) => ({ ...c, firebaseWebConfig: { ...c.firebaseWebConfig, authDomain: 'auth.dairsharaf.com' } }),
  'key path relative': (c) => ({ ...c, serviceAccountKeyPath: 'key.json' }),
  'key inside the repository': (c) => ({ ...c, serviceAccountKeyPath: resolve(REPO_ROOT, 'workers/order-worker/staging/key.json') }),
  'key file missing': (c) => ({ ...c, serviceAccountKeyPath: join(dir, 'missing.json') }),
  'key of the production project': (c) => ({ ...c, serviceAccountKeyPath: prodKeyPath }),
};
for (const [name, mutate] of Object.entries(badConfigs)) {
  test(`refuses: ${name}`, () => refuses(mutate(good)));
}

test('refuses: staging web config reusing the PRODUCTION apiKey / appId (from src/services/firebase.ts)', () => {
  const src = readFileSync(resolve(REPO_ROOT, 'src/services/firebase.ts'), 'utf8');
  const prodApiKey = src.match(/apiKey:\s*['"]([^'"]+)['"]/)[1];
  const prodAppId = src.match(/appId:\s*['"]([^'"]+)['"]/)[1];
  refuses({ ...good, firebaseWebConfig: { ...good.firebaseWebConfig, apiKey: prodApiKey } });
  refuses({ ...good, firebaseWebConfig: { ...good.firebaseWebConfig, appId: prodAppId } });
});

test('refuses: ambient credentials / project variables pointing elsewhere', () => {
  refuses(good, { env: { GOOGLE_APPLICATION_CREDENTIALS: prodKeyPath } });
  refuses(good, { env: { GCLOUD_PROJECT: PROD } });
  refuses(good, { env: { GOOGLE_CLOUD_PROJECT: PROD } });
  refuses(good, { env: { FIREBASE_PROJECT_ID: PROD } });
  refuses(good, { env: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8086' } });
});

test('refuses: missing / short test tokens when the script needs them', () => {
  refuses(good, { env: {}, requireTokens: true });
  refuses(good, { env: { STAGING_SINK_READ_TOKEN: 'short', STAGING_WORKER_AUTH_TOKEN: 'w'.repeat(32) }, requireTokens: true });
  // the order Worker's access gate secret: required, >= 32 characters (same minimum as the Worker)
  refuses(good, { env: { STAGING_SINK_READ_TOKEN: 'r'.repeat(32), STAGING_WORKER_AUTH_TOKEN: 'w'.repeat(32) }, requireTokens: true });
  refuses(good, { env: { ...TOKENS, STAGING_ACCESS_TOKEN: 'g'.repeat(31) }, requireTokens: true });
});

test('guardedFetch: x-staging-access goes to the ORDER Worker only, never to the sink / Google; caller value kept', async () => {
  const st = assertStagingConfig(good, { env: {} });
  const seen = [];
  const spy = async (input, init) => { seen.push([String(typeof input === 'string' ? input : input.url), new Headers(init?.headers).get('x-staging-access')]); return new Response('{}'); };
  const SECRET = 'g'.repeat(32);
  const f = guardedFetch(st, spy, { stagingAccessToken: SECRET });
  await f('https://anta-order-notify-staging.acme.workers.dev/create-order', { method: 'POST', headers: { 'content-type': 'application/json' } });
  await f('https://anta-order-notify-staging.acme.workers.dev/orders/x/status');
  await f('https://anta-notify-sink-staging.acme.workers.dev/calls', { headers: { 'x-sink-auth': 'r'.repeat(32) } });
  await f('https://firestore.googleapis.com/v1/projects/dairsharaf-staging/databases/(default)/documents/products/x');
  await f('https://oauth2.googleapis.com/token');
  await f('https://anta-order-notify-staging.acme.workers.dev/create-order', { headers: { 'x-staging-access': '' } }); // gate test: "missing"
  assert.deepEqual(seen.map((x) => x[1]), [SECRET, SECRET, null, null, null, '']);
  // without a configured token nothing is added (scripts that never call the Worker: seed, deploy)
  const plain = guardedFetch(st, spy);
  await plain('https://anta-order-notify-staging.acme.workers.dev/');
  assert.equal(seen.at(-1)[1], null);
});

// ---------------------------------------------------------------------------
test('guardedFetch: staging paths allowed; production / foreign targets blocked BEFORE the request', async () => {
  const st = assertStagingConfig(good, { env: {} });
  const spy = fetchSpy();
  const f = guardedFetch(st, spy);
  await f('https://anta-order-notify-staging.acme.workers.dev/create-order');
  await f('https://anta-notify-sink-staging.acme.workers.dev/calls');
  await f('https://firestore.googleapis.com/v1/projects/dairsharaf-staging/databases/(default)/documents/products/x');
  await f('https://oauth2.googleapis.com/token');
  assert.equal(spy.calls, 4);

  const blocked = [
    `https://firestore.googleapis.com/v1/projects/${PROD}/databases/(default)/documents/orders/x`,
    'https://firestore.googleapis.com/v1/projects/other-staging/databases/(default)/documents/x',
    `https://oauth2.googleapis.com/token?project=${PROD}`,
    'https://anta-order-notify.acme.workers.dev/create-order',
    'https://api.telegram.org/botX/sendMessage',
    'https://api.sendgrid.com/v3/mail/send',
    'https://dairsharaf.com/',
    'http://anta-order-notify-staging.acme.workers.dev/',
    'https://anta-order-notify-staging.acme.workers.dev.evil.com/',
  ];
  for (const u of blocked) await assert.rejects(f(u), StagingGuardError, u);
  assert.equal(spy.calls, 4, 'no blocked request reached the network');
});

// ---------------------------------------------------------------------------
// The COMMITTED version (git index = what is / will be committed) of a staging wrangler file. The working copy may be filled in locally
// (KV namespace id, workers.dev subdomain) and must not change what these tests check about the repository.
const committedText = (abs) => {
  const rel = relative(REPO_ROOT, abs).split(sep).join('/');
  return execFileSync('git', ['show', `:${rel}`], { cwd: REPO_ROOT, encoding: 'utf8' });
};
const writeTmp = (name, text) => {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
};

test('wrangler files: committed staging files (git HEAD) still contain placeholders -> refused', () => {
  const st = assertStagingConfig(good, { env: {} });
  assert.throws(() => assertWranglerFile(writeTmp('head-order.toml', committedText(TARGETS.order.toml)), { expectName: 'anta-order-notify-staging', expectTarget: 'staging', projectId: st.projectId, sinkHost: st.sinkHost }), /REPLACE_WITH_/);
  assert.throws(() => assertWranglerFile(writeTmp('head-sink.toml', committedText(TARGETS.sink.toml)), { expectName: 'anta-notify-sink-staging' }), /REPLACE_WITH_/);
});

test('wrangler files: the LOCAL working copies are safe (filled in or not): only an unfilled placeholder may be reported', () => {
  const onlyPlaceholders = (fn, label) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof StagingGuardError, `${label}: ${e.message}`);
      assert.deepEqual(e.problems.filter((p) => !/REPLACE_WITH_/.test(p)), [], label);
    }
  };
  // sink: name, no production project / site / account / [env.*]; KV binding present, id unfilled or 32 hex
  const sink = readFileSync(TARGETS.sink.toml, 'utf8');
  onlyPlaceholders(() => assertWranglerFile(TARGETS.sink.toml, { expectName: 'anta-notify-sink-staging' }), 'sink');
  const sinkCode = sink.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  // assert.ok (not assert.match): a failure must never print the file, which may hold the real KV id
  assert.ok(/^binding = "SINK_KV"\r?$/m.test(sinkCode), 'sink: binding = "SINK_KV"');
  assert.ok(/^SINK_ENVIRONMENT = "staging"\r?$/m.test(sinkCode), 'sink: SINK_ENVIRONMENT = "staging"');
  assert.equal(/^\s*(routes?|zone_id|zone_name|custom_domain)\s*=|^\s*\[\[?routes?\]/m.test(sinkCode), false, 'sink: no route / zone / custom domain');
  const ids = [...sinkCode.matchAll(/^\s*id\s*=\s*"([^"]*)"/gm)].map((m) => m[1]);
  assert.equal(ids.length, 1, 'sink: exactly one KV id');
  assert.ok(ids[0] === 'REPLACE_WITH_KV_NAMESPACE_ID' || /^[0-9a-f]{32}$/.test(ids[0]), 'sink: KV id is the placeholder or 32 hex characters'); // never printed
  // order: same guard; the notification bases must be the staging sink on ONE workers.dev subdomain
  const order = readFileSync(TARGETS.order.toml, 'utf8');
  const base = (k) => (order.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]+)"`, 'm')) || [])[1] ?? '';
  const sinkHost = new URL(base('TELEGRAM_API_BASE')).hostname;
  assert.match(sinkHost, /^anta-notify-sink-staging\.[a-z0-9_-]+\.workers\.dev$/i, 'order: Telegram base is the staging sink');
  assert.equal(new URL(base('SENDGRID_API_BASE')).hostname, sinkHost, 'order: SendGrid base is the same sink');
  const st = assertStagingConfig(good, { env: {} });
  onlyPlaceholders(() => assertWranglerFile(TARGETS.order.toml, { expectName: 'anta-order-notify-staging', expectTarget: 'staging', projectId: st.projectId, sinkHost }), 'order');
});

const filledOrderToml = () => committedText(TARGETS.order.toml).replaceAll('REPLACE_WITH_WORKERS_SUBDOMAIN', 'acme');

test('wrangler files: filled staging file passes; every tampering is refused', () => {
  const st = assertStagingConfig(good, { env: {} });
  const opts = { expectName: 'anta-order-notify-staging', expectTarget: 'staging', projectId: st.projectId, sinkHost: st.sinkHost };
  assert.deepEqual(assertWranglerFile(writeTmp('ok.toml', filledOrderToml()), opts), { name: 'anta-order-notify-staging' });

  const tamper = {
    'production Worker name': (t) => t.replace('name = "anta-order-notify-staging"', 'name = "anta-order-notify"'),
    'production build target': (t) => t.replace(`__DEPLOY_TARGET__ = "'staging'"`, `__DEPLOY_TARGET__ = "'production'"`),
    'production project var': (t) => t.replace('FIREBASE_PROJECT_ID = "dairsharaf-staging"', `FIREBASE_PROJECT_ID = "${PROD}"`),
    '[env.production] section': (t) => `${t}\n[env.production]\nname = "anta-order-notify"\n`,
    'Telegram not to sink': (t) => t.replace('https://anta-notify-sink-staging.acme.workers.dev/telegram', 'https://api.telegram.org'),
    'sink on other subdomain': (t) => t.replaceAll('anta-notify-sink-staging.acme.workers.dev', 'anta-notify-sink-staging.zzz.workers.dev'),
    'production site origin': (t) => t.replace('ALLOWED_ORIGINS = "http://127.0.0.1:3000"', 'ALLOWED_ORIGINS = "https://dairsharaf.com"'),
  };
  for (const [name, f] of Object.entries(tamper)) {
    assert.throws(() => assertWranglerFile(writeTmp(`bad-${name.replace(/\W+/g, '_')}.toml`, f(filledOrderToml())), opts), StagingGuardError, name);
  }
});

// ---------------------------------------------------------------------------
test('every staging script refuses a production-pointing config before ANY request or spawn', async () => {
  const original = globalThis.fetch;
  const spy = fetchSpy();
  const spawn = spawnSpy();
  globalThis.fetch = spy;
  try {
    const prodCfg = { ...good, projectId: PROD, firebaseWebConfig: { ...good.firebaseWebConfig, projectId: PROD, authDomain: `${PROD}.firebaseapp.com` } };
    const deps = { config: prodCfg, env: TOKENS, realFetch: spy, spawn };
    await assert.rejects(seedMain([], deps), StagingGuardError);
    await assert.rejects(runTestsMain([], deps), StagingGuardError);
    await assert.rejects(deployRulesMain(['--execute', '--confirm', PROD], deps), StagingGuardError);
    await assert.rejects(deployWorkersMain(['--which', 'order', '--execute', '--confirm', 'anta-order-notify'], deps), StagingGuardError);
    await assert.rejects(runTestsMain([], { config: good, env: {}, realFetch: spy }), StagingGuardError, 'tokens required');
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(spy.calls, 0);
  assert.equal(spawn.calls.length, 0);
});

test('deploy-rules: plan only by default; --execute needs the exact staging project id', async () => {
  const deps = { config: good, env: {}, spawn: cliSpy() };
  assert.equal(await deployRulesMain(['--rules', 'compat'], deps), 0);
  assert.equal(deps.spawn.calls.length, 0, 'plan only');
  await assert.rejects(deployRulesMain(['--rules', 'compat', '--execute'], deps), StagingGuardError);
  await assert.rejects(deployRulesMain(['--rules', 'compat', '--execute', '--confirm', PROD], deps), StagingGuardError);
  await assert.rejects(deployRulesMain(['--rules', 'compat', '--execute', '--confirm', 'dairsharaf-staging2'], deps), StagingGuardError);
  assert.equal(deps.spawn.calls.length, 0);
  assert.equal(await deployRulesMain(['--rules', 'compat', '--execute', '--confirm', 'dairsharaf-staging'], deps), 0);
  assert.equal(deps.spawn.calls.length, 2, 'account check + deploy');
  assert.match(deps.spawn.calls[0].join(' '), /projects:list --json --account staging-owner@example\.com/);
  const cmd = deps.spawn.calls[1].join(' ');
  assert.match(cmd, /--project dairsharaf-staging/);
  assert.match(cmd, /--account staging-owner@example\.com/);
  assert.match(cmd, /--only firestore:rules/);
  assert.equal(cmd.includes(PROD), false);
});

test('deploy-workers: committed placeholders refused; filled file -> dry-run only unless --execute + exact --confirm', async () => {
  await assert.rejects(deployWorkersMain(['--which', 'order'], { config: good, env: {}, spawn: spawnSpy(), tomlOverride: writeTmp('head-o.toml', committedText(TARGETS.order.toml)) }), /REPLACE_WITH_/);
  await assert.rejects(deployWorkersMain(['--which', 'prod'], { config: good, env: {}, spawn: spawnSpy(), tomlOverride: writeTmp('o.toml', filledOrderToml()) }), StagingGuardError);

  const deps = { config: good, env: {}, spawn: cliSpy(), tomlOverride: writeTmp('o2.toml', filledOrderToml()) };
  assert.equal(await deployWorkersMain(['--which', 'order'], deps), 0);
  assert.equal(deps.spawn.calls.length, 1, 'dry-run only');
  assert.ok(deps.spawn.calls[0].includes('--dry-run'));

  await assert.rejects(deployWorkersMain(['--which', 'order', '--execute', '--confirm', 'anta-order-notify'], deps), StagingGuardError);
  assert.equal(deps.spawn.calls.length, 1, 'wrong --confirm refused before any spawn');
  assert.equal(await deployWorkersMain(['--which', 'order', '--execute', '--confirm', 'anta-order-notify-staging'], deps), 0);
  assert.ok(deps.spawn.calls.at(-2).includes('whoami'), 'account checked right before the deploy');
  const last = deps.spawn.calls.at(-1);
  assert.equal(last.includes('--dry-run'), false);
  assert.ok(last.includes('deploy'));
  assert.equal(last.join(' ').includes(PROD), false);

  const failingDry = { ...deps, spawn: spawnSpy(1) };
  await assert.rejects(deployWorkersMain(['--which', 'order', '--execute', '--confirm', 'anta-order-notify-staging'], failingDry), /dry-run failed/);
  assert.equal(failingDry.spawn.calls.length, 1, 'no real deploy after a failed dry-run');
});

// ------------------------------------------------------------------ priority-1 staging preparation (local only)
import { RULES_SETS, RULES_DIR, STAGING_PROJECT_ID, resolveRulesChoice, planRulesDeploy } from '../../staging/deploy-rules.mjs';
import { CRON_PERIOD_MS, CRON_WAIT_MS, CRON_STEP_MS, STAGING_DEV_ORIGIN } from '../../staging/run-tests.mjs';
import { buildScenarios } from '../../staging/scenarios.mjs';
import { execFileSync } from 'node:child_process';
import { parseArgs } from '../../staging/common.mjs';

const tomlValue = (text, key) => (text.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm')) || [])[1]?.trim();

test('wrangler.staging.toml: browser origin is exactly the local Vite address 127.0.0.1:3000; cron every 5 minutes', () => {
  const t = readFileSync(resolve(REPO_ROOT, 'workers/order-worker/wrangler.staging.toml'), 'utf8');
  assert.equal(tomlValue(t, 'ALLOWED_ORIGINS'), '"http://127.0.0.1:3000"');
  assert.equal(tomlValue(t, 'crons'), '["*/5 * * * *"]');
  assert.equal(/localhost/.test(t.replace(/^#.*$/gm, '')), false, 'no localhost origin left');
  assert.equal(STAGING_DEV_ORIGIN, 'http://127.0.0.1:3000', 'run-tests checks the same origin');
  // the filled-in staging file is still accepted by the wrangler guard
  const st = assertStagingConfig(good, { env: {} });
  assert.deepEqual(assertWranglerFile(writeTmp('ok-p1.toml', filledOrderToml()), { expectName: 'anta-order-notify-staging', expectTarget: 'staging', projectId: st.projectId, sinkHost: st.sinkHost }), { name: 'anta-order-notify-staging' });
});

test('production wrangler.toml is untouched (same as the last commit): cron and origins unchanged', () => {
  const now = readFileSync(resolve(REPO_ROOT, 'workers/order-worker/wrangler.toml'), 'utf8').replace(/\r\n/g, '\n');
  const committed = execFileSync('git', ['show', 'HEAD:workers/order-worker/wrangler.toml'], { cwd: REPO_ROOT, encoding: 'utf8' }).replace(/\r\n/g, '\n');
  assert.equal(now, committed);
  assert.equal(tomlValue(now, 'crons'), '["*/5 * * * *"]');
});

test('run-tests: the cron wait fits the 5-minute schedule and is bounded', () => {
  assert.equal(CRON_PERIOD_MS, 5 * 60_000);
  assert.ok(CRON_WAIT_MS >= 2 * CRON_PERIOD_MS, 'covers two schedule periods (one order per run)');
  assert.ok(CRON_WAIT_MS <= 15 * 60_000, 'bounded');
  assert.ok(CRON_STEP_MS > 0 && CRON_STEP_MS < CRON_WAIT_MS);
});

test('scenarios: a cron check that NEVER answers still ends at the wait limit (no endless wait)', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => (/\/create-order$/.test(String(url)) ? new Response(JSON.stringify({ ok: true }), { status: 200 }) : new Response('{}', { status: 200 }));
  try {
    const ctx = {
      W: 'https://w.test', S: 'https://s.test', sinkAuth: {}, turnstileToken: 't', projectId: 'x',
      get: () => new Promise(() => {}), // a read that never answers
      cronWaitMs: 300, cronStepMs: 50, skipBrowser: true,
    };
    const s11 = buildScenarios(ctx).find(([id]) => id === 'S11');
    assert.ok(s11, 'S11 present');
    const t0 = Date.now();
    await assert.rejects(s11[2](), /telegram eventually sent by cron/);
    assert.ok(Date.now() - t0 < 3_000, `ended after ${Date.now() - t0} ms`);
  } finally {
    globalThis.fetch = original;
  }
});

test('deploy-rules: each allowed set (compat | transition | final) -> plan only, the RIGHT file, nothing spawned', async () => {
  for (const kind of ['compat', 'transition', 'final']) {
    const spawn = cliSpy();
    assert.equal(await deployRulesMain(['--rules', kind], { config: good, env: {}, spawn }), 0, kind);
    assert.equal(spawn.calls.length, 0, `${kind}: plan only`);
    const plan = planRulesDeploy(assertStagingConfig(good, { env: {} }), resolveRulesChoice(parseArgs(['--rules', kind])));
    assert.equal(plan.kind, kind);
    assert.equal(readFileSync(join(plan.cwd, 'firestore.rules'), 'utf8'), readFileSync(RULES_SETS[kind], 'utf8'), `${kind}: copies its own file`);
    assert.ok(RULES_SETS[kind].startsWith(RULES_DIR));
  }
});

test('deploy-rules: missing / empty / unknown / path / extra options are refused BEFORE anything is planned or spawned', async () => {
  const absFinal = RULES_SETS.final;
  const bad = {
    'no --rules': [],
    '--rules without a value': ['--rules'],
    '--rules followed by another flag': ['--rules', '--execute', '--confirm', STAGING_PROJECT_ID],
    'unknown name': ['--rules', 'prod'],
    'case variant': ['--rules', 'FINAL'],
    'relative path': ['--rules', '../rules-test/firestore.rules.final'],
    'absolute path to a real rules file': ['--rules', absFinal],
    'file name instead of set name': ['--rules', 'firestore.rules.final'],
    'prototype key': ['--rules', '__proto__'],
    'extra file option': ['--rules', 'final', '--rules-file', absFinal],
    'equals syntax': ['--rules=final'],
  };
  for (const [name, argv] of Object.entries(bad)) {
    const spawn = cliSpy();
    await assert.rejects(deployRulesMain(argv, { config: good, env: {}, spawn }), StagingGuardError, name);
    assert.equal(spawn.calls.length, 0, `${name}: nothing spawned`);
  }
});

test('deploy-rules: only "dairsharaf-staging" may be targeted (another *-staging project is refused)', async () => {
  const st = assertStagingConfig(good, { env: {} });
  assert.throws(() => planRulesDeploy({ ...st, projectId: 'other-staging' }, resolveRulesChoice(parseArgs(['--rules', 'final']))), StagingGuardError);
  const other = { ...good, projectId: 'other-staging', firebaseWebConfig: { ...good.firebaseWebConfig, projectId: 'other-staging', authDomain: 'other-staging.firebaseapp.com' } };
  const spawn = cliSpy();
  await assert.rejects(deployRulesMain(['--rules', 'final', '--execute', '--confirm', 'other-staging'], { config: other, env: {}, spawn }), StagingGuardError);
  assert.equal(spawn.calls.length, 0);
});

test('deploy-rules: --dry-run never deploys (even with --execute --confirm); a real deploy needs --execute AND the exact --confirm', async () => {
  const dry = cliSpy();
  assert.equal(await deployRulesMain(['--rules', 'final', '--dry-run', '--execute', '--confirm', STAGING_PROJECT_ID], { config: good, env: {}, spawn: dry }), 0);
  assert.equal(dry.calls.length, 0, 'dry-run: nothing spawned');
  const noConfirm = cliSpy();
  await assert.rejects(deployRulesMain(['--rules', 'final', '--execute'], { config: good, env: {}, spawn: noConfirm }), StagingGuardError);
  assert.equal(noConfirm.calls.length, 0);
  const real = cliSpy();
  assert.equal(await deployRulesMain(['--rules', 'final', '--execute', '--confirm', STAGING_PROJECT_ID], { config: good, env: {}, spawn: real }), 0);
  assert.equal(real.calls.length, 2, 'account check + deploy (spawn spy, nothing real)');
  const cmd = real.calls[1].join(' ');
  assert.match(cmd, /--only firestore:rules --project dairsharaf-staging --account staging-owner@example\.com/);
  assert.equal(cmd.includes(PROD), false);
});

// ------------------------------------------------------------------ waitFor deadline + request bounds (local only)
import { makeWaitFor } from '../../staging/scenarios.mjs';
import { STAGING_REQUEST_TIMEOUT_MS } from '../../staging/guard.mjs';
import { createServer } from 'node:http';

const activeTimers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

test('waitFor: a read that HONOURS the signal is really cancelled at the deadline (the server sees the request closed)', async () => {
  let closed = 0;
  let opened = 0;
  const server = createServer((req) => {
    opened++;
    req.on('close', () => closed++); // never answers
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/calls`;
  try {
    const waitFor = makeWaitFor(200);
    const t0 = Date.now();
    const v = await waitFor(async (signal) => (await fetch(url, { signal })).json(), 200, 50);
    assert.equal(v, undefined, 'no result: the deadline ended the wait');
    assert.ok(Date.now() - t0 < 2_000, `ended after ${Date.now() - t0} ms`);
    for (let i = 0; i < 40 && closed < opened; i++) await new Promise((r) => setTimeout(r, 25));
    assert.ok(opened >= 1);
    assert.equal(closed, opened, 'every request was aborted (closed), none left open');
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('waitFor: a read that IGNORES the signal cannot extend the wait; no unhandled rejection afterwards', async () => {
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    const waitFor = makeWaitFor(150);
    let release;
    const t0 = Date.now();
    // never answers by itself; later rejects (as an aborted read would) — after waitFor has already returned
    const v = await waitFor(() => new Promise((_, rej) => (release = rej)), 150, 30);
    assert.equal(v, undefined);
    assert.ok(Date.now() - t0 < 1_500);
    release(new Error('late failure of a read that ignored the signal'));
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(unhandled, [], 'the late rejection is handled');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('waitFor: after a quick result NO timer stays behind (the process is not kept alive for the remaining wait)', async () => {
  const before = activeTimers();
  const waitFor = makeWaitFor(10 * 60_000);
  const v = await waitFor(async () => 'ready', 10 * 60_000, 5_000); // a 10-minute wait answered at once
  assert.equal(v, 'ready');
  assert.equal(activeTimers(), before, 'the 10-minute deadline timer was cleared');
});

test('waitFor: an error thrown by the check before the deadline still fails the scenario (unchanged)', async () => {
  const waitFor = makeWaitFor(1_000);
  await assert.rejects(waitFor(async () => { throw new Error('read failed'); }, 1_000, 20), /read failed/);
});

test('guardedFetch: every staging request is bounded; the caller\'s own signal still aborts it first', async () => {
  const st = assertStagingConfig(good, { env: {} });
  const seen = [];
  const hangUntilAborted = (input, init) => new Promise((_, rej) => {
    seen.push(init?.signal);
    init.signal.addEventListener('abort', () => rej(init.signal.reason));
  });
  assert.equal(STAGING_REQUEST_TIMEOUT_MS, 30_000);
  // default bound applies even when the caller gives no signal (e.g. the Firestore client)
  const f = guardedFetch(st, hangUntilAborted, { timeoutMs: 80 });
  const t0 = Date.now();
  await assert.rejects(f(`${good.workerUrl}/orders/X/status`), (e) => /TimeoutError|aborted|timeout/i.test(String(e?.name || e)));
  assert.ok(Date.now() - t0 < 1_500);
  assert.ok(seen[0] instanceof AbortSignal);
  // the caller's signal wins when it fires first
  const ac = new AbortController();
  const p = guardedFetch(st, hangUntilAborted, { timeoutMs: 60_000 })(`${good.sinkUrl}/calls`, { signal: ac.signal });
  ac.abort(new Error('caller cancelled'));
  await assert.rejects(p, /caller cancelled/);
  // blocked hosts are still refused before any request
  await assert.rejects(guardedFetch(st, hangUntilAborted)('https://firestore.googleapis.com/v1/projects/antastore1-82b50/databases/(default)/documents/x'), StagingGuardError);
});

test('deploy-workers: deploys ONLY from the git-ignored filled copy (*.local.toml), never from the tracked template', () => {
  const st = assertStagingConfig(good, { env: {} });
  for (const which of ['order', 'sink']) {
    const local = TARGETS[which].toml.replace(/\.toml$/, '.local.toml');
    if (existsSync(local)) {
      let plan = null;
      try { plan = planWorkerDeploy(st, which); } catch (e) { assert.ok(e instanceof StagingGuardError, `${which}: guard error only`); continue; } // a local file for ANOTHER config is refused, never printed
      assert.ok(plan.dryRun.includes(local) && plan.deploy.includes(local), `${which}: the local copy is deployed`);
      assert.ok(!plan.deploy.includes(TARGETS[which].toml), `${which}: never the template`);
    } else {
      assert.throws(() => planWorkerDeploy(st, which), (e) => e instanceof StagingGuardError && /\.local\.toml not found: copy/.test(e.message));
    }
  }
});
