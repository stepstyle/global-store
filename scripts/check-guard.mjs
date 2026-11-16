#!/usr/bin/env node
// scripts/check-guard.mjs — static proof that a built bundle is (or is not) a sandbox build.
//
//   node scripts/check-guard.mjs [distDir=dist] [--expect sandbox|production]
//
// sandbox    (default): FAIL if ANY production marker is found in any built file.
// production          : FAIL if the production Firebase config or the tracking tags are MISSING (guards against a
//                       production build that was accidentally built as sandbox and would show an empty store).
//
// Markers: the production Firebase web-config identifiers (read from src/services/firebase.ts at run time, never
// printed), Worker hosts, tracking tags, and the value of every VITE_* variable present in this process's
// environment (so on a CI/Vercel build machine the real project values are checked without being known here).
// Output = marker NAMES and file counts only. Values are never printed.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const expect = args.includes('--expect') ? args[args.indexOf('--expect') + 1] : 'sandbox';
const dist = resolve(ROOT, args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--expect') || 'dist');
if (!['sandbox', 'production'].includes(expect)) { console.error('--expect must be sandbox or production'); process.exit(2); }
if (!existsSync(dist)) { console.error(`[check-guard] no build at ${relative(ROOT, dist) || dist}`); process.exit(2); }

/** production Firebase identifiers, taken from the source so this file holds no copy of them */
export function firebaseMarkers(source) {
  const out = [];
  for (const key of ['apiKey', 'projectId', 'appId', 'messagingSenderId']) {
    const re = new RegExp(`\\b${key}\\s*:\\s*['"]([^'"\\n]{6,})['"]`, 'g');
    for (const m of source.matchAll(re)) if (!/import\.meta|your-|PLACEHOLDER/i.test(m[1])) out.push({ name: `firebase.${key}`, value: m[1] });
  }
  return out;
}

const fbSource = readFileSync(join(ROOT, 'src/services/firebase.ts'), 'utf8');
const markers = [
  ...firebaseMarkers(fbSource),
  { name: 'worker host (workers.dev)', value: 'workers.dev' },
  { name: 'Google Analytics tag', value: 'googletagmanager.com' },
  { name: 'Meta Pixel loader', value: 'connect.facebook.net' },
  { name: 'Meta Pixel init', value: "fbq('init'" },
  ...Object.entries(process.env)
    .filter(([k, v]) => k.startsWith('VITE_') && typeof v === 'string' && v.trim().length >= 8)
    .map(([k, v]) => ({ name: `env ${k}`, value: v.trim() })),
];
if (!markers.some((m) => m.name === 'firebase.projectId')) { console.error('[check-guard] could not read the Firebase markers from source'); process.exit(2); }

const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk(dist);
const texts = files.filter((f) => /\.(js|mjs|css|html|json|txt|map|webmanifest|svg)$/i.test(f)).map((f) => [f, readFileSync(f, 'utf8')]);

const hits = markers.map((m) => ({ name: m.name, files: texts.filter(([, t]) => t.includes(m.value)).length }));
let failed = false;
console.log(`[check-guard] ${relative(ROOT, dist) || dist}: ${texts.length} text files, expecting ${expect.toUpperCase()}`);
for (const h of hits) {
  let bad;
  if (expect === 'sandbox') bad = h.files > 0;
  else bad = h.files === 0 && (h.name === 'firebase.projectId' || h.name === 'firebase.apiKey' || h.name === 'Google Analytics tag');
  if (bad) failed = true;
  console.log(`  ${bad ? 'FAIL' : 'ok  '} ${h.name.padEnd(28)} found in ${h.files} file(s)`);
}
console.log(failed ? '[check-guard] FAILED' : '[check-guard] passed');
process.exit(failed ? 1 : 0);
