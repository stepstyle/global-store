// Vite guard (fail-closed) for the Firebase target. Used by vite.config.ts; unit-tested with node --test.
//
// - `vite` (dev server):   refuses to start unless the env selects the Firebase Emulator with a demo- project
//                          (src/services/firebaseTarget.ts rules), every VITE_ URL is 127.0.0.1, and no VITE_
//                          value contains a production identifier, the production site or a workers.dev Worker.
// - `vite build`:          unchanged for production (no new variable needed). Refused only when an emulator /
//                          local-only setting would end up in a Vercel build, or the target is unknown.
// - `vite preview`:        serves only an output folder that this plugin recorded as an EMULATOR build;
//                          a production build, or an unknown/old folder, is refused (fail-closed).
//                          The record lives in node_modules/.cache (never inside the deployed bundle).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveFirebaseTarget, FirebaseTargetError, type FirebaseWebConfig } from '../src/services/firebaseTarget.ts';

export type EnvMap = Record<string, string | undefined>;

/** Production web config, read locally from src/services/firebase.ts (no network). Null if it cannot be read. */
export function readProductionConfig(root: string): FirebaseWebConfig | null {
  try {
    const src = readFileSync(resolve(root, 'src/services/firebase.ts'), 'utf8');
    const pick = (k: string) => (src.match(new RegExp(`\\b${k}:\\s*['"]([^'"]+)['"]`)) || [])[1] || '';
    const cfg = {
      apiKey: pick('apiKey'),
      authDomain: pick('authDomain'),
      projectId: pick('projectId'),
      storageBucket: pick('storageBucket'),
      messagingSenderId: pick('messagingSenderId'),
      appId: pick('appId'),
      measurementId: pick('measurementId'),
      databaseURL: pick('databaseURL'),
    };
    return cfg.projectId && cfg.apiKey ? cfg : null;
  } catch {
    return null;
  }
}

const LOCAL_URL_RE = /^http:\/\/127\.0\.0\.1:\d{2,5}(\/\S*)?$/;

