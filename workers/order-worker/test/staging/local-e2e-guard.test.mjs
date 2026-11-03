// Guards of the LOCAL e2e run (test/local-e2e) — pure checks, no process started, no network.
// The jail tests run in a child Node process whose REAL socket/DNS functions are replaced by spies
// before the jail is loaded, so even a broken jail could not send a packet.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertLocalPlan, checkWranglerFile, localOnlyFetch, localPort, LocalE2EGuardError, FORBIDDEN_ENV } from '../local-e2e/guard.mjs';
import { PLAN, PORTS, FILES } from '../local-e2e/plan.mjs';

const PROD = 'antastore1-82b50';
let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'local-e2e-guard-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));
const refuses = (plan, env = {}, re) => assert.throws(() => assertLocalPlan(plan, env), (e) => e instanceof LocalE2EGuardError && (!re || re.test(e.message)));
const at = (name, text) => {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
};

// ------------------------------------------------------------------ the committed plan
test('committed local plan passes: demo project, 127.0.0.1 only, local wrangler files, emulator config', () => {
  assert.equal(assertLocalPlan(PLAN, {}), true);
  assert.equal(assertLocalPlan(PLAN, { FIRESTORE_EMULATOR_HOST: `127.0.0.1:${PORTS.emulator}`, GCLOUD_PROJECT: PLAN.projectId }), true);
});

// ------------------------------------------------------------------ non-demo Firebase project
test('refuses a non-demo Firebase project (production, staging, plain names)', () => {
  for (const projectId of [PROD, 'dairsharaf-staging', 'dairsharaf-e2e', 'demo_x', '', `demo-${PROD}`]) {
    refuses({ ...PLAN, projectId }, {}, /demo-|production/);
  }
});

// ------------------------------------------------------------------ external / non-local addresses
test('refuses any URL that is not http://127.0.0.1:<planned port>', () => {
  const bad = [
    'https://127.0.0.1:8787', 'http://localhost:8787', 'http://0.0.0.0:8787', 'http://[::1]:8787',
    'http://192.168.1.10:8787', 'http://10.0.0.1:8787', 'https://anta-order-notify-staging.acme.workers.dev',
    'https://firestore.googleapis.com/v1', 'https://dairsharaf.com', 'http://127.0.0.1.evil.com:8787',
    'http://127.0.0.1:9999', 'http://user:pw@127.0.0.1:8787',
  ];
  for (const u of bad) refuses({ ...PLAN, urls: { ...PLAN.urls, order: u } }, {}, /order/);
  assert.equal(localPort('http://127.0.0.1:8787/v1'), 8787);
});

test('refuses wrangler files that could reach Cloudflare or production', () => {
  const base = readFileSync(FILES.orderToml, 'utf8');
  const allowed = new Set(Object.values(PORTS));
  assert.deepEqual(checkWranglerFile(FILES.orderToml, allowed), []);
  assert.deepEqual(checkWranglerFile(FILES.sinkToml, allowed), []);
  const tamper = {
    'external Telegram': (t) => t.replace('http://127.0.0.1:8788/telegram', 'https://api.telegram.org'),
    'real Firestore': (t) => t.replace('http://127.0.0.1:8087/v1', 'https://firestore.googleapis.com/v1'),
    'unplanned local port': (t) => t.replace('http://127.0.0.1:8788/sendgrid', 'http://127.0.0.1:9999/sendgrid'),
    'account_id': (t) => `account_id = "0123456789abcdef0123456789abcdef"\n${t}`,
    'routes': (t) => `routes = ["dairsharaf.com/*"]\n${t}`,
    'workers_dev true': (t) => t.replace(/^workers_dev = false$/m, 'workers_dev = true'),
    'remote binding': (t) => `${t}\n[[kv_namespaces]]\nbinding = "X"\nid = "x"\nremote = true\n`,
    '[env.production]': (t) => `${t}\n[env.production]\nname = "anta-order-notify"\n`,
    'staging build target': (t) => t.replace(`__DEPLOY_TARGET__ = "'local'"`, `__DEPLOY_TARGET__ = "'staging'"`),
    'ENVIRONMENT production': (t) => t.replace('ENVIRONMENT = "local"', 'ENVIRONMENT = "production"'),
    'production project': (t) => t.replace('FIREBASE_PROJECT_ID = "demo-dairsharaf-e2e"', `FIREBASE_PROJECT_ID = "${PROD}"`),
    'non-demo project': (t) => t.replace('FIREBASE_PROJECT_ID = "demo-dairsharaf-e2e"', 'FIREBASE_PROJECT_ID = "dairsharaf-staging"'),
    'production origin': (t) => t.replace('ALLOWED_ORIGINS = "http://localhost:3000"', 'ALLOWED_ORIGINS = "https://dairsharaf.com"'),
  };
  for (const [name, f] of Object.entries(tamper)) {
    const problems = checkWranglerFile(at(`w-${name.replace(/\W+/g, '_')}.toml`, f(base)), allowed);
    assert.ok(problems.length > 0, `not refused: ${name}`);
    refuses({ ...PLAN, wranglerFiles: [at(`p-${name.replace(/\W+/g, '_')}.toml`, f(base))] });
  }
});

