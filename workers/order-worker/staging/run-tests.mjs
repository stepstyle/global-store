// Staging end-to-end tests: staging Worker + REAL Google OAuth + REAL Firestore (staging project only)
// + staging sink. Synthetic data only.
//   STAGING_SINK_READ_TOKEN=... STAGING_WORKER_AUTH_TOKEN=... \
//   node staging/run-tests.mjs --config staging/staging.config.json [--only S03,S08] [--skip-cron] [--skip-browser]
// Order of operations: guard -> marker check -> scenarios. Any guard failure stops before a single request.
// The scenarios themselves live in staging/scenarios.mjs (shared with the local e2e run).

import { pathToFileURL } from 'node:url';
import { decodeFields } from '../src/firestore.js';
import { parseArgs, prepareStaging, runCli } from './common.mjs';
import { runScenarios } from './scenarios.mjs';
import { makeStagingUsers } from './auth-users.mjs';

const TURNSTILE_TEST_TOKEN = 'staging-turnstile-test-token'; // accepted by Cloudflare's always-pass TEST secret

// Real cron on staging runs every 5 minutes (wrangler.staging.toml, same as production) and handles ONE order per
// run. A retried notification can therefore wait up to ~2 schedule periods plus Cloudflare's trigger delay.
// Hard limit: the wait always ends (fails) after CRON_WAIT_MS — never an endless wait.
export const CRON_PERIOD_MS = 5 * 60_000;
export const CRON_WAIT_MS = 12 * 60_000; // 2 periods + 2 min margin
export const CRON_STEP_MS = 15_000; // poll interval (reads only)
// the only browser origin the staging Worker allows (the local Vite dev server, vite.config.ts: 127.0.0.1:3000)
export const STAGING_DEV_ORIGIN = 'http://127.0.0.1:3000';

export async function main(argv, deps = {}) {
  const args = parseArgs(argv);
  const env = deps.env ?? process.env;
  const { st, fs } = prepareStaging({ configPath: args.config, requireTokens: true, ...deps });

  const ctx = {
    label: 'staging',
    projectId: st.projectId,
    W: st.workerUrl,
    S: st.sinkUrl,
    sinkAuth: { 'x-sink-auth': env.STAGING_SINK_READ_TOKEN },
    turnstileToken: TURNSTILE_TEST_TOKEN,
    get: async (path) => {
      const d = await fs.get(path);
      return d.exists ? decodeFields(d.fields) : null;
    },
    reseed: async () => {
      const { main: seed } = await import('./seed.mjs');
      await seed(['--config', args.config, '--reset'], deps);
    },
    browserApp: async () => {
      const { initializeApp, deleteApp } = await import('firebase/app');
      const { getFirestore } = await import('firebase/firestore');
      const app = initializeApp(st.firebaseWebConfig, `staging-browser-${Date.now()}`);
      return { db: getFirestore(app), done: () => deleteApp(app) };
    },
    cronWaitMs: CRON_WAIT_MS,
    cronStepMs: CRON_STEP_MS,
    devOrigin: STAGING_DEV_ORIGIN,
    createBudget: { limit: 18, windowMs: 61_000 }, // wrangler.staging.toml: CREATE_RATE_LIMITER 20 / 60 s
    skipCron: args.flags.has('skip-cron'),
    skipBrowser: args.flags.has('skip-browser'),
    only: args.only ? new Set(args.only.split(',')) : null,
  };
  // S40–S45: synthetic Firebase Auth users of dairsharaf-staging, created during the run and ALWAYS deleted after it
  const users = (deps.makeUsers ?? makeStagingUsers)(st, { fetch: globalThis.fetch });
  ctx.users = users;
  // printed FIRST: if the run is stopped abruptly, this identifies its leftover test accounts (README)
  console.log(`test users of this run (deleted at the end): ${users.emailPrefix}*@example.invalid in ${st.projectId}`);
  const { code } = await runWithTestUsers(users, () => runScenarios(ctx));
  return code;
}

/**
 * Runs the scenarios, then deletes this run's test users WHATEVER happened (also when the run throws). A user that
 * could not be deleted fails the run and is listed by e-mail (never password/token) for removal by hand.
 */
export async function runWithTestUsers(users, run, log = console.log) {
  let results;
  let error;
  try {
    results = await run();
  } catch (e) {
    error = e;
  }
  const cleanup = await users.cleanup();
  if (cleanup.failed.length) {
    log(`\nTEST USERS NOT DELETED (${cleanup.failed.length}) — remove them by hand in Firebase Auth of the staging project:`);
    for (const f of cleanup.failed) log(`  ${f.email}  (${f.reason})`);
  } else {
    log(`test users: ${cleanup.deleted} deleted (prefix ${users.emailPrefix ?? '-'})`);
  }
  if (error) throw error;
  const code = results.some((r) => !r.ok) || cleanup.failed.length ? 1 : 0;
  return { results, cleanup, code };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runCli(main);
