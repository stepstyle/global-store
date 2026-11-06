// LOCAL check of wrangler.production.toml (no network, no secrets read). Exit 0 = deployable shape, 1 = blocked.
//   node production/check-config.mjs [--toml <path>]
// Two kinds of findings:
//   VIOLATION   — a rule broken by the file itself (staging/local value, test key, secret in [vars], weak mode …)
//   PLACEHOLDER — a production value nobody filled in yet (REPLACE_WITH_…): deploy stays blocked
// Plus a simulation: the Worker's own loadConfig() (production build) with the file's [vars] + FAKE secrets must pass.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TOML = resolve(HERE, '../wrangler.production.toml');
export const PROD_PROJECT = 'antastore1-82b50';
export const PROD_ORIGINS = ['https://dairsharaf.com', 'https://www.dairsharaf.com'];
const SECRET_NAMES = ['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'TURNSTILE_SECRET', 'TELEGRAM_BOT_TOKEN', 'SENDGRID_API_KEY', 'WORKER_AUTH_TOKEN', 'STAGING_ACCESS_TOKEN'];

/** minimal TOML reading for this file's flat shape: top-level keys, [define], [vars] (strings only) */
export function parseToml(text) {
  const out = { top: {}, sections: {} };
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const s = line.match(/^\[\[?([A-Za-z0-9_.]+)\]?\]$/);
    if (s) { section = s[1]; out.sections[section] ??= {}; continue; }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*"(.*)"\s*$/);
    if (!kv) continue;
    (section ? out.sections[section] : out.top)[kv[1]] = kv[2];
  }
  return out;
}

export async function checkProductionConfig(text) {
  const t = parseToml(text);
  const vars = t.sections.vars || {};
  const v = [];
  const p = [];
  const all = { ...t.top, ...vars, ...(t.sections.define || {}) };
  for (const [k, val] of Object.entries(all)) if (val.includes('REPLACE_WITH_')) p.push(k);
  // identity / target
  if (!t.top.name?.includes('REPLACE_WITH_')) {
    if (/staging|localdev|-local/.test(t.top.name || '')) v.push(`name "${t.top.name}" looks like staging/local`);
    if (t.top.name === 'anta-order-notify') v.push('name reuses the OLD production Worker "anta-order-notify" (plan: a new Worker, the old one retired separately)');
  }
  if (!t.top.account_id?.includes('REPLACE_WITH_') && !/^[0-9a-f]{32}$/.test(t.top.account_id || '')) v.push('account_id is not a 32-hex Cloudflare account id');
  if (t.sections.define?.__DEPLOY_TARGET__ !== "'production'") v.push("__DEPLOY_TARGET__ must be 'production'");
  if (t.top.main !== 'src/index.js') v.push('main must be src/index.js');
  // vars
  if (vars.ENVIRONMENT !== 'production') v.push('ENVIRONMENT must be production');
  if (vars.FIREBASE_PROJECT_ID !== PROD_PROJECT) v.push(`FIREBASE_PROJECT_ID must be ${PROD_PROJECT}`);
  if (vars.FIRESTORE_AUTH !== 'service-account') v.push('FIRESTORE_AUTH must be service-account');
  if (vars.PRICE_CHECK_MODE !== 'enforce') v.push('PRICE_CHECK_MODE must be enforce');
  if (vars.TURNSTILE_MODE !== 'enforce') v.push('TURNSTILE_MODE must be enforce');
  if (vars.STOCK_MODE !== 'log') v.push('STOCK_MODE must be log (deduct only on approval)');
  const origins = String(vars.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (JSON.stringify(origins.slice().sort()) !== JSON.stringify(PROD_ORIGINS.slice().sort())) v.push(`ALLOWED_ORIGINS must be exactly ${PROD_ORIGINS.join(',')}`);
  for (const k of ['TELEGRAM_API_BASE', 'SENDGRID_API_BASE', 'FIRESTORE_BASE_URL', 'OAUTH_TOKEN_URL', 'TURNSTILE_VERIFY_URL', 'AUTH_JWKS_URL']) if (vars[k] !== undefined) v.push(`${k} must not be set (official endpoints only)`);
  for (const k of SECRET_NAMES) if (vars[k] !== undefined) v.push(`${k} is a SECRET — never in [vars] (wrangler secret put)`);
  const blob = text.replace(/^\s*#.*$/gm, '');
  if (/dairsharaf-staging|hopemohmmed|anta-notify-sink|127\.0\.0\.1|localhost|demo-|example\.invalid/i.test(blob)) v.push('staging / local / test value present');
  if (/[123]x0{20,}[A-F]{2}/.test(blob)) v.push('Turnstile TEST key present');
  if (/BEGIN PRIVATE KEY|AIza[0-9A-Za-z_-]{30,}|[0-9a-f]{64}/.test(blob)) v.push('secret-looking value in the file');

  // simulation with the Worker's own validation (production build), FAKE secrets, placeholders replaced by fakes
  const { loadConfig } = await import(pathToFileURL(resolve(HERE, '../src/config.js')).href);
  const env = Object.fromEntries(Object.entries(vars).map(([k, val]) => [k, val.includes('REPLACE_WITH_') ? (k.includes('EMAIL') || k === 'EMAIL_FROM' ? 'filled@example.com' : 'filled-value') : val]));
  Object.assign(env, {
    FIREBASE_CLIENT_EMAIL: `fake-sa@${PROD_PROJECT}.iam.gserviceaccount.com`,
    FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
    TURNSTILE_SECRET: '0x4AAAAAAAFAKEFAKEFAKEFAKE', TELEGRAM_BOT_TOKEN: 'fake', SENDGRID_API_KEY: 'fake', WORKER_AUTH_TOKEN: 'f'.repeat(32),
  });
  const prev = globalThis.__DEPLOY_TARGET__;
  globalThis.__DEPLOY_TARGET__ = 'production';
  let sim;
  try { sim = loadConfig(env); } finally { if (prev === undefined) delete globalThis.__DEPLOY_TARGET__; else globalThis.__DEPLOY_TARGET__ = prev; }
  if (!sim.ok) v.push(...sim.errors.map((e) => `config.js (production build) refuses it: ${e}`));
  return { violations: v, placeholders: p, deployable: v.length === 0 && p.length === 0 };
}

async function main() {
  const i = process.argv.indexOf('--toml');
  const path = i > 0 ? process.argv[i + 1] : DEFAULT_TOML;
  const r = await checkProductionConfig(readFileSync(path, 'utf8'));
  for (const x of r.violations) console.log(`VIOLATION    ${x}`);
  for (const x of r.placeholders) console.log(`PLACEHOLDER  ${x} (fill in before deploying)`);
  console.log(r.deployable ? 'OK: deployable shape (still needs the secrets + an approved deploy)' : `BLOCKED: ${r.violations.length} violation(s), ${r.placeholders.length} placeholder(s)`);
  process.exitCode = r.deployable ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
