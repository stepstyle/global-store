#!/usr/bin/env node
// scripts/build-hosting.mjs — the approved PRODUCTION build for a manual (non-Vercel) release, e.g. Firebase Hosting.
//   npm run build:hosting
// Plain `npm run build` off Vercel produces a SANDBOX bundle by design (fail-closed). This script is the explicit
// opt-in: it builds with STORE_BUILD_TARGET=production, then refuses to finish unless check-guard confirms the
// output really is a production bundle (Firebase config + tracking present). It cannot run on Vercel Preview:
// there VERCEL_ENV decides and STORE_BUILD_TARGET is ignored.
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.VERCEL === '1' || process.env.VERCEL_ENV !== undefined) {
  console.error('[build:hosting] refusing to run on Vercel — Vercel builds use `npm run build` and VERCEL_ENV.');
  process.exit(1);
}
const env = { ...process.env, STORE_BUILD_TARGET: 'production' };
const run = (args) => spawnSync(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' }).status;

if (run([join(ROOT, 'node_modules/vite/bin/vite.js'), 'build']) !== 0) process.exit(1);
if (run([join(ROOT, 'scripts/check-guard.mjs'), 'dist', '--expect', 'production']) !== 0) {
  console.error('[build:hosting] the build is NOT a production bundle — do not deploy it.');
  process.exit(1);
}
console.log('[build:hosting] production bundle verified in dist/');
