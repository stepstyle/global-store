// Fail-closed Firebase target for the web app — LOCAL ONLY, no network, no Firebase SDK.
//   node --test tools/firebase-guard.test.mjs     (Node >= 22.18 / 23.6 strips the TypeScript types)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { resolveFirebaseTarget, FirebaseTargetError, productionIdentifiers, STAGING_ALLOWED_VITE_KEYS } from '../src/services/firebaseTarget.ts';
import { checkDevEnv, checkBuildEnv, checkPreviewDist, readProductionConfig, firebaseEnvGuard, recordBuildTarget, recordFile, stripProductionTrackers, STAGING_ENV_DIR } from './firebase-env-guard.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROD = readProductionConfig(ROOT); // read locally from src/services/firebase.ts — never printed
const GOOD = {
  VITE_FIREBASE_TARGET: 'emulator',
  VITE_FIREBASE_PROJECT_ID: 'demo-dairsharaf-dev',
  VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088',
  VITE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
};
const OVERRIDE = { apiKey: 'admin-saved-key', authDomain: 'x.firebaseapp.com', projectId: 'some-other-project', storageBucket: 'x.appspot.com', messagingSenderId: '1', appId: '1:1:web:1' };
let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'firebase-guard-test-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const refused = (input, re) =>
  assert.throws(() => resolveFirebaseTarget({ productionConfig: PROD, localOverride: null, ...input }), (e) => e instanceof FirebaseTargetError && (!re || re.test(e.message)));

// ------------------------------------------------------------------ production behaviour is unchanged
test('production identifiers are read locally from src/services/firebase.ts', () => {
  assert.ok(PROD, 'readable');
  assert.equal(PROD.projectId, 'antastore1-82b50');
  assert.ok(productionIdentifiers(PROD).length >= 6);
});

test('the inline production config in firebase.ts is byte-identical to the last commit', () => {
  const block = (src) => (src.match(/const cfg: Partial<FirebaseWebConfig> = \{[\s\S]*?\};/) || [])[0];
  const head = execFileSync('git', ['show', 'HEAD:src/services/firebase.ts'], { cwd: ROOT, encoding: 'utf8' });
  const now = readFileSync(join(ROOT, 'src/services/firebase.ts'), 'utf8');
  assert.ok(block(head) && block(now));
  assert.equal(block(now), block(head));
});

test('production build, no new variable: inline production config (same as before)', () => {
  for (const env of [{}, { VITE_FIREBASE_TARGET: '' }, { VITE_FIREBASE_TARGET: 'production' }, { VITE_WORKER_URL: 'https://x.example' }]) {
    const t = resolveFirebaseTarget({ isDev: false, env, productionConfig: PROD, localOverride: null });
    assert.equal(t.kind, 'production');
    assert.equal(t.source, 'inline');
    assert.deepEqual(t.config, PROD);
  }
});

test('production build keeps the admin localStorage override priority (same as before)', () => {
  const t = resolveFirebaseTarget({ isDev: false, env: {}, productionConfig: PROD, localOverride: OVERRIDE });
  assert.equal(t.source, 'localStorage');
  assert.deepEqual(t.config, OVERRIDE);
});

// ------------------------------------------------------------------ local development: fail-closed
test('local dev without the emulator target is refused (incl. explicit production)', () => {
  refused({ isDev: true, env: {} }, /VITE_FIREBASE_TARGET=emulator/);
  refused({ isDev: true, env: { VITE_FIREBASE_TARGET: 'production' } }, /VITE_FIREBASE_TARGET=emulator/);
  refused({ isDev: true, env: { ...GOOD, VITE_FIREBASE_TARGET: 'Production ' } });
});

test('local dev with a Firebase config saved in the browser is refused, even a demo one', () => {
  refused({ isDev: true, env: GOOD, localOverride: OVERRIDE }, /localStorage/);
  refused({ isDev: true, env: GOOD, localOverride: { ...OVERRIDE, projectId: 'demo-x' } }, /localStorage/);
  refused({ isDev: true, env: GOOD, localOverride: PROD }, /localStorage/);
});

test('emulator target requires a demo- project: production, staging and other projects refused', () => {
  for (const projectId of ['antastore1-82b50', 'dairsharaf-staging', 'dairsharaf-dev', 'demo_x', 'DEMO-x', 'demo-', '', `demo-${'a'.repeat(41)}`]) {
    refused({ isDev: true, env: { ...GOOD, VITE_FIREBASE_PROJECT_ID: projectId } }, /demo-/);
  }
});

