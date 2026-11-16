// Deploy Firestore rules to the STAGING project only. The rules set must be chosen explicitly:
//   node staging/deploy-rules.mjs --config staging/staging.config.json --rules compat|transition|final
//       -> plan only (default; also with --dry-run): prints the command, spawns nothing
//   node staging/deploy-rules.mjs --config … --rules <set> --execute --confirm <staging-project-id>   -> deploys
//
// --rules takes a NAME, never a path: each name maps to one file in firebase/rules-test/ (tested by
// firebase/rules-test/rules.test.mjs). No default, no other value, no other option is accepted.
// Builds a throw-away firebase.json + .firebaserc in a temp dir (nothing deployable is committed),
// passes --project AND --account explicitly (never the CLI's default account), strips FIREBASE_TOKEN and
// similar overrides, and before deploying verifies live that the staging account sees the staging project
// and does NOT see production (staging/accounts.mjs).

import { mkdtempSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assertStagingConfig, loadStagingConfigFile, StagingGuardError, REPO_ROOT } from './guard.mjs';
import { firebaseSpawnOptions, verifyFirebaseAccount } from './accounts.mjs';
import { PROD_PROJECT_ID } from '../src/config.js';
import { parseArgs, runCli } from './common.mjs';

/** The one project this script may ever target. */
export const STAGING_PROJECT_ID = 'dairsharaf-staging';
export const RULES_DIR = resolve(REPO_ROOT, 'firebase/rules-test');
/** name -> rules file (inside RULES_DIR only) */
export const RULES_SETS = Object.freeze({
  compat: resolve(RULES_DIR, 'firestore.rules.compat'),
  transition: resolve(RULES_DIR, 'firestore.rules.transition'),
  final: resolve(RULES_DIR, 'firestore.rules.final'),
});
/** kept for existing imports: the compat file */
export const COMPAT_RULES = RULES_SETS.compat;
const ALLOWED_OPTIONS = new Set(['config', 'rules', 'execute', 'confirm', 'dry-run']);

/** Validates the --rules choice and returns { kind, file }. Throws StagingGuardError on anything else. */
export function resolveRulesChoice(a) {
  const unknown = [...Object.keys(a).filter((k) => k !== 'flags'), ...a.flags].filter((k) => !ALLOWED_OPTIONS.has(k));
  if (unknown.length) throw new StagingGuardError([`unknown option(s): ${unknown.map((k) => `--${k}`).join(', ')}`]);
  if (a.flags.has('rules') || a.rules === undefined) {
    throw new StagingGuardError([`--rules is required: one of ${Object.keys(RULES_SETS).join(' | ')}`]);
  }
  const kind = String(a.rules);
  if (!Object.prototype.hasOwnProperty.call(RULES_SETS, kind)) {
    throw new StagingGuardError([`--rules "${kind}" is not allowed (a NAME, never a path): one of ${Object.keys(RULES_SETS).join(' | ')}`]);
  }
  const file = RULES_SETS[kind];
  const rel = relative(RULES_DIR, file);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new StagingGuardError([`rules file outside ${RULES_DIR}`]);
  if (!existsSync(file)) throw new StagingGuardError([`rules file missing: ${rel}`]);
  return { kind, file };
}

export function planRulesDeploy(st, choice = { kind: 'compat', file: RULES_SETS.compat }) {
  if (st.projectId !== STAGING_PROJECT_ID) throw new StagingGuardError([`rules may only be deployed to "${STAGING_PROJECT_ID}" (config says "${st.projectId}")`]);
  const dir = mkdtempSync(join(tmpdir(), 'dairsharaf-staging-rules-'));
  copyFileSync(choice.file, join(dir, 'firestore.rules'));
  writeFileSync(join(dir, 'firebase.json'), JSON.stringify({ firestore: { rules: 'firestore.rules' } }, null, 2));
  writeFileSync(join(dir, '.firebaserc'), JSON.stringify({ projects: { default: st.projectId } }, null, 2));
  const args = ['deploy', '--only', 'firestore:rules', '--project', st.projectId, '--account', st.firebaseAccountEmail,
    '--config', join(dir, 'firebase.json'), '--non-interactive'];
  if (args.includes(PROD_PROJECT_ID)) throw new StagingGuardError(['planned command mentions the production project']);
  return { cwd: dir, command: 'firebase', args, kind: choice.kind };
}

export async function main(argv, deps = {}) {
  const a = parseArgs(argv);
  // the choice is validated BEFORE the config is read or anything is planned
  const choice = resolveRulesChoice(a);
  const env = deps.env ?? process.env;
  const st = assertStagingConfig(deps.config ?? loadStagingConfigFile(a.config), { env });
  if (st.projectId !== STAGING_PROJECT_ID) throw new StagingGuardError([`rules may only be deployed to "${STAGING_PROJECT_ID}" (config says "${st.projectId}")`]);
  const plan = planRulesDeploy(st, choice);
  console.log(`PLAN (rules: ${choice.kind} [${relative(REPO_ROOT, choice.file)}] -> project ${st.projectId}, account ${st.firebaseAccountEmail}):\n  ${plan.command} ${plan.args.join(' ')}\n  cwd: ${plan.cwd}`);

  if (a.flags.has('dry-run') || !a.flags.has('execute')) {
    console.log(`plan only — nothing deployed. To deploy: --rules ${choice.kind} --execute --confirm ${st.projectId}`);
    return 0;
  }
  if (a.confirm !== st.projectId) throw new StagingGuardError([`--confirm must equal "${st.projectId}"`]);
  const opts = firebaseSpawnOptions(env); // refuses FIREBASE_TOKEN before any spawn

  const spawn = deps.spawn ?? spawnSync;
  verifyFirebaseAccount(st, { env, spawn });
  console.log(`account check OK: ${st.firebaseAccountEmail} sees ${st.projectId}, not production`);
  const r = spawn(plan.command, plan.args, { cwd: plan.cwd, stdio: 'inherit', ...opts });
  return r.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runCli(main);
