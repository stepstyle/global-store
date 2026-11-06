// LOCAL end-to-end run of scenarios S01–S12 — no cloud, no credentials, no external network.
//   node test/local-e2e/run.mjs            (from workers/order-worker)
//   E2E_ONLY=S01,S08 node test/local-e2e/run.mjs
//
// 1. Guard: demo- project, 127.0.0.1-only URLs/files, no credential variables  -> refuse before anything starts
// 2. All planned ports must be free (nothing is killed to free them)
// 3. Isolation: empty temporary config dir for firebase-tools and wrangler (your logins are never loaded),
//    update checks / telemetry / cf.json fetch off, and a Node network jail in every Node process
// 4. Socket monitor for native processes (workerd, java)
// 5. firebase emulators:exec (Firestore only, demo project) -> inner.mjs -> wrangler dev --local x2 -> scenarios
// 6. Cleanup: only processes started by this run; ports must be free again
// 7. Report: scenarios, blocked attempts, remote connections, tool state unchanged

import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { assertLocalPlan, FORBIDDEN_ENV, LocalE2EGuardError } from './guard.mjs';
import { PLAN, PORTS, FILES, PROJECT_ID, WORKER_ROOT } from './plan.mjs';

createRequire(import.meta.url)(FILES.jail); // this process is jailed too
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (s) => console.log(`[local-e2e] ${s}`);

// ---------------------------------------------------------------- 1. guard
try {
  assertLocalPlan(PLAN, process.env);
} catch (e) {
  console.error(e instanceof LocalE2EGuardError ? e.message : e);
  process.exit(2);
}
if (process.platform !== 'win32') say('note: process-tree monitor is Windows-only; Node jail still applies');

// ---------------------------------------------------------------- 2. ports
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}
const busy = [];
for (const [k, p] of Object.entries(PORTS)) if (!(await portFree(p))) busy.push(`${k}=${p}`);
if (busy.length) {
  console.error(`[local-e2e] REFUSED: ports already in use: ${busy.join(', ')} — nothing was started or stopped`);
  process.exit(2);
}
say(`guard OK (project ${PROJECT_ID}); all ${Object.keys(PORTS).length} planned ports free on 127.0.0.1`);

// ---------------------------------------------------------------- 3. isolation
const TMP = mkdtempSync(join(tmpdir(), 'dairsharaf-local-e2e-'));
const XDG = join(TMP, 'xdg');
mkdirSync(join(XDG, 'configstore'), { recursive: true });
// firebase-tools fetches a "message of the day" from firebase-public.firebaseio.com unless a fresh one is cached:
// pre-seed the (temporary, empty) store so it does not. Your real firebase-tools store is not touched.
writeFileSync(join(XDG, 'configstore', 'firebase-tools.json'), JSON.stringify({ motd: { fetched: Date.now() } }));
const JAIL_LOG = join(TMP, 'jail.log');
writeFileSync(JAIL_LOG, '');
const RESULT = join(TMP, 'result.json');
const MONITOR = join(TMP, 'monitor.jsonl');

// state of the REAL tool config, compared after the run (metadata only — no file content is read)
const realFirebaseStore = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
const realWranglerLogs = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'xdg.config', '.wrangler', 'logs');
const statOf = (p) => (existsSync(p) ? `${statSync(p).size}:${statSync(p).mtimeMs}` : 'absent');
const listOf = (d) => (existsSync(d) ? readdirSync(d).sort().join('|') : 'absent');
const before = { firebase: statOf(realFirebaseStore), wranglerLogs: listOf(realWranglerLogs) };

