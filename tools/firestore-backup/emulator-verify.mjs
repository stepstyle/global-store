#!/usr/bin/env node
// Restore a backup file into a FRESH local Firestore EMULATOR (free 127.0.0.1 ports, demo- project) and verify every
// document. Never touches a real project, never reads production. BACKUP_PASSPHRASE must be in the environment.
//   node tools/firestore-backup/emulator-verify.mjs <backup.fsbk>
//
// The emulator is started directly (firebase CLI's JS entry run by THIS node, no npx, no shell, no nested quoting,
// stdin closed so nothing can wait for input), with explicit free ports for Firestore, its websocket, the hub and the
// logging service. Clear deadlines: emulator start (EMU_START_TIMEOUT_S, default 120 s) and restore+verify
// (VERIFY_TIMEOUT_S, default 600 s). At the end — success, failure, timeout or Ctrl+C — ONLY the process tree this
// script started is stopped (taskkill /T on our own child PID); other emulators / Java processes are never touched.
import net from 'node:net';
import { writeFileSync, mkdtempSync, existsSync, readFileSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('usage: emulator-verify.mjs <backup.fsbk>');
  process.exit(2);
}
if (!process.env.BACKUP_PASSPHRASE) {
  console.error('BACKUP_PASSPHRASE is not set');
  process.exit(2);
}
const PROJECT = 'demo-backup-verify';
const START_S = Number(process.env.EMU_START_TIMEOUT_S) || 120;
const VERIFY_S = Number(process.env.VERIFY_TIMEOUT_S) || 600;
const here = dirname(fileURLToPath(import.meta.url));
const { restore, verify } = await import(pathToFileURL(join(here, 'backup.mjs')).href);

const log = (m) => console.log(`[emulator-verify] ${m}`);
const fail = (m) => { console.error(`[emulator-verify] ERROR: ${m}`); return 1; };

// ---------------------------------------------------------------- firebase CLI entry (no npx / no shell)
function firebaseEntry() {
  const cands = [process.env.FIREBASE_TOOLS_JS];
  try { cands.push(createRequire(join(process.cwd(), 'x.js')).resolve('firebase-tools/lib/bin/firebase.js')); } catch {}
  if (process.env.APPDATA) cands.push(join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'));
  const found = cands.find((p) => p && existsSync(p));
  if (found) return found;
  const g = spawnSync('npm root -g', { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 });
  const p = g.stdout ? join(g.stdout.trim(), 'firebase-tools', 'lib', 'bin', 'firebase.js') : null;
  return p && existsSync(p) ? p : null;
}

// ---------------------------------------------------------------- free ports (distinct, never one an emulator holds)
const isFree = (p) => new Promise((r) => { const s = net.createServer().once('error', () => r(false)).once('listening', () => s.close(() => r(true))).listen(p, '127.0.0.1'); });
async function freePorts(n, from, to) {
  const got = [];
  for (let p = from; p < to && got.length < n; p++) if (await isFree(p)) got.push(p);
  if (got.length < n) throw new Error(`no free local ports in ${from}-${to}`);
  return got;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitReady(port, child, seconds) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (child.exitCode !== null) return `the emulator process exited early (code ${child.exitCode})`;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) });
      if (r.status < 500) return null;
    } catch {}
    await sleep(1000);
  }
  return `the Firestore emulator did not answer on 127.0.0.1:${port} within ${seconds} s`;
}

let child = null;
function stopOurEmulator() {
  if (!child || child.exitCode !== null) return;
  // only OUR child and its descendants (the firebase CLI and the Java emulator it started)
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => { stopOurEmulator(); process.exit(130); });

const tail = (f) => { try { return readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).slice(-15).join('\n'); } catch { return ''; } };

async function main() {
  const entry = firebaseEntry();
  if (!entry) return fail('firebase-tools not found (install it: npm i -g firebase-tools, or set FIREBASE_TOOLS_JS)');
  const [port, ws, hub, logging] = await freePorts(4, 18500, 18900);
  const dir = mkdtempSync(join(tmpdir(), 'fsbk-emu-'));
  const cfg = join(dir, 'firebase.json');
  writeFileSync(cfg, JSON.stringify({
    firestore: {},
    emulators: {
      singleProjectMode: false,
      firestore: { host: '127.0.0.1', port, websocketPort: ws },
      hub: { host: '127.0.0.1', port: hub },
      logging: { host: '127.0.0.1', port: logging },
      ui: { enabled: false },
    },
  }));
  const logFile = join(dir, 'emulator.log');
  const fd = openSync(logFile, 'a');
  log(`starting a local emulator on 127.0.0.1:${port} (project ${PROJECT}), start timeout ${START_S} s`);
  child = spawn(process.execPath, [entry, 'emulators:start', '--only', 'firestore', '--project', PROJECT, '--config', cfg], {
    cwd: dir, // the emulator's debug log goes here, not into the repository
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  closeSync(fd);
  try {
    const notReady = await waitReady(port, child, START_S);
    if (notReady) {
      const t = tail(logFile);
      return fail(`${notReady}. Nothing was restored.${t ? `\n--- emulator log (last lines) ---\n${t}` : ''}`);
    }
    log('emulator ready; restoring the backup into it ...');
    const emulator = `127.0.0.1:${port}`;
    const passphrase = process.env.BACKUP_PASSPHRASE;
    const work = (async () => {
      const r = await restore({ inFile: resolve(file), emulator, project: PROJECT, passphrase });
      console.log(JSON.stringify({ restored: r.documents, counts: r.counts }, null, 2));
      log('verifying every document ...');
      return verify({ inFile: resolve(file), emulator, project: PROJECT, passphrase });
    })();
    const timeout = sleep(VERIFY_S * 1000).then(() => { throw new Error(`restore + verify did not finish within ${VERIFY_S} s`); });
    const v = await Promise.race([work, timeout]);
    console.log(JSON.stringify(v, null, 2));
    return v.ok ? 0 : fail('verification found differences (see missing / extra / changed above)');
  } catch (e) {
    return fail(e.message);
  } finally {
    stopOurEmulator();
  }
}

const code = await main();
process.exit(code);
