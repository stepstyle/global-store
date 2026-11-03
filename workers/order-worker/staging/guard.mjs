// Staging guard: every staging script calls this BEFORE any network or deploy operation.
// It refuses (throws StagingGuardError) on anything that could reach production.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROD_PROJECT_ID, STAGING_PROJECT_RE, SINK_HOST_RE } from '../src/config.js';

export const PROD_WORKER_NAME = 'anta-order-notify';
export const STAGING_WORKER_NAME = 'anta-order-notify-staging';
export const SINK_WORKER_NAME = 'anta-notify-sink-staging';
export const STAGING_WORKER_HOST_RE = /^anta-order-notify-staging\.([a-z0-9-]+)\.workers\.dev$/;
const SINK_HOST_CAPTURE = /^anta-notify-sink-staging\.([a-z0-9-]+)\.workers\.dev$/;
const MIN_TOKEN = 24;
export const CF_ACCOUNT_ID_RE = /^[0-9a-f]{32}$/;
// Deliberately narrow (no quotes, spaces or shell metacharacters): the value is passed to CLIs as an argument.
export const EMAIL_RE = /^[a-z0-9._+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export class StagingGuardError extends Error {
  constructor(problems) {
    super(`STAGING GUARD REFUSED:\n - ${problems.join('\n - ')}`);
    this.problems = problems;
  }
}

function plainHttpsHost(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:' || x.username || x.password || x.port) return null;
    return x.hostname;
  } catch {
    return null;
  }
}

/** Identifiers of the production web app, read from the app source (local file only, no network). */
export function productionWebIdentifiers(repoRoot = REPO_ROOT) {
  try {
    const src = readFileSync(resolve(repoRoot, 'src/services/firebase.ts'), 'utf8');
    const pick = (k) => (src.match(new RegExp(`${k}:\\s*['"]([^'"]+)['"]`)) || [])[1];
    return [pick('apiKey'), pick('appId'), pick('messagingSenderId'), pick('authDomain'), PROD_PROJECT_ID].filter(Boolean);
  } catch {
    return [PROD_PROJECT_ID];
  }
}

const isInside = (child, parent) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/**
 * Validates a staging config object. Returns a frozen normalized copy or throws.
 * @param cfg  { projectId, workerUrl, sinkUrl, serviceAccountKeyPath, firebaseWebConfig, tokens? }
 * @param opts { repoRoot, env, requireTokens }
 */