test('emulator endpoints must be 127.0.0.1:<port>', () => {
  for (const host of ['localhost:8088', '0.0.0.0:8088', '192.168.1.5:8088', 'http://127.0.0.1:8088', '127.0.0.1', '127.0.0.1:80', '127.0.0.1:99999', 'firestore.googleapis.com:443', '']) {
    refused({ isDev: true, env: { ...GOOD, VITE_FIRESTORE_EMULATOR_HOST: host } }, /VITE_FIRESTORE_EMULATOR_HOST/);
    refused({ isDev: true, env: { ...GOOD, VITE_AUTH_EMULATOR_HOST: host } }, /VITE_AUTH_EMULATOR_HOST/);
  }
  refused({ isDev: true, env: { ...GOOD, VITE_AUTH_EMULATOR_HOST: GOOD.VITE_FIRESTORE_EMULATOR_HOST } }, /different ports/);
});

test('emulator target refused when any VITE_ value carries a production identifier', () => {
  for (const id of productionIdentifiers(PROD)) {
    refused({ isDev: true, env: { ...GOOD, VITE_FIREBASE_API_KEY: id } }, /production Firebase identifier/);
    refused({ isDev: true, env: { ...GOOD, VITE_SOMETHING_ELSE: `x-${id}-y` } }, /production Firebase identifier/);
  }
});

test('valid local dev config: emulator on 127.0.0.1, demo project, fake values only', () => {
  const t = resolveFirebaseTarget({ isDev: true, env: GOOD, productionConfig: PROD, localOverride: null });
  assert.equal(t.kind, 'emulator');
  assert.deepEqual(t.firestore, { host: '127.0.0.1', port: 8088 });
  assert.deepEqual(t.auth, { host: '127.0.0.1', port: 9099 });
  assert.equal(t.config.projectId, 'demo-dairsharaf-dev');
  const blob = JSON.stringify(t);
  for (const id of productionIdentifiers(PROD)) assert.equal(blob.includes(id), false);
});

test('unknown target refused in dev and in builds; staging (dev-only) never in a build', () => {
  refused({ isDev: true, env: { ...GOOD, VITE_FIREBASE_TARGET: 'qa' } });
  refused({ isDev: false, env: { VITE_FIREBASE_TARGET: 'qa' } }, /unknown/);
  // staging with the emulator demo env is still refused in dev (wrong project / no proxy) …
  refused({ isDev: true, env: { ...GOOD, VITE_FIREBASE_TARGET: 'staging' } });
  // … and a staging target is never accepted in a build
  refused({ isDev: false, env: { VITE_FIREBASE_TARGET: 'staging' } }, /local dev server only/);
});

// ------------------------------------------------------------------ staging target (local dev server only)
const STAGING = {
  VITE_FIREBASE_TARGET: 'staging',
  VITE_FIREBASE_PROJECT_ID: 'dairsharaf-staging',
  VITE_FIREBASE_API_KEY: 'AIzaSyFAKEstagingKEY00000000000000000000', // fake, shape only
  VITE_FIREBASE_APP_ID: '1:123456789012:web:abcdef1234567890',
  VITE_FIREBASE_AUTH_DOMAIN: 'dairsharaf-staging.firebaseapp.com',
  VITE_WORKER_URL: 'http://127.0.0.1:8789',
};

test('staging target: dairsharaf-staging only, no emulator, orders through the local proxy, no production id', () => {
  const t = resolveFirebaseTarget({ isDev: true, env: STAGING, productionConfig: PROD, localOverride: null });
  assert.equal(t.kind, 'staging');
  assert.equal(t.workerUrl, 'http://127.0.0.1:8789');
  assert.deepEqual(t.config, {
    apiKey: STAGING.VITE_FIREBASE_API_KEY, authDomain: 'dairsharaf-staging.firebaseapp.com', projectId: 'dairsharaf-staging',
    storageBucket: 'dairsharaf-staging.firebasestorage.app', messagingSenderId: '123456789012', appId: STAGING.VITE_FIREBASE_APP_ID,
  });
  const blob = JSON.stringify(t);
  for (const id of productionIdentifiers(PROD)) assert.equal(blob.includes(id), false);
  assert.deepEqual(checkDevEnv(STAGING, PROD), [], 'the dev server guard accepts it');
});

