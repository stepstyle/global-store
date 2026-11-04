// Fail-closed Firebase target for the web app — LOCAL ONLY, no network, no Firebase SDK.
//   node --test tools/firebase-guard.test.mjs     (Node >= 22.18 / 23.6 strips the TypeScript types)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { resolveFirebaseTarget, FirebaseTargetError, productionIdentifiers } from '../src/services/firebaseTarget.ts';
import { checkDevEnv, checkBuildEnv, checkPreviewDist, readProductionConfig, firebaseEnvGuard, recordBuildTarget, recordFile } from './firebase-env-guard.ts';

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

test('unknown target refused in dev and in builds', () => {
  refused({ isDev: true, env: { ...GOOD, VITE_FIREBASE_TARGET: 'staging' } });
  refused({ isDev: false, env: { VITE_FIREBASE_TARGET: 'staging' } }, /unknown/);
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
