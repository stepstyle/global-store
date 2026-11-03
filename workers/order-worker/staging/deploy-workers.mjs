// Deploy the staging Workers (sink and/or order worker).
//   node staging/deploy-workers.mjs --config staging/staging.config.json --which sink|order          -> checks + dry-run plan
//   node staging/deploy-workers.mjs --config … --which sink --execute --confirm anta-notify-sink-staging
//
// Refuses unless: staging guard passes, the wrangler file has the expected -staging name, the 'staging'
// build target, the staging project id, sink URLs on the same subdomain, and no REPLACE_WITH_ placeholder.
// Always runs `wrangler deploy --dry-run` first; the real deploy only with --execute and an exact --confirm.

import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  assertStagingConfig, assertWranglerFile, loadStagingConfigFile, StagingGuardError, REPO_ROOT,
  STAGING_WORKER_NAME, SINK_WORKER_NAME,
} from './guard.mjs';
import { parseArgs, runCli } from './common.mjs';

const WRANGLER = resolve(REPO_ROOT, 'workers/order-worker/node_modules/wrangler/bin/wrangler.js');

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
  });
  return {
    name: t.name,
    dryRun: [WRANGLER, 'deploy', '--config', toml, '--dry-run', '--outdir', resolve(REPO_ROOT, `workers/order-worker/.dry-run-${which}`)],
    deploy: [WRANGLER, 'deploy', '--config', toml],
  };
}

export async function main(argv, deps = {}) {
  const a = parseArgs(argv);
  const st = assertStagingConfig(deps.config ?? loadStagingConfigFile(a.config), { env: deps.env ?? process.env });
  const plan = planWorkerDeploy(st, a.which, deps.tomlOverride);
  const spawn = deps.spawn ?? spawnSync;
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };

  console.log(`PLAN: ${plan.name}\n  dry-run: node ${plan.dryRun.slice(1).join(' ')}\n  deploy : node ${plan.deploy.slice(1).join(' ')}`);
  const dry = spawn(process.execPath, plan.dryRun, { stdio: 'inherit', env });
  if ((dry.status ?? 1) !== 0) throw new Error('dry-run failed — not deploying');

  if (!a.flags.has('execute')) {
    console.log(`dry-run only — add --execute --confirm ${plan.name} to deploy`);
    return 0;
  }
  if (a.confirm !== plan.name) throw new StagingGuardError([`--confirm must equal "${plan.name}"`]);
  const r = spawn(process.execPath, plan.deploy, { stdio: 'inherit', env });
  return r.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runCli(main);