test('staging target refused: other projects, production ids, direct/remote Worker URLs, secrets, emulator mix, analytics', () => {
  const bad = (over, re) => {
    refused({ isDev: true, env: { ...STAGING, ...over } }, re);
    assert.ok(checkDevEnv({ ...STAGING, ...over }, PROD).length > 0, `dev server refuses ${JSON.stringify(over)}`);
  };
  for (const projectId of ['antastore1-82b50', 'dairsharaf-dev', 'other-staging', 'demo-dairsharaf-dev', 'dairsharaf-staging2', '']) bad({ VITE_FIREBASE_PROJECT_ID: projectId }, /VITE_FIREBASE_PROJECT_ID=dairsharaf-staging/);
  for (const id of productionIdentifiers(PROD)) bad({ VITE_EXTRA: `x${id}x` }, /production Firebase identifier/);
  bad({ VITE_FIREBASE_AUTH_DOMAIN: PROD.authDomain }, /production|AUTH_DOMAIN/);
  for (const u of ['https://anta-order-notify-staging.hopemohmmed.workers.dev', 'http://localhost:8789', 'https://127.0.0.1:8789', 'http://127.0.0.1:8789/x', 'http://192.168.1.5:8789', '']) bad({ VITE_WORKER_URL: u }, /VITE_WORKER_URL/);
  bad({ VITE_STAGING_ACCESS_TOKEN: 'x' }, /secrets never go into VITE_/);
  bad({ VITE_WORKER_AUTH_TOKEN: 'x' }, /secrets never go into VITE_/);
  bad({ VITE_SOMETHING: 'a'.repeat(64) }, /looks like a secret/);
  bad({ VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088' }, /must be empty/);
  bad({ VITE_FIREBASE_MEASUREMENT_ID: 'G-XXXX' }, /MEASUREMENT_ID/);
  bad({ VITE_FIREBASE_API_KEY: '' }, /API_KEY/);
  bad({ VITE_FIREBASE_APP_ID: '1:1:web:x' }, /APP_ID/);
  bad({ VITE_FIREBASE_MESSAGING_SENDER_ID: '999999999' }, /does not match/);
  bad({ VITE_FIREBASE_STORAGE_BUCKET: 'antastore-other.appspot.com' }, /STORAGE_BUCKET/);
  // Turnstile: only Cloudflare's public TEST site keys in staging (a real site key's tokens fail the TEST secret)
  bad({ VITE_TURNSTILE_SITE_KEY: '0x4AAAAAAABkMYinukE8nzYS' }, /TEST site key/);
  bad({ VITE_TURNSTILE_SECRET: '1x0000000000000000000000000000000AA' }, /not allowed|secrets never/);
  for (const k of ['1x00000000000000000000AA', '2x00000000000000000000AB', '3x00000000000000000000FF']) {
    assert.equal(resolveFirebaseTarget({ isDev: true, env: { ...STAGING, VITE_TURNSTILE_SITE_KEY: k }, productionConfig: PROD, localOverride: null }).kind, 'staging', k);
  }
  refused({ isDev: true, env: STAGING, localOverride: PROD }, /localStorage/);
  // production identifiers unreadable -> refused (fail-closed)
  assert.throws(() => resolveFirebaseTarget({ isDev: true, env: STAGING, productionConfig: null, localOverride: null }), /fail-closed/);
});

test('build guard: secret-looking VITE_ variables refuse ANY build (they would be public); public keys pass', () => {
  for (const k of ['VITE_GEMINI_API_KEY', 'VITE_WORKER_AUTH_TOKEN', 'VITE_SENDGRID_API_KEY', 'VITE_TURNSTILE_SECRET', 'VITE_FIREBASE_PRIVATE_KEY']) {
    for (const isVercel of [true, false]) assert.ok(checkBuildEnv({ [k]: 'x' }, { isVercel }).some((p) => p.includes(k)), `${k} vercel=${isVercel}`);
  }
  assert.deepEqual(checkBuildEnv({ VITE_TURNSTILE_SITE_KEY: '0x4AAAAAAAProdSim', VITE_WORKER_URL: 'https://w.example.workers.dev', VITE_FIREBASE_API_KEY: 'AIza-public' }, { isVercel: true }), []);
  assert.deepEqual(checkBuildEnv({ VITE_GEMINI_API_KEY: '' }, { isVercel: true }), [], 'an empty variable is not shipped');
});

test('build guard: a staging target never reaches any build (local or Vercel)', () => {
  assert.ok(checkBuildEnv({ VITE_FIREBASE_TARGET: 'staging' }, { isVercel: false }).some((p) => /never a build/.test(p)));
  assert.ok(checkBuildEnv({ VITE_FIREBASE_TARGET: 'staging' }, { isVercel: true }).some((p) => /never a build/.test(p)));
  const plugin = firebaseEnvGuard({ root: ROOT, loadEnv: () => STAGING });
  assert.throws(() => plugin.config({ envDir: STAGING_ENV_DIR }, { command: 'build', mode: 'staging' }), /never a build/);
  assert.doesNotThrow(() => firebaseEnvGuard({ root: ROOT, loadEnv: () => STAGING }).config({ envDir: STAGING_ENV_DIR }, { command: 'serve', mode: 'staging', isPreview: false }));
});

// ------------------------------------------------------------------ staging env isolation (env/staging only)
test('staging allow-list: any other VITE_ variable (VITE_GEMINI_API_KEY, AI URL, …) is refused', () => {
  for (const k of ['VITE_GEMINI_API_KEY', 'VITE_AI_INTENT_URL', 'VITE_ANYTHING']) {
    refused({ isDev: true, env: { ...STAGING, [k]: 'x' } }, new RegExp(`${k} is not allowed in the staging target`));
  }
  // public identifiers only: Firebase web config, the local proxy URL, the PUBLIC Turnstile site key
  assert.ok(STAGING_ALLOWED_VITE_KEYS.every((k) => k.startsWith('VITE_FIREBASE_') || k === 'VITE_WORKER_URL' || k === 'VITE_TURNSTILE_SITE_KEY'));
});

test('mode staging: the guard refuses BEFORE loading anything unless envDir is env/staging; root .env files never read', () => {
  const dirs = [];
  const spy = (mode, d) => { dirs.push(d); return STAGING; };
  for (const cfg of [{}, { envDir: '.' }, { envDir: 'env' }, { envDir: 'env/staging/..' }]) {
    assert.throws(() => firebaseEnvGuard({ root: ROOT, loadEnv: spy }).config(cfg, { command: 'serve', mode: 'staging', isPreview: false }), /must read env files only from env\/staging/);
    assert.throws(() => firebaseEnvGuard({ root: ROOT, loadEnv: spy }).config(cfg, { command: 'build', mode: 'staging' }), /must read env files only from env\/staging/);
  }
  assert.deepEqual(dirs, [], 'loadEnv was never called for a misconfigured staging run');
  firebaseEnvGuard({ root: ROOT, loadEnv: spy }).config({ envDir: STAGING_ENV_DIR }, { command: 'serve', mode: 'staging', isPreview: false });
  assert.deepEqual(dirs, [resolve(ROOT, STAGING_ENV_DIR)], 'staging loads env/staging only');
  // a staging target smuggled into another mode from the root env files is refused
  assert.throws(() => firebaseEnvGuard({ root: ROOT, loadEnv: () => STAGING }).config({}, { command: 'serve', mode: 'development', isPreview: false }), /only via npm run dev:staging/);
  // other modes: unchanged (the root, as before)
  const seenDirs = [];
  firebaseEnvGuard({ root: ROOT, loadEnv: (m, d) => { seenDirs.push(d); return GOOD; } }).config({}, { command: 'serve', mode: 'development', isPreview: false });
  firebaseEnvGuard({ root: ROOT, loadEnv: (m, d) => { seenDirs.push(d); return {}; } }).config({}, { command: 'build', mode: 'production' });
  assert.deepEqual(seenDirs, [ROOT, ROOT]);
});

test('REAL Vite loadEnv: a planted root .env.local is ignored in mode staging; an inherited VITE_GEMINI_API_KEY is refused', async () => {
  const { loadEnv } = await import('vite');
  const root = mkdtempSync(join(dir, 'iso-'));
  mkdirSync(join(root, 'src/services'), { recursive: true });
  writeFileSync(join(root, 'src/services/firebase.ts'), readFileSync(join(ROOT, 'src/services/firebase.ts'), 'utf8')); // production ids (local read)
  // planted root files that must NEVER reach a staging session
  writeFileSync(join(root, '.env.local'), 'VITE_GEMINI_API_KEY=planted-root-key\nVITE_FIREBASE_TARGET=emulator\n');
  writeFileSync(join(root, '.env'), 'VITE_ROOT_LEAK=1\n');
  writeFileSync(join(root, '.env.staging.local'), 'VITE_ROOT_STAGING_LEAK=1\n');
  mkdirSync(join(root, STAGING_ENV_DIR), { recursive: true });
  writeFileSync(join(root, STAGING_ENV_DIR, '.env.staging.local'), Object.entries(STAGING).map(([k, v]) => `${k}=${v}`).join('\n'));
  const loaded = loadEnv('staging', join(root, STAGING_ENV_DIR), 'VITE_');
  assert.deepEqual(Object.keys(loaded).sort(), Object.keys(STAGING).sort(), 'only env/staging values');
  assert.doesNotThrow(() => firebaseEnvGuard({ root, loadEnv }).config({ envDir: STAGING_ENV_DIR }, { command: 'serve', mode: 'staging', isPreview: false }));
  const prev = process.env.VITE_GEMINI_API_KEY;
  process.env.VITE_GEMINI_API_KEY = 'inherited-from-shell';
  try {
    assert.throws(() => firebaseEnvGuard({ root, loadEnv }).config({ envDir: STAGING_ENV_DIR }, { command: 'serve', mode: 'staging', isPreview: false }), /VITE_GEMINI_API_KEY is not allowed/);
  } finally {
    if (prev === undefined) delete process.env.VITE_GEMINI_API_KEY; else process.env.VITE_GEMINI_API_KEY = prev;
  }
});

test('vite.config.ts: envDir env/staging + .env watcher ignore ONLY in mode staging; every other mode unchanged', async () => {
  // Vite's config loader provides __dirname (= the repo root) to vite.config.ts; plain Node ESM does not
  globalThis.__dirname = ROOT;
  const { default: factory } = await import('../vite.config.ts');
  const strip = (c) => JSON.parse(JSON.stringify({ ...c, plugins: undefined }));
  let prod, dev, stg;
  try {
    prod = strip(factory({ mode: 'production', command: 'build' }));
    dev = strip(factory({ mode: 'development', command: 'serve' }));
    stg = strip(factory({ mode: 'staging', command: 'serve' }));
  } finally {
    delete globalThis.__dirname;
  }
  assert.equal(prod.envDir, undefined);
  assert.equal(dev.envDir, undefined);
  assert.deepEqual(prod, dev, 'production and development configs are identical (as before)');
  assert.deepEqual(prod.server, { port: 3000, host: '127.0.0.1', strictPort: true });
  assert.deepEqual(prod.build, { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1000 });
  assert.equal(stg.envDir, STAGING_ENV_DIR);
  assert.deepEqual(stg.server, { port: 3000, host: '127.0.0.1', strictPort: true, watch: { ignored: ['**/.env', '**/.env.*'] } });
});

// ------------------------------------------------------------------ production trackers: dev server only
test('dev server serves index.html WITHOUT Google Analytics / Meta Pixel; builds keep it byte-identical', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /googletagmanager\.com/, 'the production page does load the trackers');
  const stripped = stripProductionTrackers(html);
  assert.doesNotMatch(stripped, /googletagmanager|connect\.facebook\.net|fbq\(|gtag\(|G-E4P313LDJ0|406363479141487/);
  assert.match(stripped, /<div id="root"><\/div>/);
  assert.match(stripped, /src="\/src\/main\.tsx"/);
  assert.match(stripped, /fonts\.googleapis\.com/, 'everything else kept');
  for (const [mode, env, cfg] of [['development', GOOD, {}], ['staging', STAGING, { envDir: STAGING_ENV_DIR }]]) {
    const plugin = firebaseEnvGuard({ root: ROOT, loadEnv: () => env });
    plugin.config(cfg, { command: 'serve', mode, isPreview: false });
    assert.equal(plugin.transformIndexHtml.handler(html), stripped, `dev server (${mode})`);
  }
  const build = firebaseEnvGuard({ root: ROOT, loadEnv: () => ({}) });
  build.config({}, { command: 'build', mode: 'production' });
  assert.equal(build.transformIndexHtml.handler(html), html, 'production build: unchanged');
  // fail-closed: a tracker form the stripper does not know is never served
  assert.throws(() => stripProductionTrackers('<head><img src="https://www.facebook.com/tr?id=1&ev=PageView"></head>'), /still in index\.html/);
  assert.throws(() => stripProductionTrackers('<script src="https://www.google-analytics.com/analytics.js" async defer data-x></script><script>fbq("x")</script>'.replace('</script><script>', '</script>\n<p>fbq(</p><script>')), /still in index\.html/);
});

// ------------------------------------------------------------------ dev emulator config + npm scripts
test('dev emulator: 127.0.0.1 only, UI off, Firestore+Auth only, LOCAL production rules snapshot, demo- project', () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'firebase/dev-emulator.firebase.json'), 'utf8'));
  assert.deepEqual(Object.keys(cfg).sort(), ['emulators', 'firestore'], 'no hosting/functions/storage/database sections');
  assert.equal(cfg.firestore.rules, 'firestore.rules.prod-snapshot');
  assert.ok(readFileSync(join(ROOT, 'firebase', cfg.firestore.rules), 'utf8').includes("match /orders/{id}"), 'rules file is the local snapshot');
  const e = cfg.emulators;
  assert.equal(e.ui.enabled, false);
  assert.deepEqual(Object.keys(e).sort(), ['auth', 'firestore', 'hub', 'logging', 'singleProjectMode', 'ui']);
  for (const k of ['firestore', 'auth', 'hub', 'logging']) assert.equal(e[k].host, '127.0.0.1', k);
  const example = Object.fromEntries(readFileSync(join(ROOT, '.env.example'), 'utf8').split(/\r?\n/).filter((l) => /^VITE_/.test(l)).map((l) => l.split('=')));
  assert.equal(example.VITE_FIRESTORE_EMULATOR_HOST, `127.0.0.1:${e.firestore.port}`, '.env.example matches the emulator port');
  assert.equal(example.VITE_AUTH_EMULATOR_HOST, `127.0.0.1:${e.auth.port}`);
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
  for (const s of ['emulators:dev', 'test:dev-rules']) {
    assert.match(scripts[s], /--project demo-dairsharaf-dev\b/, s);
    assert.match(scripts[s], /--config firebase\/dev-emulator\.firebase\.json/, s);
    assert.equal(scripts[s].includes(PROD.projectId), false, s);
  }
  assert.equal(scripts.build, 'vite build', 'production build script unchanged');
  assert.deepEqual(checkDevEnv(example, PROD), [], '.env.example passes the dev guard');
});

