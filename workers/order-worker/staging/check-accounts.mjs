// Read-only check of the CLI accounts the staging scripts would use. Creates nothing, deploys nothing.
//   node staging/check-accounts.mjs --config staging/staging.config.json --cloudflare
//   node staging/check-accounts.mjs --config staging/staging.config.json --firebase
//   node staging/check-accounts.mjs --config staging/staging.config.json --cloudflare --firebase

import { pathToFileURL } from 'node:url';
import { assertStagingConfig, loadStagingConfigFile, StagingGuardError } from './guard.mjs';
import { verifyCloudflareAccount, verifyFirebaseAccount } from './accounts.mjs';
import { parseArgs, runCli } from './common.mjs';

export async function main(argv, deps = {}) {
  const a = parseArgs(argv);
  const env = deps.env ?? process.env;
  const st = assertStagingConfig(deps.config ?? loadStagingConfigFile(a.config), { env });
  const cf = a.flags.has('cloudflare');
  const fb = a.flags.has('firebase');
  if (!cf && !fb) throw new StagingGuardError(['choose --cloudflare and/or --firebase']);
  if (cf) {
    const w = verifyCloudflareAccount(st, { env, spawn: deps.spawn });
    console.log(`Cloudflare OK: ${w.email} (${w.authType}) -> only account ${w.accountId}`);
  }
  if (fb) {
    verifyFirebaseAccount(st, { env, spawn: deps.spawn });
    console.log(`Firebase OK: ${st.firebaseAccountEmail} sees ${st.projectId} and not production`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runCli(main);
