// Child process for test/staging/stop-cleanup.test.mjs — LOCAL ONLY.
// Creates 2 synthetic test users through the REAL guardedFetch, but the Firebase Auth host is answered by the test's
// fake server on 127.0.0.1 (no network), installs the REAL stop handler, then waits to be stopped.
//   node stop-child.mjs <fakeAuthPort> <serviceAccountKeyPath (temp, fake)> <logFile> <limitMs>
import { appendFileSync } from 'node:fs';
import { assertStagingConfig, guardedFetch } from '../../../staging/guard.mjs';
import { makeStagingUsers } from '../../../staging/auth-users.mjs';
import { installStopCleanup } from '../../../staging/run-tests.mjs';

const [port, keyPath, logFile, limitMs] = process.argv.slice(2);
const log = (line) => appendFileSync(logFile, `${line}\n`);
// a start-up failure is written to the log (the test shows it) instead of vanishing with the console
process.on('uncaughtException', (e) => { log(`CHILD ERROR ${e?.message || e}`); process.exit(70); });
process.on('unhandledRejection', (e) => { log(`CHILD ERROR ${e?.message || e}`); process.exit(70); });
log(`START argv=${process.argv.length}`);

const st = assertStagingConfig({
  projectId: 'dairsharaf-staging',
  workerUrl: 'https://anta-order-notify-staging.acme.workers.dev',
  sinkUrl: 'https://anta-notify-sink-staging.acme.workers.dev',
  serviceAccountKeyPath: keyPath,
  firebaseWebConfig: { apiKey: 'staging-fake-api-key', authDomain: 'dairsharaf-staging.firebaseapp.com', projectId: 'dairsharaf-staging', appId: '1:000:web:staging' },
  cloudflareAccountId: '0123456789abcdef0123456789abcdef',
  cloudflareLoginEmail: 'staging-owner@example.com',
  firebaseAccountEmail: 'staging-owner@example.com',
}, { env: {} });

// after the guard's checks, the (only allowed) Firebase Auth host is served by the local fake
const toLoopback = (input, init) => {
  const u = new URL(String(input));
  if (u.hostname !== 'identitytoolkit.googleapis.com') throw new Error(`unexpected host ${u.hostname}`);
  return fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, init);
};
const users = makeStagingUsers(st, { fetch: guardedFetch(st, toLoopback), runId: 'stop' + String(process.pid).slice(-6).padStart(6, '0') });
installStopCleanup(users, { limitMs: Number(limitMs), log });
await users.create('a');
await users.create('b');
log(`READY ${users.emailPrefix}`);
setInterval(() => {}, 1_000); // a long-running test run, until it is stopped
