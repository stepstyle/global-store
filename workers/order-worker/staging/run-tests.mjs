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
  // stopped by the user (Ctrl+C / Ctrl+Break / terminal closed / SIGTERM): delete this run's users first, bounded
  const stopHandler = (deps.installStop ?? installStopCleanup)(users);
  try {
    const { code } = await runWithTestUsers(users, () => runScenarios(ctx));
    return code;
  } finally {
    stopHandler.dispose();
  }
}

/** Prints what the cleanup did — e-mails only, never passwords or tokens. */
export function reportCleanup(cleanup, users, log = console.log) {
  if (cleanup.failed.length) {
    log(`\nTEST USERS NOT DELETED (${cleanup.failed.length}) — remove them by hand in Firebase Auth of the staging project (README):`);
    for (const f of cleanup.failed) log(`  ${f.email}  (${f.reason})`);
  } else {
    log(`test users: ${cleanup.deleted} deleted (prefix ${users.emailPrefix ?? '-'})`);
  }
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
  reportCleanup(cleanup, users, log);
  if (error) throw error;
  const code = results.some((r) => !r.ok) || cleanup.failed.length ? 1 : 0;
  return { results, cleanup, code };
}

// ------------------------------------------------------------------ stop signals
/** Cleanup budget after a stop signal: requests still running when it ends are cancelled, the rest is reported. */
export const STOP_CLEANUP_LIMIT_MS = 20_000;
/** exit code per signal (128 + signal number); SIGBREAK = Ctrl+Break on Windows */
export const SIGNAL_EXIT_CODES = Object.freeze({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGBREAK: 149 });

/**
 * While the run is active: on the FIRST stop signal, delete this run's test users (the same single cleanup as the
 * normal end — it is joined, never repeated) within STOP_CLEANUP_LIMIT_MS, report, then exit with the signal's code.
 * A SECOND signal exits at once (the user insists). Limits: nothing runs on SIGKILL, a forced kill, a crash of the
 * machine or power loss; on Windows, only console events reach Node (Ctrl+C -> SIGINT, Ctrl+Break -> SIGBREAK,
 * console closed -> SIGHUP with ~10 s left), while "SIGTERM" from another process terminates it immediately.
 * Those leftovers are removed by hand (README).
 */
export function installStopCleanup(users, { proc = process, exit = (c) => process.exit(c), log = console.log, limitMs = STOP_CLEANUP_LIMIT_MS, signals = Object.keys(SIGNAL_EXIT_CODES) } = {}) {
  let stopping = null;
  const listeners = [];
  const onSignal = (sig) => {
    const code = SIGNAL_EXIT_CODES[sig] ?? 1;
    if (stopping) {
      log(`${sig} again — exiting now without waiting for the cleanup (leftover test users: see README)`);
      exit(code);
      return;
    }
    log(`\n${sig} — stopping: deleting this run's test users (at most ${Math.round(limitMs / 1000)} s; ${sig} again exits at once)`);
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new Error('stop cleanup time limit')), limitMs);
    // started SYNCHRONOUSLY, before this handler returns: from now on no new test user can be created
    let started;
    try {
      started = users.cleanup({ signal: deadline.signal });
    } catch (e) {
      started = Promise.reject(e);
    }
    stopping = Promise.resolve(started)
      .then((cleanup) => reportCleanup(cleanup, users, log))
      .catch(() => log('cleanup could not complete — leftover test users: see README'))
      .finally(() => {
        clearTimeout(timer);
        exit(code);
      });
  };
  for (const sig of signals) {
    const fn = () => onSignal(sig);
    try {
      proc.on(sig, fn);
      listeners.push([sig, fn]);
    } catch {
      // signal not available on this platform
    }
  }
  return {
    /** the stop cleanup in progress (or null) */
    get stopping() {
      return stopping;
    },
    /** removes the handlers (the run ended normally) */
    dispose() {
      for (const [sig, fn] of listeners.splice(0)) proc.off(sig, fn);
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runCli(main);