// ------------------------------------------------------------------ Vite guard: dev server
test('dev server guard: valid emulator env passes; a local Worker URL or none is fine', () => {
  assert.deepEqual(checkDevEnv(GOOD, PROD), []);
  assert.deepEqual(checkDevEnv({ ...GOOD, VITE_WORKER_URL: '' }, PROD), []);
  assert.deepEqual(checkDevEnv({ ...GOOD, VITE_WORKER_URL: 'http://127.0.0.1:8787' }, PROD), []);
});

test('dev server guard: refuses production Worker, production site, remote URLs, unreadable prod ids', () => {
  const bad = {
    'production Worker': 'https://anta-order-notify.someone.workers.dev',
    'any workers.dev': 'http://127.0.0.1:8787/?u=x.workers.dev',
    'production site': 'https://dairsharaf.com/api',
    'https remote': 'https://api.example.com',
    'localhost name': 'http://localhost:8787',
    'LAN address': 'http://192.168.1.20:8787',
  };
  for (const [name, url] of Object.entries(bad)) assert.ok(checkDevEnv({ ...GOOD, VITE_WORKER_URL: url }, PROD).length > 0, name);
  assert.ok(checkDevEnv({}, PROD).length > 0, 'no env');
  assert.ok(checkDevEnv(GOOD, null).some((p) => /fail-closed/.test(p)), 'prod ids unreadable');
});