export function assertStagingConfig(cfg, { repoRoot = REPO_ROOT, env = process.env, requireTokens = false } = {}) {
  const p = [];
  if (!cfg || typeof cfg !== 'object') throw new StagingGuardError(['config missing']);

  // 1. Production identifiers must not appear anywhere in the config.
  const blob = JSON.stringify(cfg);
  for (const id of productionWebIdentifiers(repoRoot)) {
    if (id && blob.includes(id)) p.push(`config contains a production identifier (${id === PROD_PROJECT_ID ? id : 'production web app id/key'})`);
  }
  if (/dairsharaf\.com/i.test(blob)) p.push('config references the production site domain');

  // 2. Project id.
  const projectId = String(cfg.projectId || '');
  if (!STAGING_PROJECT_RE.test(projectId) || projectId.startsWith('demo-') || projectId === PROD_PROJECT_ID) {
    p.push(`projectId "${projectId}" is not a "<name>-staging" project`);
  }

  // 3. Worker + sink URLs.
  const wHost = plainHttpsHost(cfg.workerUrl);
  const wm = wHost && wHost.match(STAGING_WORKER_HOST_RE);
  if (!wm) p.push(`workerUrl must be https://${STAGING_WORKER_NAME}.<subdomain>.workers.dev`);
  const sHost = plainHttpsHost(cfg.sinkUrl);
  const sm = sHost && sHost.match(SINK_HOST_CAPTURE);
  if (!sm || !SINK_HOST_RE.test(sHost)) p.push(`sinkUrl must be https://${SINK_WORKER_NAME}.<subdomain>.workers.dev`);
  if (wm && sm && wm[1] !== sm[1]) p.push('workerUrl and sinkUrl must be on the same workers.dev subdomain');
  for (const k of ['workerUrl', 'sinkUrl']) {
    try {
      const x = new URL(cfg[k]);
      if (x.pathname !== '/' || x.search || x.hash) p.push(`${k} must have no path/query`);
    } catch {}
  }

  // 4. Firebase web config (used by the simulated browser) must be the staging app.
  const web = cfg.firebaseWebConfig || {};
  if (web.projectId !== projectId) p.push('firebaseWebConfig.projectId must equal projectId');
  if (web.authDomain !== `${projectId}.firebaseapp.com`) p.push(`firebaseWebConfig.authDomain must be ${projectId}.firebaseapp.com`);
  if (!web.apiKey || !web.appId) p.push('firebaseWebConfig.apiKey/appId missing');

  // 5. Service account key: outside the repo, of the staging project only.
  const keyPath = String(cfg.serviceAccountKeyPath || '');
  if (!keyPath || !isAbsolute(keyPath)) p.push('serviceAccountKeyPath must be an absolute path');
  else if (isInside(resolve(keyPath), repoRoot)) p.push('service account key must live OUTSIDE the repository');
  else if (!existsSync(keyPath)) p.push('service account key file not found');
  else {
    try {
      const key = JSON.parse(readFileSync(keyPath, 'utf8'));
      if (key.type !== 'service_account') p.push('key file is not a service_account key');
      if (key.project_id !== projectId) p.push('service account key belongs to a different project');
      if (!String(key.client_email || '').endsWith(`@${projectId}.iam.gserviceaccount.com`)) p.push('service account e-mail is not in the staging project');
      if (!String(key.private_key || '').includes('BEGIN PRIVATE KEY')) p.push('service account key has no private_key');
    } catch {
      p.push('service account key file is not valid JSON');
    }
  }

  // 6. Accounts whose permissions the deploy scripts will use. Required, never defaulted:
  //    a missing/malformed value stops every script (staging/accounts.mjs verifies them live before deploys).
  const cfAccount = String(cfg.cloudflareAccountId || '');
  if (!CF_ACCOUNT_ID_RE.test(cfAccount)) p.push('cloudflareAccountId missing or not a 32-character Cloudflare account id');
  const cfEmail = String(cfg.cloudflareLoginEmail || '').toLowerCase();
  if (!EMAIL_RE.test(cfEmail)) p.push('cloudflareLoginEmail missing or not a plain e-mail address');
  const fbEmail = String(cfg.firebaseAccountEmail || '').toLowerCase();
  if (!EMAIL_RE.test(fbEmail)) p.push('firebaseAccountEmail missing or not a plain e-mail address');

  // 7. Ambient credentials / project overrides that could redirect a client library.
  for (const v of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID', 'CLOUDSDK_CORE_PROJECT']) {
    if (env[v] && env[v] !== projectId) p.push(`environment variable ${v}="${env[v]}" points to another project`);
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const k = JSON.parse(readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
      if (k.project_id !== projectId) p.push('GOOGLE_APPLICATION_CREDENTIALS points to a key of another project');
    } catch {
      p.push('GOOGLE_APPLICATION_CREDENTIALS is set but unreadable');
    }
  }
  if (env.FIRESTORE_EMULATOR_HOST) p.push('FIRESTORE_EMULATOR_HOST is set (unset it for staging runs)');

  // 8. Test tokens (only for scripts that call the Workers).
  if (requireTokens) {
    for (const v of ['STAGING_SINK_READ_TOKEN', 'STAGING_WORKER_AUTH_TOKEN']) {
      if (String(env[v] || '').length < MIN_TOKEN) p.push(`environment variable ${v} missing or shorter than ${MIN_TOKEN}`);
    }
  }

  if (p.length) throw new StagingGuardError(p);
  return Object.freeze({
    projectId,
    workerUrl: `https://${wHost}`,
    sinkUrl: `https://${sHost}`,
    workerHost: wHost,
    sinkHost: sHost,
    serviceAccountKeyPath: keyPath,
    firebaseWebConfig: { ...web },
    cloudflareAccountId: cfAccount,
    cloudflareLoginEmail: cfEmail,
    firebaseAccountEmail: fbEmail,
  });
}

