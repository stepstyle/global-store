// Guard for the LOCAL e2e run. Runs before any process is started or any port is opened.
// Refuses: non-demo Firebase project, any non-127.0.0.1 address, credential / remote variables,
// wrangler files that could talk to Cloudflare, and production identifiers.
// It never reads staging.config.json or any key file.

import { readFileSync } from 'node:fs';
import { PROD_PROJECT_ID } from '../../src/config.js';

export class LocalE2EGuardError extends Error {
  constructor(problems) {
    super(`LOCAL E2E GUARD REFUSED:\n - ${problems.join('\n - ')}`);
    this.problems = problems;
  }
}

/** Variables that carry real credentials or point a tool at a real project / account. */
export const FORBIDDEN_ENV = [
  'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'FIREBASE_SERVICE_ACCOUNT', 'GOOGLE_OAUTH_ACCESS_TOKEN',
  'CLOUDSDK_AUTH_ACCESS_TOKEN', 'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE', 'CLOUDSDK_CORE_ACCOUNT',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CLOUDFLARE_ACCOUNT_ID',
  'CF_API_TOKEN', 'CF_API_KEY', 'CF_EMAIL', 'CF_ACCOUNT_ID', 'WRANGLER_AUTH_TOKEN',
  'STAGING_SINK_READ_TOKEN', 'STAGING_WORKER_AUTH_TOKEN',
];
/** Project selectors: allowed only when they name the local demo project. */
const PROJECT_ENV = ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID', 'CLOUDSDK_CORE_PROJECT'];