test('refuses an emulator config that is not firestore-only on 127.0.0.1 with UI off', () => {
  const j = JSON.parse(readFileSync(FILES.firebaseJson, 'utf8'));
  const bad = {
    'emulator on 0.0.0.0': { ...j, emulators: { ...j.emulators, firestore: { ...j.emulators.firestore, host: '0.0.0.0' } } },
    'other port': { ...j, emulators: { ...j.emulators, firestore: { ...j.emulators.firestore, port: 8080 } } },
    'UI enabled': { ...j, emulators: { ...j.emulators, ui: { enabled: true } } },
    'auth emulator added': { ...j, emulators: { ...j.emulators, auth: { host: '127.0.0.1', port: 9099 } } },
    'hosting section': { ...j, hosting: { public: 'dist' } },
  };
  for (const [name, cfg] of Object.entries(bad)) refuses({ ...PLAN, firebaseJson: at(`f-${name.replace(/\W+/g, '_')}.json`, JSON.stringify(cfg)) }, {}, /firebase\.json/);
});

// ------------------------------------------------------------------ credential / project variables
test('refuses when ANY credential or remote-account variable is set', () => {
  for (const v of FORBIDDEN_ENV) refuses(PLAN, { [v]: 'x' }, new RegExp(v));
  for (const v of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID', 'CLOUDSDK_CORE_PROJECT']) {
    refuses(PLAN, { [v]: PROD }, new RegExp(v));
    refuses(PLAN, { [v]: 'dairsharaf-staging' }, new RegExp(v));
  }
  refuses(PLAN, { FIRESTORE_EMULATOR_HOST: '10.0.0.5:8087' }, /FIRESTORE_EMULATOR_HOST/);
  refuses(PLAN, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, /FIRESTORE_EMULATOR_HOST/);
});

test('plan ports must be valid and distinct', () => {
  refuses({ ...PLAN, ports: { ...PORTS, sink: PORTS.order } }, {}, /distinct/);
  refuses({ ...PLAN, ports: { ...PORTS, mock: 80 } }, {}, /invalid/);
});

// ------------------------------------------------------------------ runner fetch guard
test('localOnlyFetch: planned 127.0.0.1 ports pass; everything else throws BEFORE the request', async () => {
  let calls = 0;
  const spy = async () => {
    calls += 1;
    return new Response('{}');
  };
  const f = localOnlyFetch(Object.values(PORTS), spy);
  await f('http://127.0.0.1:8787/');
  await f(new URL('http://127.0.0.1:8087/v1/projects/demo-dairsharaf-e2e'));
  assert.equal(calls, 2);
  for (const u of ['https://127.0.0.1:8787/', 'http://localhost:8787/', 'http://127.0.0.1:9999/', 'https://firestore.googleapis.com/v1/x',
    'https://registry.npmjs.org/wrangler', 'https://workers.cloudflare.com/cf.json', 'https://firebase-public.firebaseio.com/cli.json', 'http://192.0.2.1:8787/']) {
    await assert.rejects(f(u), LocalE2EGuardError, u);
  }
  assert.equal(calls, 2, 'no blocked request reached the network function');
});