const env = { ...process.env };
for (const v of [...FORBIDDEN_ENV, 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID', 'CLOUDSDK_CORE_PROJECT', 'FIRESTORE_EMULATOR_HOST']) delete env[v];
Object.assign(env, {
  NODE_OPTIONS: `--require=${FILES.jail}`,
  E2E_JAIL_LOG: JAIL_LOG,
  E2E_TMP: TMP,
  E2E_RESULT_FILE: RESULT,
  XDG_CONFIG_HOME: XDG, // firebase-tools + wrangler config/login stores -> empty temp dir
  NO_UPDATE_NOTIFIER: '1', // firebase-tools update check
  WRANGLER_HIDE_BANNER: 'true', // wrangler banner update check (registry.npmjs.org)
  WRANGLER_SEND_METRICS: 'false', // wrangler telemetry
  CLOUDFLARE_CF_FETCH_ENABLED: 'false', // miniflare request.cf download (workers.cloudflare.com)
  CI: '1',
  FORCE_COLOR: '0',
});

// ---------------------------------------------------------------- 4. monitor
let monitor = null;
if (process.platform === 'win32') {
  monitor = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', FILES.monitor, '-RootPid', String(process.pid), '-OutFile', MONITOR], { stdio: 'ignore' });
  for (let i = 0; i < 40 && !existsSync(MONITOR); i++) await sleep(250);
  if (!existsSync(MONITOR)) {
    console.error('[local-e2e] REFUSED: socket monitor did not start');
    process.exit(2);
  }
}

// ---------------------------------------------------------------- 5. run
say(`temp dir ${TMP}`);
say('starting Firestore emulator (demo project) -> wrangler dev --local (sink + order) -> scenarios S01–S12');
const t0 = Date.now();
const inner = FILES.inner.replace(/\\/g, '/');
// the UI suite also needs the Auth emulator (real sign-in in the browser); other suites stay Firestore-only
const only = (process.env.E2E_SUITE || 'all') === 'ui' ? '"firestore,auth"' : 'firestore';
// websocket port override (plan.mjs): a temporary copy of firebase.json, everything else identical
let firebaseJson = FILES.firebaseJson;
if (PORTS.emulatorWs !== 9152) {
  const j = JSON.parse(readFileSync(FILES.firebaseJson, 'utf8'));
  j.emulators.firestore.websocketPort = PORTS.emulatorWs;
  firebaseJson = join(TMP, 'firebase.json');
  writeFileSync(firebaseJson, JSON.stringify(j, null, 2));
  say(`emulator websocket port ${PORTS.emulatorWs} (E2E_EMULATOR_WS_PORT)`);
}
const cmd = `firebase emulators:exec --only ${only} --project ${PROJECT_ID} --config "${firebaseJson}" "node ${inner}"`;
const child = spawn(cmd, { cwd: WORKER_ROOT, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
const echo = (d) => {
  const s = String(d);
  out += s;
  for (const l of s.split(/\r?\n/)) if (/^(✔|✖|\s{4}\S|local-e2e:|\[inner\])/.test(l)) console.log(l.replace(/PROBE_PRIVATE_KEY\S*/g, 'PROBE_PRIVATE_KEY:<redacted>'));
};
child.stdout.on('data', echo);
child.stderr.on('data', echo);
const code = await new Promise((r) => child.on('close', r));
writeFileSync(join(TMP, 'emulators-exec.log'), out);

// ---------------------------------------------------------------- 6. cleanup (own processes only)
let tracked = new Map();
const readMonitor = () => {
  const lines = existsSync(MONITOR) ? readFileSync(MONITOR, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const ev = lines.map((l) => {
    try {
      return JSON.parse(l.replace(/^﻿/, ''));
    } catch {
      return null;
    }
  }).filter(Boolean);
  tracked = new Map(ev.filter((e) => e.type === 'pid').map((e) => [e.pid, e.name]));
  trackedCreated = new Map(ev.filter((e) => e.type === 'pid').map((e) => [e.pid, e.created || null]));
  return ev;
};
let trackedCreated = new Map();
/** start time (UTC ISO, ms — same format as monitor.ps1) of the process that owns `pid` NOW, or null */
const createdNow = (pid) => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" -Property CreationDate; if ($p) { ([datetime]$p.CreationDate).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }`], { encoding: 'utf8' });
  return String(r.stdout || '').trim() || null;
};
const listening = (port) => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess) -join ','`], { encoding: 'utf8' });
  return String(r.stdout || '').trim().split(',').filter(Boolean).map(Number);
};
const leftovers = [];
if (process.platform === 'win32') {
  await sleep(1500);
  readMonitor();
  for (const [k, p] of Object.entries(PORTS)) {
    for (const pid of listening(p)) {
      // only OUR process: same PID AND same start time (a re-used PID belongs to another program -> never stopped)
      if (tracked.has(pid) && trackedCreated.get(pid) && createdNow(pid) === trackedCreated.get(pid)) {
        spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
        leftovers.push(`${k}=${p} held by our ${tracked.get(pid)} (pid ${pid}) -> stopped`);
      } else if (tracked.has(pid)) {
        leftovers.push(`${k}=${p} held by pid ${pid}: PID was ours but the process identity differs (re-used) -> left untouched`);
      } else {
        leftovers.push(`${k}=${p} held by pid ${pid} NOT started by this run -> left untouched`);
      }
    }
  }
  writeFileSync(`${MONITOR}.stop`, '');
  for (let i = 0; i < 20 && monitor && monitor.exitCode === null; i++) await sleep(250);
  if (monitor && monitor.exitCode === null) spawnSync('taskkill', ['/pid', String(monitor.pid), '/T', '/F'], { stdio: 'ignore' });
}
const stillBusy = [];
for (const [k, p] of Object.entries(PORTS)) if (!(await portFree(p))) stillBusy.push(`${k}=${p}`);

// ---------------------------------------------------------------- 7. report
const events = readMonitor();
// a connection whose owner could not be re-identified counts as a violation (fail-safe)
const violations = events.filter((e) => e.type === 'violation' || e.type === 'unverified');
// PID now owned by a DIFFERENT program (other start time/path): not a test process — reported with evidence, never hidden
const pidReused = events.filter((e) => e.type === 'pid_reused');
const jail = readFileSync(JAIL_LOG, 'utf8').split(/\r?\n/).filter(Boolean);
const res = existsSync(RESULT) ? JSON.parse(readFileSync(RESULT, 'utf8')) : { results: [], fatal: 'inner run produced no result file', mock: {} };
const after = { firebase: statOf(realFirebaseStore), wranglerLogs: listOf(realWranglerLogs) };
const isolatedWranglerLogs = listOf(join(XDG, '.wrangler', 'logs'));
const names = [...new Set([...tracked.values()])].sort();

const passed = res.results.filter((r) => r.ok).length;
const cpuMode = res.mode === 'cpu';
const cpuLines = !res.cpu ? [] : [
  `CPU (ESTIMATE, local workerd on this PC — not Cloudflare): ${res.cpu.method}`,
  `  idle CPU of order workerd: ${res.cpu.idleCpuMsPerSecond} ms/s; pids order=${res.cpu.orderPids.join(',')} probe=${res.cpu.probePids.join(',')}`,
  ...res.cpu.rows.map((r) => `  ${String(r.estMsPerOp).padStart(7)} ms/op (raw ${String(r.rawMsPerOp).padStart(7)})  n=${String(r.n).padEnd(3)}  ${r.label}`),
];
const lines = [
  '',
  `================ LOCAL E2E REPORT (${cpuMode ? 'CPU measurement' : 'scenarios'}) ================`,
  cpuMode ? `cpu measurement: ${res.cpu ? 'completed' : 'NOT completed'}${res.fatal ? `  (FATAL: ${res.fatal})` : ''}` : `scenarios: ${passed}/${res.results.length} passed${res.fatal ? `  (FATAL: ${res.fatal})` : ''}`,
  ...cpuLines,
  ...res.results.map((r) => `  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.name}${r.ok ? '' : `\n          ${r.error.split('\n')[0]}`}`),
  `duration: ${((Date.now() - t0) / 1000).toFixed(0)} s, emulators:exec exit code ${code}`,
  `isolation — external attempts blocked by the Node jail: ${jail.length}`,
  ...jail.map((l) => `    ${l}`),
  `isolation — non-loopback TCP connections seen by the monitor: ${process.platform === 'win32' ? violations.length : 'n/a'}`,
  ...violations.map((v) => `    [${v.type}] ${v.name} (pid ${v.pid}, started ${v.tracked?.created ?? '?'}) -> ${v.remote} ${v.state} at ${v.at ?? '?'}`),
  `isolation — connections by a RE-USED pid (another program, not ours): ${pidReused.length}`,
  ...pidReused.map((v) => `    pid ${v.pid} -> ${v.remote} ${v.state} at ${v.at}: ours was ${v.tracked?.name} started ${v.tracked?.created} (${v.tracked?.path || 'path n/a'}); NOW ${v.current?.name} started ${v.current?.created} (${v.current?.path || 'path n/a'}, parent ${v.current?.parent})`),
  `isolation — processes monitored: ${tracked.size} (${names.join(', ')})`,
  `isolation — unexpected calls to the local mock: ${(res.mock?.unexpected || []).length}; turnstile verifications: ${res.mock?.turnstile ?? 0}`,
  `your firebase-tools login store unchanged: ${before.firebase === after.firebase ? 'yes' : 'NO'}`,
  `your wrangler logs dir unchanged (no wrangler run used your config): ${before.wranglerLogs === after.wranglerLogs ? 'yes' : 'NO'}`,
  `wrangler used the temporary config dir: ${isolatedWranglerLogs !== 'absent' ? 'yes' : 'not observed'}`,
  `cleanup — leftovers: ${leftovers.length ? leftovers.join('; ') : 'none'}; ports still busy: ${stillBusy.length ? stillBusy.join(', ') : 'none'}`,
  `logs: ${TMP}`,
];
console.log(lines.join('\n'));

// a desktop browser or an updater in the test's process tree means the browser isolation cannot be guaranteed
const FORBIDDEN_PROCS = ['chrome.exe', 'msedge.exe', 'updater.exe', 'googleupdate.exe', 'microsoftedgeupdate.exe'];
const forbiddenSeen = names.filter((n) => FORBIDDEN_PROCS.includes(String(n).toLowerCase()));
console.log(`isolation — desktop browser / updater processes in the test tree: ${forbiddenSeen.length ? forbiddenSeen.join(', ') : 'none'}`);
const isolationOk = jail.length === 0 && violations.length === 0 && forbiddenSeen.length === 0 && before.firebase === after.firebase && before.wranglerLogs === after.wranglerLogs;
const workOk = cpuMode ? !!res.cpu : res.results.length > 0 && passed === res.results.length;
const ok = code === 0 && !res.fatal && workOk && isolationOk && stillBusy.length === 0;
console.log(ok ? 'RESULT: PASS' : `RESULT: FAIL${isolationOk ? '' : ' (isolation)'}`);
process.exit(ok ? 0 : 1);