// ------------------------------------------------------------------ Vite guard: build
test('build guard: production build needs no new variable; emulator / local URLs never reach Vercel', () => {
  assert.deepEqual(checkBuildEnv({}, { isVercel: true }), []);
  assert.deepEqual(checkBuildEnv({ VITE_WORKER_URL: 'https://prod.example' }, { isVercel: true }), []);
  assert.ok(checkBuildEnv({ VITE_FIREBASE_TARGET: 'emulator' }, { isVercel: true }).length > 0);
  assert.ok(checkBuildEnv({ VITE_WORKER_URL: 'http://127.0.0.1:8787' }, { isVercel: true }).length > 0);
  assert.deepEqual(checkBuildEnv({ VITE_FIREBASE_TARGET: 'emulator' }, { isVercel: false }), [], 'local emulator build allowed');
  assert.ok(checkBuildEnv({ VITE_FIREBASE_TARGET: 'qa' }, { isVercel: false }).length > 0);
});

// ------------------------------------------------------------------ Vite guard: preview
test('preview guard: only a folder recorded as an EMULATOR build is served; production / unknown refused', () => {
  const root = join(dir, 'fake-root'); // records go to <root>/node_modules/.cache — isolated from the real project
  const prodDist = join(dir, 'dist-prod');
  const emuDist = join(dir, 'dist-emu');
  const oldDist = join(dir, 'dist-old');
  for (const d of [prodDist, emuDist, oldDist]) mkdirSync(d, { recursive: true });
  recordBuildTarget(root, prodDist, 'production');
  recordBuildTarget(root, emuDist, 'emulator');
  assert.match(checkPreviewDist(root, prodDist).join(), /PRODUCTION build/);
  assert.deepEqual(checkPreviewDist(root, emuDist), []);
  assert.match(checkPreviewDist(root, oldDist).join(), /no recorded build target/, 'unknown folder: fail-closed');
  assert.match(checkPreviewDist(root, join(dir, 'missing')).join(), /nothing to preview/);
  recordBuildTarget(root, emuDist, 'production'); // rebuilt as production later -> refused again
  assert.ok(checkPreviewDist(root, emuDist).length > 0);
  assert.ok(recordFile(root).includes('node_modules'), 'record kept outside any bundle');
});

