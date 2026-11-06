// Staging end-to-end tests: staging Worker + REAL Google OAuth + REAL Firestore (staging project only)
// + staging sink. Synthetic data only.
//   STAGING_SINK_READ_TOKEN=... STAGING_WORKER_AUTH_TOKEN=... STAGING_ACCESS_TOKEN=... \
//   (STAGING_ACCESS_TOKEN: the order Worker's x-staging-access gate; added by staging/guard.mjs guardedFetch to
//    requests to the order Worker only — local environment variable, never in a browser / VITE_* file)
//   node staging/run-tests.mjs --config staging/staging.config.json [--only S03,S08] [--skip-cron] [--skip-browser]
// Telegram order approval (A01–A16, staging/approval-scenarios.mjs) — the staging order Worker must be deployed WITH
// APPROVAL_MODE=telegram and the same TEST values (never the real bot / chat / admins):
//   STAGING_TELEGRAM_WEBHOOK_SECRET=… STAGING_TELEGRAM_CHAT_ID=-100… STAGING_TELEGRAM_ADMIN_IDS=<id1>,<id2> \
//   node staging/run-tests.mjs --config … --suite approval [--only A01,A05] [--skip-cron]
// Order of operations: guard -> marker check -> scenarios. Any guard failure stops before a single request.
// The scenarios themselves live in staging/scenarios.mjs (shared with the local e2e run).

import { pathToFileURL } from 'node:url';
import { setFlagsFromString } from 'node:v8';
import { decodeFields } from '../src/firestore.js';
import { parseArgs, prepareStaging, runCli } from './common.mjs';
import { runScenarios } from './scenarios.mjs';
import { runApprovalScenarios } from './approval-scenarios.mjs';
import { encodeFields } from '../src/firestore.js';
import { StagingGuardError } from './guard.mjs';
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
  if (args.suite === 'approval') return runApprovalSuite(ctx, fs, env);
  if (args.suite && args.suite !== 'scenarios') throw new StagingGuardError(['--suite must be "scenarios" (default) or "approval"']);
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

/**
 * A01–A16 against the deployed staging Workers. Button presses are POSTed to the staging Worker's /telegram/webhook with
 * the TEST webhook secret (as Telegram would); Telegram itself is the staging sink. Synthetic data only (marker check).
 */
export async function runApprovalSuite(ctx, fs, env) {
  const p = [];
  const secret = String(env.STAGING_TELEGRAM_WEBHOOK_SECRET || '');
  const chatId = String(env.STAGING_TELEGRAM_CHAT_ID || '');
  const adminIds = String(env.STAGING_TELEGRAM_ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) p.push('STAGING_TELEGRAM_WEBHOOK_SECRET missing / malformed (32-256 chars)');
  if (!/^-?\d{5,20}$/.test(chatId)) p.push('STAGING_TELEGRAM_CHAT_ID must be the numeric TEST chat id the staging Worker uses');
  if (adminIds.length !== 2 || !adminIds.every((x) => /^[1-9]\d{0,19}$/.test(x))) p.push('STAGING_TELEGRAM_ADMIN_IDS must be the two TEST admin ids of the staging Worker');
  if (p.length) throw new StagingGuardError(p);
  const outsiderId = String(Number(adminIds[0]) + 7777);
  const results = await runApprovalScenarios({
    ...ctx, label: 'staging approval', webhookSecret: secret, chatId, adminIds, outsiderId,
    cronWaitMs: CRON_WAIT_MS,
    setStock: async (pid, vid, value) => {
      const d = await fs.get(`products/${pid}`);
      const cur = d.exists ? decodeFields(d.fields) : null;
      if (!cur?.synthetic) throw new Error(`refusing to change a non-synthetic product (${pid})`);
      const fields = vid ? { variants: cur.variants.map((v) => (v.id === vid ? { ...v, stock: value } : v)) } : { stock: value };
      const r = await fs.commit([{ update: { name: fs.name(`products/${pid}`), fields: encodeFields(fields) }, updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { updateTime: d.updateTime } }]);
      if (!r.ok) throw new Error(`setStock failed (${r.status})`);
    },
    seedLegacyOrder: async (o) => {
      const r = await fs.commit([{ update: { name: fs.name(`orders/${o.id}`), fields: encodeFields({ ...o, status: 'new', seenByAdmin: false, synthetic: true }) }, currentDocument: { exists: false } }]);
      if (!r.ok) throw new Error(`seedLegacyOrder failed (${r.status})`);
    },
  });
  return results.some((r) => !r.ok) ? 1 : 0;
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
  // Node 24 (seen on 24.14.0, Windows): process.exit() while V8 is tiering up the WebAssembly HTTP parser used by
  // fetch() on a background thread crashes the process during teardown (libuv "Assertion failed:
  // !(handle->flags & UV_HANDLE_CLOSING)", exit 0xC0000409 instead of the signal's code) — AFTER the cleanup, so
  // users are deleted but the exit code is lost. Reproduced locally without any signal: fetch + process.exit crashed
  // every time; with dynamic tiering off, never. Only the stop path calls process.exit (the normal end sets
  // process.exitCode and lets Node finish), so it is turned off here, for this process only: the parser then stays
  // on its baseline code (no measurable cost for these I/O-bound tests). Behaviour, limit and repeat handling unchanged.
  if (proc === process) setFlagsFromString('--no-wasm-dynamic-tiering');
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