// ------------------------------------------------------------------ Node network jail
test('network jail (child process, real socket/DNS functions replaced by spies): external blocked + logged, loopback allowed', () => {
  const log = join(dir, 'jail.log');
  writeFileSync(log, '');
  const script = `
    const net = require('node:net'); const dns = require('node:dns'); const dgram = require('node:dgram');
    // replace the REAL functions first: nothing below can ever reach the network
    const reached = [];
    net.Socket.prototype.connect = function (...a) { reached.push('tcp'); return this; };
    dns.lookup = function (h, ...r) { reached.push('dns:' + h); const cb = r.pop(); if (typeof cb === 'function') cb(null, '127.0.0.1', 4); };
    dns.promises.lookup = async (h) => { reached.push('dnsp:' + h); return { address: '127.0.0.1', family: 4 }; };
    dns.resolve4 = function (h, cb) { reached.push('res:' + h); cb && cb(null, []); };
    dgram.Socket.prototype.send = function () { reached.push('udp'); };
    require(${JSON.stringify(FILES.jail)});
    const out = {};
    const tryIt = (k, fn) => { try { fn(); out[k] = 'allowed'; } catch (e) { out[k] = e.code || String(e); } };
    tryIt('tcp_external_host', () => new net.Socket().connect({ host: 'registry.npmjs.org', port: 443 }));
    tryIt('tcp_external_ip', () => new net.Socket().connect(443, '192.0.2.1'));
    tryIt('tcp_ipv6_external', () => new net.Socket().connect({ host: '2001:db8::1', port: 443 }));
    tryIt('tcp_normalized_args', () => new net.Socket().connect([{ host: 'firestore.googleapis.com', port: 443 }, null]));
    tryIt('tcp_loopback_v4', () => new net.Socket().connect(8787, '127.0.0.1'));
    tryIt('tcp_loopback_name', () => new net.Socket().connect({ host: 'localhost', port: 8787 }));
    tryIt('tcp_loopback_v6', () => new net.Socket().connect({ host: '::1', port: 8787 }));
    tryIt('tcp_default_host', () => new net.Socket().connect(8787));
    tryIt('ipc_pipe', () => new net.Socket().connect('\\\\\\\\.\\\\pipe\\\\x'));
    tryIt('dns_external', () => dns.lookup('workers.cloudflare.com', () => {}));
    tryIt('dns_localhost', () => dns.lookup('localhost', () => {}));
    tryIt('dns_resolve_external', () => dns.resolve4('example.com', () => {}));
    tryIt('udp_external', () => dgram.createSocket('udp4').send(Buffer.from('x'), 53, '8.8.8.8'));
    tryIt('udp_loopback', () => dgram.createSocket('udp4').send(Buffer.from('x'), 53, '127.0.0.1'));
    dns.promises.lookup('firebase-public.firebaseio.com').then(() => { out.dnsp_external = 'allowed'; }, (e) => { out.dnsp_external = e.code; })
      .finally(() => { out.reached = reached; console.log(JSON.stringify(out)); process.exit(0); });
  `;
  const r = spawnSync(process.execPath, ['-e', script], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, E2E_JAIL_LOG: log }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  for (const k of ['tcp_external_host', 'tcp_external_ip', 'tcp_ipv6_external', 'tcp_normalized_args', 'dns_external', 'dns_resolve_external', 'udp_external', 'dnsp_external']) {
    assert.equal(out[k], 'E2E_EXTERNAL_BLOCKED', k);
  }
  for (const k of ['tcp_loopback_v4', 'tcp_loopback_name', 'tcp_loopback_v6', 'tcp_default_host', 'ipc_pipe', 'dns_localhost', 'udp_loopback']) {
    assert.equal(out[k], 'allowed', k);
  }
  // only loopback reached the (spied) real functions
  assert.deepEqual(out.reached.filter((x) => !['tcp', 'udp', 'dns:localhost'].includes(x)), []);
  assert.equal(out.reached.filter((x) => x === 'tcp').length, 5);
  const logged = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(logged.length, 8, 'every blocked attempt is logged');
  assert.ok(logged.every((l) => l.startsWith('[e2e-jail] BLOCKED')));
});
