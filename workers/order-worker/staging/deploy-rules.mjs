// Deploy the COMPAT Firestore rules to the STAGING project only.
//   node staging/deploy-rules.mjs --config staging/staging.config.json                 -> plan only (default)
//   node staging/deploy-rules.mjs --config … --execute --confirm <staging-project-id>   -> deploys
//
// Builds a throw-away firebase.json + .firebaserc in a temp dir (nothing deployable is committed),
// passes --project explicitly, and refuses unless the guard passes and --confirm matches exactly.

import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assertStagingConfig, loadStagingConfigFile, StagingGuardError, REPO_ROOT } from './guard.mjs';
import { PROD_PROJECT_ID } from '../src/config.js';
import { parseArgs, runCli } from './common.mjs';

export const COMPAT_RULES = resolve(REPO_ROOT, 'firebase/rules-test/firestore.rules.compat');

export function planRulesDeploy(st) {
  const dir = mkdtempSync(join(tmpdir(), 'dairsharaf-staging-rules-'));
  copyFileSync(COMPAT_RULES, join(dir, 'firestore.rules'));
  writeFileSync(join(dir, 'firebase.json'), JSON.stringify({ firestore: { rules: 'firestore.rules' } }, null, 2));
  writeFileSync(join(dir, '.firebaserc'), JSON.stringify({ projects: { default: st.projectId } }, null, 2));
  const args = ['deploy', '--only', 'firestore:rules', '--project', st.projectId, '--config', join(dir, 'firebase.json'), '--non-interactive'];
  if (args.includes(PROD_PROJECT_ID)) throw new StagingGuardError(['planned command mentions the production project']);
  return { cwd: dir, command: 'firebase', args };
}

export async function main(argv, deps = {}) {
  const a = parseArgs(argv);
  const st = assertStagingConfig(deps.config ?? loadStagingConfigFile(a.config), { env: deps.env ?? process.env });
  const plan = planRulesDeploy(st);
  console.log(`PLAN (rules: compat -> project ${st.projectId}):\n  ${plan.command} ${plan.args.join(' ')}\n  cwd: ${plan.cwd}`);

  if (!a.flags.has('execute')) {
    console.log('plan only — add --execute --confirm <project-id> to deploy');
    return 0;
  }
  if (a.confirm !== st.projectId) throw new StagingGuardError([`--confirm must equal "${st.projectId}"`]);

  const spawn = deps.spawn ?? spawnSync;
  const r = spawn(plan.command, plan.args, { cwd: plan.cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runCli(main);
