// Staging script guards — LOCAL ONLY. Fake keys live in the OS temp dir (outside the repo).
// Network and process spawning are replaced by spies: every refusal must happen before them.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  assertStagingConfig, assertWranglerFile, guardedFetch, productionWebIdentifiers, StagingGuardError, REPO_ROOT,
} from '../../staging/guard.mjs';
import { main as seedMain } from '../../staging/seed.mjs';
import { main as runTestsMain } from '../../staging/run-tests.mjs';
import { main as deployRulesMain } from '../../staging/deploy-rules.mjs';
import { main as deployWorkersMain, TARGETS } from '../../staging/deploy-workers.mjs';

const PROD = 'antastore1-82b50';
const FAKE_KEY = '-----BEGIN PRIVATE KEY-----\nFAKEFAKEFAKE\n-----END PRIVATE KEY-----\n';
let dir;
let keyPath;
let prodKeyPath;
let good;
const TOKENS = { STAGING_SINK_READ_TOKEN: 'r'.repeat(32), STAGING_WORKER_AUTH_TOKEN: 'w'.repeat(32) };

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
test('wrangler files: committed staging files still contain placeholders -> refused', () => {
  const st = assertStagingConfig(good, { env: {} });
  assert.throws(() => assertWranglerFile(TARGETS.order.toml, { expectName: 'anta-order-notify-staging', expectTarget: 'staging', projectId: st.projectId, sinkHost: st.sinkHost }), /REPLACE_WITH_/);
  assert.throws(() => assertWranglerFile(TARGETS.sink.toml, { expectName: 'anta-notify-sink-staging' }), /REPLACE_WITH_/);
});

const filledOrderToml = () => readFileSync(TARGETS.order.toml, 'utf8').replaceAll('REPLACE_WITH_WORKERS_SUBDOMAIN', 'acme');
const writeTmp = (name, text) => {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
};

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
    'production site origin': (t) => t.replace('ALLOWED_ORIGINS = "http://localhost:3000"', 'ALLOWED_ORIGINS = "https://dairsharaf.com"'),
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
  const deps = { config: good, env: {}, spawn: spawnSpy() };
  assert.equal(await deployRulesMain([], deps), 0);
  assert.equal(deps.spawn.calls.length, 0, 'plan only');
  await assert.rejects(deployRulesMain(['--execute'], deps), StagingGuardError);
  await assert.rejects(deployRulesMain(['--execute', '--confirm', PROD], deps), StagingGuardError);
  await assert.rejects(deployRulesMain(['--execute', '--confirm', 'dairsharaf-staging2'], deps), StagingGuardError);
  assert.equal(deps.spawn.calls.length, 0);
  assert.equal(await deployRulesMain(['--execute', '--confirm', 'dairsharaf-staging'], deps), 0);
  assert.equal(deps.spawn.calls.length, 1);
  const cmd = deps.spawn.calls[0].join(' ');
  assert.match(cmd, /--project dairsharaf-staging/);
  assert.match(cmd, /--only firestore:rules/);
  assert.equal(cmd.includes(PROD), false);
});

test('deploy-workers: committed placeholders refused; filled file -> dry-run only unless --execute + exact --confirm', async () => {
  await assert.rejects(deployWorkersMain(['--which', 'order'], { config: good, env: {}, spawn: spawnSpy() }), /REPLACE_WITH_/);
  await assert.rejects(deployWorkersMain(['--which', 'prod'], { config: good, env: {}, spawn: spawnSpy(), tomlOverride: writeTmp('o.toml', filledOrderToml()) }), StagingGuardError);

  const deps = { config: good, env: {}, spawn: spawnSpy(), tomlOverride: writeTmp('o2.toml', filledOrderToml()) };
  assert.equal(await deployWorkersMain(['--which', 'order'], deps), 0);
  assert.equal(deps.spawn.calls.length, 1, 'dry-run only');
  assert.ok(deps.spawn.calls[0].includes('--dry-run'));

  await assert.rejects(deployWorkersMain(['--which', 'order', '--execute', '--confirm', 'anta-order-notify'], deps), StagingGuardError);
  assert.equal(await deployWorkersMain(['--which', 'order', '--execute', '--confirm', 'anta-order-notify-staging'], deps), 0);
  const last = deps.spawn.calls.at(-1);
  assert.equal(last.includes('--dry-run'), false);
  assert.ok(last.includes('deploy'));
  assert.equal(last.join(' ').includes(PROD), false);

  const failingDry = { ...deps, spawn: spawnSpy(1) };
  await assert.rejects(deployWorkersMain(['--which', 'order', '--execute', '--confirm', 'anta-order-notify-staging'], failingDry), /dry-run failed/);
  assert.equal(failingDry.spawn.calls.length, 1, 'no real deploy after a failed dry-run');
});