/** Minimal checks on a wrangler TOML file (text based, no TOML lib needed). */
export function assertWranglerFile(path, { expectName, expectTarget, projectId, sinkHost, accountId } = {}) {
  const p = [];
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new StagingGuardError([`cannot read ${path}`]);
  }
  const code = text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  const name = (code.match(/^\s*name\s*=\s*"([^"]+)"/m) || [])[1];
  if (name !== expectName) p.push(`wrangler name is "${name}", expected "${expectName}"`);
  if (name === PROD_WORKER_NAME) p.push('wrangler name is the PRODUCTION Worker');
  if (/REPLACE_WITH_/.test(code)) p.push('unfilled REPLACE_WITH_ placeholder(s)');
  if (code.includes(PROD_PROJECT_ID)) p.push('wrangler file references the production project');
  if (/dairsharaf\.com/i.test(code)) p.push('wrangler file references the production site');
  if (/^\s*\[env\./m.test(code)) p.push('wrangler [env.*] sections are not allowed (no indirection)');
  // The account is pinned via CLOUDFLARE_ACCOUNT_ID by the deploy script; a different account_id in the file is refused.
  const fileAccount = (code.match(/^\s*account_id\s*=\s*"([^"]*)"/m) || [])[1];
  if (fileAccount !== undefined && fileAccount !== accountId) p.push('wrangler account_id differs from the configured staging Cloudflare account');
  if (expectTarget) {
    const t = (code.match(/__DEPLOY_TARGET__\s*=\s*"'([a-z]+)'"/) || [])[1];
    if (t !== expectTarget) p.push(`build target is "${t}", expected "${expectTarget}"`);
  }
  if (projectId) {
    const v = (code.match(/^\s*FIREBASE_PROJECT_ID\s*=\s*"([^"]+)"/m) || [])[1];
    if (v !== projectId) p.push(`FIREBASE_PROJECT_ID var is "${v}", expected "${projectId}"`);
  }
  if (sinkHost) {
    for (const k of ['TELEGRAM_API_BASE', 'SENDGRID_API_BASE']) {
      const v = (code.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]+)"`, 'm')) || [])[1];
      if (plainHttpsHost(v) !== sinkHost) p.push(`${k} must point to ${sinkHost}`);
    }
  }
  if (p.length) throw new StagingGuardError(p);
  return { name };
}

/**
 * fetch wrapper: only the staging Workers, Google OAuth, and Firestore paths of the staging project.
 * Anything else throws BEFORE the request is made.
 */
export function guardedFetch(stagingCfg, realFetch = globalThis.fetch) {
  const allowed = new Set([stagingCfg.workerHost, stagingCfg.sinkHost, 'oauth2.googleapis.com', 'firestore.googleapis.com']);
  const firestorePrefix = `/v1/projects/${stagingCfg.projectId}/databases/`;
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.protocol !== 'https:' || !allowed.has(url.hostname)) {
      throw new StagingGuardError([`blocked request to ${url.protocol}//${url.hostname}`]);
    }
    if (url.hostname === 'firestore.googleapis.com' && !url.pathname.startsWith(firestorePrefix)) {
      throw new StagingGuardError([`blocked Firestore request outside project ${stagingCfg.projectId}`]);
    }
    if (url.pathname.includes(PROD_PROJECT_ID) || url.search.includes(PROD_PROJECT_ID)) {
      throw new StagingGuardError(['blocked request mentioning the production project']);
    }
    return realFetch(input, init);
  };
}

export function loadStagingConfigFile(path) {
  if (!path) throw new StagingGuardError(['--config <path to staging.config.json> is required']);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new StagingGuardError([`cannot read staging config ${path}`]);
  }
}