const LOCAL_URL_RE = /^http:\/\/127\.0\.0\.1:(\d{2,5})(\/[^\s?#]*)?$/;

export function localPort(u) {
  const m = String(u || '').match(LOCAL_URL_RE);
  return m ? Number(m[1]) : null;
}

/**
 * plan = { projectId, ports: {name: port}, urls: {name: url}, wranglerFiles: [path], firebaseJson: path }
 */
export function assertLocalPlan(plan, env = process.env) {
  const p = [];
  const projectId = String(plan?.projectId || '');
  if (!/^demo-[a-z0-9-]+$/.test(projectId)) p.push(`Firebase project "${projectId}" is not a demo- project`);
  if (projectId.includes(PROD_PROJECT_ID)) p.push('Firebase project references production');

  const ports = Object.entries(plan?.ports || {});
  for (const [k, v] of ports) if (!Number.isInteger(v) || v < 1024 || v > 65535) p.push(`port ${k}=${v} invalid`);
  if (new Set(ports.map(([, v]) => v)).size !== ports.length) p.push('ports must be distinct');
  const allowedPorts = new Set(ports.map(([, v]) => v));
  for (const [k, u] of Object.entries(plan?.urls || {})) {
    const port = localPort(u);
    if (port === null) p.push(`${k} is not http://127.0.0.1:<port>: ${u}`);
    else if (!allowedPorts.has(port)) p.push(`${k} uses port ${port} that is not part of the plan`);
  }

  for (const v of FORBIDDEN_ENV) if (env[v]) p.push(`environment variable ${v} is set — unset it for the local run`);
  for (const v of PROJECT_ENV) if (env[v] && env[v] !== projectId) p.push(`environment variable ${v} points to another project`);
  if (env.FIRESTORE_EMULATOR_HOST && env.FIRESTORE_EMULATOR_HOST !== `127.0.0.1:${plan?.ports?.emulator}`) {
    p.push('FIRESTORE_EMULATOR_HOST points somewhere else');
  }

  for (const f of plan?.wranglerFiles || []) p.push(...checkWranglerFile(f, allowedPorts));
  if (plan?.firebaseJson) p.push(...checkFirebaseJson(plan.firebaseJson, plan.ports || {}));

  if (p.length) throw new LocalE2EGuardError(p);
  return true;
}

/** A wrangler file for the local run: local build target, no account, no routes, no remote bindings, 127.0.0.1 URLs only. */
export function checkWranglerFile(path, allowedPorts) {
  const p = [];
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [`cannot read ${path}`];
  }
  const code = text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  const name = path.replace(/^.*[\\/]/, '');
  if (/^\s*account_id\s*=/m.test(code)) p.push(`${name}: account_id not allowed`);
  if (/^\s*(routes?|route)\s*=/m.test(code) || /^\s*\[\[routes\]\]/m.test(code)) p.push(`${name}: routes not allowed`);
  if (/^\s*workers_dev\s*=\s*true/m.test(code)) p.push(`${name}: workers_dev must not be true`);
  if (/\bremote\s*=\s*true/.test(code)) p.push(`${name}: remote bindings not allowed`);
  if (/^\s*\[env\./m.test(code)) p.push(`${name}: [env.*] sections not allowed`);
  if (code.includes(PROD_PROJECT_ID) || /dairsharaf\.com/i.test(code)) p.push(`${name}: production identifier`);
  if (/^\s*name\s*=\s*"anta-order-notify"\s*$/m.test(code)) p.push(`${name}: production Worker name`);
  const target = (code.match(/__DEPLOY_TARGET__\s*=\s*"'([a-z]+)'"/) || [])[1];
  if (target !== undefined && target !== 'local') p.push(`${name}: build target "${target}" is not local`);
  if (/^\s*ENVIRONMENT\s*=\s*"(?!local")/m.test(code)) p.push(`${name}: ENVIRONMENT must be local`);
  const proj = (code.match(/^\s*FIREBASE_PROJECT_ID\s*=\s*"([^"]*)"/m) || [])[1];
  if (proj !== undefined && !/^demo-/.test(proj)) p.push(`${name}: FIREBASE_PROJECT_ID is not demo-`);
  // ALLOWED_ORIGINS lists browser origins the Worker accepts (CORS), not destinations it connects to.
  const origins = (code.match(/^\s*ALLOWED_ORIGINS\s*=\s*"([^"]*)"/m) || [])[1];
  if (origins !== undefined && origins.split(',').some((o) => !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(o.trim()))) {
    p.push(`${name}: ALLOWED_ORIGINS may only contain local development origins`);
  }
  const destinations = code.split('\n').filter((l) => !/^\s*ALLOWED_ORIGINS\s*=/.test(l)).join('\n');
  for (const m of destinations.matchAll(/"((?:https?|wss?):\/\/[^"]*)"/g)) {
    const port = localPort(m[1]);
    if (port === null) p.push(`${name}: non-local URL ${m[1]}`);
    else if (allowedPorts && !allowedPorts.has(port)) p.push(`${name}: URL port ${port} not part of the plan`);
  }
  return p;
}

export function checkFirebaseJson(path, ports) {
  const p = [];
  let j;
  try {
    j = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [`cannot read ${path}`];
  }
  const e = j.emulators || {};
  if (e.firestore?.host !== '127.0.0.1' || e.firestore?.port !== ports.emulator) p.push('firebase.json: firestore emulator must be 127.0.0.1:<emulator port>');
  if (e.ui?.enabled !== false) p.push('firebase.json: emulator UI must be disabled');
  for (const k of Object.keys(e)) {
    if (!['firestore', 'ui', 'hub', 'logging', 'singleProjectMode'].includes(k)) p.push(`firebase.json: unexpected emulator "${k}"`);
    if (e[k] && typeof e[k] === 'object' && 'host' in e[k] && e[k].host !== '127.0.0.1') p.push(`firebase.json: ${k} host must be 127.0.0.1`);
  }
  if (j.hosting || j.functions || j.database || j.storage) p.push('firebase.json: only the firestore emulator is allowed');
  return p;
}

/** fetch for the test runner: http://127.0.0.1 on the planned ports only; everything else throws before sending. */
export function localOnlyFetch(allowedPorts, realFetch = globalThis.fetch) {
  const ok = new Set(allowedPorts);
  return async (input, init) => {
    const u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !ok.has(Number(u.port))) {
      throw new LocalE2EGuardError([`blocked request to ${u.protocol}//${u.host}`]);
    }
    return realFetch(input, init);
  };
}
