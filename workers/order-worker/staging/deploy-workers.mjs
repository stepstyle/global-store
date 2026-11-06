// Deploy the staging Workers (sink and/or order worker).
//   node staging/deploy-workers.mjs --config staging/staging.config.json --which sink|order          -> checks + dry-run plan
//   node staging/deploy-workers.mjs --config … --which sink --execute --confirm anta-notify-sink-staging
//
// Refuses unless: staging guard passes, the wrangler file has the expected -staging name, the 'staging'
// build target, the staging project id, sink URLs on the same subdomain, and no REPLACE_WITH_ placeholder.
// Every wrangler call is pinned to cfg.cloudflareAccountId. Always runs `wrangler deploy --dry-run` first;
// the real deploy only with --execute, an exact --confirm, and a live check that the logged-in wrangler
// credentials belong to exactly that staging account (staging/accounts.mjs).

import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  assertStagingConfig, assertWranglerFile, loadStagingConfigFile, StagingGuardError, REPO_ROOT,
  STAGING_WORKER_NAME, SINK_WORKER_NAME,
} from './guard.mjs';
import { WRANGLER, wranglerEnv, verifyCloudflareAccount } from './accounts.mjs';
import { parseArgs, runCli } from './common.mjs';

export const TARGETS = {
  order: { name: STAGING_WORKER_NAME, toml: resolve(REPO_ROOT, 'workers/order-worker/wrangler.staging.toml'), expectTarget: 'staging', checkProject: true },
  sink: { name: SINK_WORKER_NAME, toml: resolve(REPO_ROOT, 'workers/notify-sink/wrangler.toml'), expectTarget: null, checkProject: false },
};

export function planWorkerDeploy(st, which, tomlOverride) {
  const t = TARGETS[which];
  if (!t) throw new StagingGuardError(['--which must be "order" or "sink"']);
  const toml = tomlOverride || t.toml;
  assertWranglerFile(toml, {
    expectName: t.name,
    expectTarget: t.expectTarget,
    projectId: t.checkProject ? st.projectId : undefined,
    sinkHost: t.checkProject ? st.sinkHost : undefined,
    accountId: st.cloudflareAccountId,
  });
  return {
    name: t.name,
    dryRun: [WRANGLER, 'deploy', '--config', toml, '--dry-run', '--outdir', resolve(REPO_ROOT, `workers/order-worker/.dry-run-${which}`)],
    deploy: [WRANGLER, 'deploy', '--config', toml],
  };
}

export async function main(argv, deps = {}) {
  const a = parseArgs(argv);
  const env = deps.env ?? process.env;
  const st = assertStagingConfig(deps.config ?? loadStagingConfigFile(a.config), { env });
  const plan = planWorkerDeploy(st, a.which, deps.tomlOverride);
  const execute = a.flags.has('execute');
  if (execute && a.confirm !== plan.name) throw new StagingGuardError([`--confirm must equal "${plan.name}"`]);
  const runEnv = wranglerEnv(st, env); // refuses before any spawn
  const spawn = deps.spawn ?? spawnSync;

  // Output never shows the Cloudflare account id or login e-mail (they stay in staging.config.json); the account is
  // still pinned for every wrangler call by runEnv / who.env below.
  console.log(`PLAN: ${plan.name} -> the configured staging Cloudflare account (id hidden)\n  dry-run: node ${plan.dryRun.slice(1).join(' ')}\n  deploy : node ${plan.deploy.slice(1).join(' ')}`);
  const dry = spawn(process.execPath, plan.dryRun, { stdio: 'inherit', env: runEnv });
  if ((dry.status ?? 1) !== 0) throw new Error('dry-run failed — not deploying');

  if (!execute) {
    console.log(`dry-run only — add --execute --confirm ${plan.name} to deploy`);
    return 0;
  }
  const who = verifyCloudflareAccount(st, { env, spawn });
  console.log('account check OK: wrangler sees exactly one account — the configured staging one — with the configured e-mail (both hidden)');
  const r = spawn(process.execPath, plan.deploy, { stdio: 'inherit', env: who.env });
  return r.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runCli(main);
