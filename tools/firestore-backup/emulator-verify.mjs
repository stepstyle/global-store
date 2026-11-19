#!/usr/bin/env node
// Restore a backup file into a FRESH local Firestore EMULATOR (free 127.0.0.1 port, demo- project) and verify every
// document. Never touches a real project. BACKUP_PASSPHRASE must be in the environment.
//   node tools/firestore-backup/emulator-verify.mjs <backup.fsbk>
import net from 'node:net';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
const free = (p) => new Promise((r) => { const s = net.createServer().once('error', () => r(false)).once('listening', () => s.close(() => r(true))).listen(p, '127.0.0.1'); });
let port = 0;
for (let p = 8500; p < 8700; p++) if (await free(p)) { port = p; break; }
if (!port) throw new Error('no free local port');
const dir = mkdtempSync(join(tmpdir(), 'fsbk-emu-'));
const cfg = join(dir, 'firebase.json');
writeFileSync(cfg, JSON.stringify({ firestore: {}, emulators: { singleProjectMode: false, firestore: { host: '127.0.0.1', port }, ui: { enabled: false } } }));
const tool = join(dirname(fileURLToPath(import.meta.url)), 'backup.mjs');
const inner = `node "${tool}" restore --in "${resolve(file)}" --emulator 127.0.0.1:${port} --project ${PROJECT} && node "${tool}" verify --in "${resolve(file)}" --emulator 127.0.0.1:${port} --project ${PROJECT}`;
console.log(`[emulator-verify] local emulator 127.0.0.1:${port}, project ${PROJECT}`);
const r = spawnSync(`npx firebase emulators:exec --only firestore --project ${PROJECT} --config "${cfg}" "${inner.replace(/"/g, '\\"')}"`, { shell: true, stdio: 'inherit' });
process.exit(r.status ?? 1);
