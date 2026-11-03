// Live account checks for staging scripts — verify WHOSE permissions a CLI will use, right before using them.
// A Worker name or project id alone is not enough: the same name could be deployed into the wrong account.
//
// Rules (no defaults, ever):
//  - Cloudflare: `wrangler whoami --json` must show exactly ONE account, equal to cfg.cloudflareAccountId,
//    and the login e-mail must equal cfg.cloudflareLoginEmail. CLOUDFLARE_ACCOUNT_ID is pinned for every
//    wrangler call; global-API-key variables are refused.
//  - Firebase: every firebase-tools call carries --account <cfg.firebaseAccountEmail>; FIREBASE_TOKEN (which
//    overrides --account in firebase-tools) is refused and stripped; `projects:list --json --account …` must
//    include the staging project and must NOT include the production project.
// Both commands only read account metadata; neither touches the production project.

import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROD_PROJECT_ID } from '../src/config.js';
import { StagingGuardError, REPO_ROOT } from './guard.mjs';

export const WRANGLER = resolve(REPO_ROOT, 'workers/order-worker/node_modules/wrangler/bin/wrangler.js');

// Wrangler auth through a Global API Key (current + legacy names) — broad, account-wide, not allowed here.
const CF_GLOBAL_KEY_VARS = ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CF_API_KEY', 'CF_EMAIL'];
// Variables that would make firebase-tools ignore --account or target another project.
const FIREBASE_OVERRIDE_VARS = ['FIREBASE_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT', 'CLOUDSDK_CORE_ACCOUNT', 'FIREBASE_PROJECT_ID'];

const PIPE = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };

function parseJsonOutput(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** Environment for every wrangler call: account pinned, global-key auth refused. */
export function wranglerEnv(st, env = process.env) {
  const p = [];
  for (const v of CF_GLOBAL_KEY_VARS) if (env[v]) p.push(`environment variable ${v} is set — Global API Key auth is not allowed for staging`);
  for (const v of ['CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID']) {
    if (env[v] && env[v] !== st.cloudflareAccountId) p.push(`environment variable ${v} points to another Cloudflare account`);
  }
  if (p.length) throw new StagingGuardError(p);
  const out = { ...env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_ACCOUNT_ID: st.cloudflareAccountId };
  delete out.CF_ACCOUNT_ID;
  return out;
}

/** Environment for every firebase-tools call: nothing that could override --account / --project. */
export function firebaseEnv(env = process.env) {
  if (env.FIREBASE_TOKEN) throw new StagingGuardError(['environment variable FIREBASE_TOKEN is set — it overrides --account in firebase-tools; unset it']);
  const out = { ...env };
  for (const v of FIREBASE_OVERRIDE_VARS) delete out[v];
  return out;
}

export function firebaseSpawnOptions(env) {
  return { env: firebaseEnv(env), shell: process.platform === 'win32' };
}

/** Throws unless the wrangler credentials belong to exactly the configured staging account. */
export function verifyCloudflareAccount(st, { env = process.env, spawn = spawnSync } = {}) {
  const runEnv = wranglerEnv(st, env);
  const r = spawn(process.execPath, [WRANGLER, 'whoami', '--json'], { ...PIPE, env: runEnv });
  const info = parseJsonOutput(r?.stdout);
  if ((r?.status ?? 1) !== 0 || !info || info.loggedIn !== true) {
    throw new StagingGuardError(['Cloudflare: wrangler is not logged in (log in with the STAGING Cloudflare account first)']);
  }
  const p = [];
  const accounts = Array.isArray(info.accounts) ? info.accounts : [];
  const ids = accounts.map((a) => String(a?.id || ''));
  if (accounts.length !== 1) {
    p.push(`Cloudflare: these credentials can access ${accounts.length} account(s); exactly one — the staging account — is required`);
  }
  if (!ids.includes(st.cloudflareAccountId)) p.push('Cloudflare: the logged-in credentials are not for the configured staging account');
  const email = String(info.email || '').toLowerCase();
  if (!email) p.push('Cloudflare: login e-mail not reported (use `wrangler login` with the staging account)');
  else if (email !== st.cloudflareLoginEmail) p.push('Cloudflare: logged-in e-mail differs from cloudflareLoginEmail');
  if (p.length) throw new StagingGuardError(p);
  return { accountId: ids[0], email, authType: info.authType, env: runEnv };
}

/** Throws unless --account <firebaseAccountEmail> works, sees the staging project and does NOT see production. */
export function verifyFirebaseAccount(st, { env = process.env, spawn = spawnSync } = {}) {
  const opts = firebaseSpawnOptions(env);
  const r = spawn('firebase', ['projects:list', '--json', '--account', st.firebaseAccountEmail], { ...PIPE, ...opts });
  const out = parseJsonOutput(r?.stdout);
  if ((r?.status ?? 1) !== 0 || !out || out.status !== 'success' || !Array.isArray(out.result)) {
    throw new StagingGuardError(['Firebase: the configured staging account is not logged in to firebase-tools (use `firebase login:add`)']);
  }
  const ids = out.result.map((x) => String(x?.projectId || ''));
  const p = [];
  if (!ids.includes(st.projectId)) p.push(`Firebase: account ${st.firebaseAccountEmail} cannot see project ${st.projectId}`);
  if (ids.includes(PROD_PROJECT_ID)) p.push('Firebase: this account can access the PRODUCTION project — use the separate staging account');
  if (p.length) throw new StagingGuardError(p);
  return { projects: ids.length };
}