export function checkDevEnv(env: EnvMap, prod: FirebaseWebConfig | null): string[] {
  const p: string[] = [];
  if (!prod) p.push('cannot read the production Firebase identifiers from src/services/firebase.ts — refusing (fail-closed)');
  try {
    resolveFirebaseTarget({ isDev: true, env, productionConfig: prod, localOverride: null });
  } catch (e) {
    if (e instanceof FirebaseTargetError) p.push(...e.problems);
    else p.push(String((e as Error)?.message || e));
  }
  for (const [k, raw] of Object.entries(env)) {
    if (!k.startsWith('VITE_')) continue;
    const v = String(raw ?? '').trim();
    if (!v) continue;
    if (/dairsharaf\.com/i.test(v)) p.push(`${k} references the production site`);
    if (/\.workers\.dev/i.test(v)) p.push(`${k} points to a deployed Cloudflare Worker`);
    if (/^[a-z]+:\/\//i.test(v) && !LOCAL_URL_RE.test(v)) p.push(`${k} must be http://127.0.0.1:<port> in local development`);
  }
  return [...new Set(p)];
}

export function checkBuildEnv(env: EnvMap, { isVercel }: { isVercel: boolean }): string[] {
  const p: string[] = [];
  const target = String(env.VITE_FIREBASE_TARGET ?? '').trim().toLowerCase();
  // every VITE_ variable is shipped to every visitor (firebase.ts passes import.meta.env as a whole): a secret-looking
  // name is refused in ANY build (e.g. VITE_GEMINI_API_KEY, VITE_*_TOKEN) — public identifiers only
  for (const k of Object.keys(env)) {
    if (k.startsWith('VITE_') && /SECRET|TOKEN|PRIVATE|PASSWORD|GEMINI|SENDGRID|SERVICE_ACCOUNT/i.test(k) && String(env[k] ?? '').trim()) {
      p.push(`${k} looks like a secret — VITE_ variables are public in the browser bundle; refusing the build`);
    }
  }
  if (target === 'staging') p.push('VITE_FIREBASE_TARGET=staging is for the local dev server only — never a build');
  else if (!['', 'production', 'emulator'].includes(target)) p.push(`unknown VITE_FIREBASE_TARGET "${target}"`);
  if (isVercel) {
    if (target === 'emulator') p.push('VITE_FIREBASE_TARGET=emulator must never reach a Vercel build');
    for (const [k, raw] of Object.entries(env)) {
      if (k.startsWith('VITE_') && /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(String(raw ?? '').trim())) p.push(`${k} points to a local address in a Vercel build`);
    }
  }
  return p;
}

// ---- production trackers: never loaded by the LOCAL dev server -----------------------------------------------
// index.html loads the store's real Google Analytics + Meta Pixel. A local session (emulator or staging) must not
// send page views to them. The dev server serves the page WITHOUT them; production builds are untouched.
const TRACKER_TRACE_RE = /googletagmanager\.com|google-analytics\.com|connect\.facebook\.net|facebook\.com\/tr|\bfbq\(|\bgtag\(/i;

/** Removes the tracker <script>/<noscript> blocks. Throws (fail-closed) if any trace is left afterwards. */
export function stripProductionTrackers(html: string): string {
  const out = html
    .replace(/<script\b[^>]*\bsrc=["'][^"']*(?:googletagmanager\.com|google-analytics\.com|connect\.facebook\.net)[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?(?:\bgtag\(|\bfbq\(|connect\.facebook\.net|googletagmanager\.com)(?:(?!<\/script>)[\s\S])*<\/script>/gi, '')
    .replace(/<noscript\b[^>]*>(?:(?!<\/noscript>)[\s\S])*?facebook\.com\/tr(?:(?!<\/noscript>)[\s\S])*<\/noscript>/gi, '');
  if (TRACKER_TRACE_RE.test(out)) throw new Error('FIREBASE ENV GUARD REFUSED (dev server): a production tracker is still in index.html after stripping — refusing to serve it');
  return out;
}

// ---- build-target records (outside the bundle) --------------------------------------------------------------
export const recordFile = (root: string) => resolve(root, 'node_modules/.cache/firebase-env-guard/build-targets.json');
const norm = (p: string) => resolve(p).toLowerCase();

function readRecords(root: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(recordFile(root), 'utf8'));
  } catch {
    return {};
  }
}

/** Remember which Firebase target an output folder was built for. Never fails a build. */
export function recordBuildTarget(root: string, outDir: string, target: string): void {
  try {
    const f = recordFile(root);
    const rec = readRecords(root);
    rec[norm(outDir)] = target;
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(rec, null, 2));
  } catch {}
}

export function checkPreviewDist(root: string, outDir: string): string[] {
  if (!existsSync(outDir)) return [`nothing to preview in ${outDir}`];
  const target = readRecords(root)[norm(outDir)];
  if (target === 'emulator') return [];
  if (target === undefined) return ['this output folder has no recorded build target (old or foreign build) — local preview refused; rebuild with the emulator env (.env.example)'];
  return [`this output folder is a ${target.toUpperCase()} build (it talks to the production Firebase project) — local preview refused; rebuild with the emulator env`];
}

type ConfigEnv = { command: 'build' | 'serve'; mode: string; isPreview?: boolean };
type LoadEnv = (mode: string, dir: string, prefixes?: string | string[]) => Record<string, string>;
type ResolvedConfig = { root: string; build: { outDir: string } };

const refuse = (kind: string, mode: string, problems: string[]) => {
  if (problems.length) {
    throw new Error(`FIREBASE ENV GUARD REFUSED (${kind}, mode "${mode}"):\n - ${problems.join('\n - ')}\nSee .env.example.`);
  }
};

/** `vite --mode staging` reads env files from this folder ONLY (vite.config.ts envDir) — never the repository root. */
export const STAGING_ENV_DIR = 'env/staging';

/**
 * The env folder Vite will use, and whether this mode/target may use it. mode "staging" MUST use env/staging (checked
 * BEFORE anything is loaded, so a misconfigured staging run never reads the root .env files); the staging target may
 * only come from env/staging.
 */
export function envDirProblems(root: string, mode: string, envDir: string): string[] {
  const staging = norm(resolve(root, STAGING_ENV_DIR));
  if (mode === 'staging' && norm(envDir) !== staging) return [`mode "staging" must read env files only from ${STAGING_ENV_DIR}/ (vite.config.ts envDir) — refusing before loading anything`];
  return [];
}

export function firebaseEnvGuard({ root, loadEnv }: { root: string; loadEnv: LoadEnv }) {
  let seen: ConfigEnv | null = null;
  let buildTarget = 'production';
  let outDir = '';
  return {
    name: 'firebase-env-guard',
    config(userConfig: { envDir?: string | false } | undefined, cfgEnv: ConfigEnv) {
      seen = cfgEnv;
      const { command, mode, isPreview } = cfgEnv;
      // the SAME folder Vite loads from (default: the root — unchanged for every mode but "staging")
      const envDir = typeof userConfig?.envDir === 'string' ? resolve(root, userConfig.envDir) : root;
      const fromStagingDir = norm(envDir) === norm(resolve(root, STAGING_ENV_DIR));
      if (command === 'build') {
        refuse('build', mode, envDirProblems(root, mode, envDir));
        const env = loadEnv(mode, envDir, 'VITE_');
        refuse('build', mode, checkBuildEnv(env, { isVercel: process.env.VERCEL === '1' }));
        buildTarget = String(env.VITE_FIREBASE_TARGET ?? '').trim().toLowerCase() === 'emulator' ? 'emulator' : 'production';
      } else if (!isPreview) {
        refuse('dev server', mode, envDirProblems(root, mode, envDir));
        const env = loadEnv(mode, envDir, 'VITE_');
        const problems = checkDevEnv(env, readProductionConfig(root));
        if (String(env.VITE_FIREBASE_TARGET ?? '').trim().toLowerCase() === 'staging' && !fromStagingDir) {
          problems.push(`VITE_FIREBASE_TARGET=staging only via npm run dev:staging (env files in ${STAGING_ENV_DIR}/)`);
        }
        refuse('dev server', mode, problems);
      }
    },
    configResolved(resolved: ResolvedConfig) {
      outDir = resolve(resolved.root, resolved.build.outDir);
      // preview: check the folder that will actually be served (CLI --outDir included)
      if (seen?.isPreview) refuse('preview', seen.mode, checkPreviewDist(root, outDir));
    },
    // dev server only: the page is served without the production trackers (builds keep index.html unchanged)
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string) {
        if (seen?.command !== 'serve' || seen?.isPreview) return html;
        return stripProductionTrackers(html);
      },
    },
    // build: record the target of this output folder (outside the bundle; never fails the build)
    closeBundle() {
      if (seen?.command === 'build' && outDir) recordBuildTarget(root, outDir, buildTarget);
    },
  };
}