// ------------------------------------------------------------------ the Vite plugin itself
test('plugin: throws (server never starts) on a bad dev env; silent on a good one; Vercel emulator build refused', () => {
  const plugin = (env) => firebaseEnvGuard({ root: ROOT, loadEnv: () => env });
  assert.throws(() => plugin({}).config({}, { command: 'serve', mode: 'development', isPreview: false }), /FIREBASE ENV GUARD REFUSED \(dev server/);
  assert.throws(() => plugin({ ...GOOD, VITE_FIREBASE_PROJECT_ID: 'antastore1-82b50' }).config({}, { command: 'serve', mode: 'development' }), /demo-/);
  assert.doesNotThrow(() => plugin(GOOD).config({}, { command: 'serve', mode: 'development', isPreview: false }));
  assert.doesNotThrow(() => plugin({}).config({}, { command: 'build', mode: 'production' }));
  const prev = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    assert.throws(() => plugin({ VITE_FIREBASE_TARGET: 'emulator' }).config({}, { command: 'build', mode: 'production' }), /Vercel/);
    assert.doesNotThrow(() => plugin({}).config({}, { command: 'build', mode: 'production' }));
  } finally {
    if (prev === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prev;
  }
});

test('plugin: build records its target; preview checks the folder actually served (CLI --outDir included)', () => {
  const root = join(dir, 'plugin-root');
  const prodDist = join(dir, 'served-prod');
  const emuDist = join(dir, 'served-emu');
  for (const d of [prodDist, emuDist]) mkdirSync(d, { recursive: true });
  const build = (env, out) => {
    const p = firebaseEnvGuard({ root, loadEnv: () => env });
    p.config({}, { command: 'build', mode: 'production' });
    p.configResolved({ root, build: { outDir: out } });
    p.closeBundle();
  };
  build({}, prodDist); // production build (no variables)
  build(GOOD, emuDist); // local emulator build
  const preview = (out) => {
    const p = firebaseEnvGuard({ root, loadEnv: () => ({}) });
    p.config({}, { command: 'serve', mode: 'production', isPreview: true });
    p.configResolved({ root, build: { outDir: out } });
  };
  assert.throws(() => preview(prodDist), /REFUSED \(preview/);
  assert.doesNotThrow(() => preview(emuDist));
  // dev server needs the real project root (it reads the production identifiers; a root without them is refused)
  assert.throws(() => firebaseEnvGuard({ root, loadEnv: () => GOOD }).config({}, { command: 'serve', mode: 'development' }), /fail-closed/);
  const dev = firebaseEnvGuard({ root: ROOT, loadEnv: () => GOOD });
  dev.config({}, { command: 'serve', mode: 'development', isPreview: false });
  assert.doesNotThrow(() => dev.configResolved({ root: ROOT, build: { outDir: prodDist } }), 'dev server is not a preview');
  assert.doesNotThrow(() => dev.closeBundle(), 'dev server records nothing');
});
