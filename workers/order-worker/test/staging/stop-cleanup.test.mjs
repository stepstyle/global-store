// Stop signals during a staging run: the test users of THIS run are deleted once, within a time limit — LOCAL ONLY.
// Firebase Auth is simulated (in-process, and as an HTTP server on 127.0.0.1 for the real child-process tests).
// No network, no real user.
//
// Part A: the stop handler with a simulated process (EventEmitter) — every signal, repeats, overlap, time limit.
// Part B: a REAL child Node process. Windows: a real Ctrl+Break console event (-> SIGBREAK); an outside "SIGTERM"
//         (which Windows turns into an immediate termination — the documented no-guarantee case).
//         Linux/macOS: real SIGINT / SIGTERM (skipped on Windows, where no catchable signal can be sent this way).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { assertStagingConfig, guardedFetch } from '../../staging/guard.mjs';
import { makeStagingUsers } from '../../staging/auth-users.mjs';
import { installStopCleanup, SIGNAL_EXIT_CODES, STOP_CLEANUP_LIMIT_MS, runWithTestUsers } from '../../staging/run-tests.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_KEY = '-----BEGIN PRIVATE KEY-----\nFAKEFAKEFAKE\n-----END PRIVATE KEY-----\n';
let dir;
let keyPath;
let st;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'staging-stop-test-'));
  keyPath = join(dir, 'staging-key.json');
  writeFileSync(keyPath, JSON.stringify({ type: 'service_account', project_id: 'dairsharaf-staging', client_email: 'order-worker-staging@dairsharaf-staging.iam.gserviceaccount.com', private_key: FAKE_KEY }));
  st = assertStagingConfig({
    projectId: 'dairsharaf-staging',
    workerUrl: 'https://anta-order-notify-staging.acme.workers.dev',
    sinkUrl: 'https://anta-notify-sink-staging.acme.workers.dev',
    serviceAccountKeyPath: keyPath,
    firebaseWebConfig: { apiKey: 'staging-fake-api-key', authDomain: 'dairsharaf-staging.firebaseapp.com', projectId: 'dairsharaf-staging', appId: '1:000:web:staging' },
    cloudflareAccountId: '0123456789abcdef0123456789abcdef',
    cloudflareLoginEmail: 'staging-owner@example.com',
    firebaseAccountEmail: 'staging-owner@example.com',
  }, { env: {} });
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ------------------------------------------------------------------ simulated Firebase Auth (shared logic)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (sub) => `${b64({ alg: 'RS256' })}.${b64({ aud: 'dairsharaf-staging', iss: 'https://securetoken.google.com/dairsharaf-staging', sub })}.sig`;
const subOf = (tok) => JSON.parse(Buffer.from(String(tok).split('.')[1], 'base64url').toString()).sub;
/** state + a handler(path, body, signal) -> [status, json]; deleteMode: 'ok' | 'hang' (until aborted) | 'slow:<ms>' */
function authState(deleteMode = 'ok') {
  const s = { users: new Map(), passwords: [], deletes: 0, aborted: 0, deleteMode };
  s.handle = async (path, body, signal) => {
    if (body.password) s.passwords.push(body.password);
    if (path.endsWith(':signUp')) {
      const uid = `u${s.users.size + 1}${'x'.repeat(26)}`;
      s.users.set(uid, body.email);
      return [200, { localId: uid, idToken: idToken(uid) }];
    }
    if (path.endsWith(':delete')) {
      s.deletes += 1;
      if (s.deleteMode === 'hang' || s.deleteMode.startsWith('slow:')) {
        const ms = s.deleteMode === 'hang' ? 3_600_000 : Number(s.deleteMode.split(':')[1]);
        const ok = await new Promise((r) => {
          const t = setTimeout(() => r(true), ms);
          signal?.addEventListener('abort', () => { clearTimeout(t); s.aborted += 1; r(false); }, { once: true });
        });
        if (!ok) return null; // aborted: no answer
      }
      const sub = subOf(body.idToken);
      if (!s.users.delete(sub)) return [400, { error: { message: 'USER_NOT_FOUND' } }];
      return [200, {}];
    }
    return [404, {}];
  };
  return s;
}
/** in-process fetch for the simulated Auth (honours the request signal) */
const inProcessFetch = (s) => async (input, init) => {
  const u = new URL(String(input));
  const r = await s.handle(u.pathname, JSON.parse(init?.body || '{}'), init?.signal);
  if (!r) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  return new Response(JSON.stringify(r[1]), { status: r[0], headers: { 'content-type': 'application/json' } });
};
const mkUsers = (s, runId = 'stop01') => makeStagingUsers(st, { fetch: guardedFetch(st, inProcessFetch(s)), runId, sleep: async () => {} });
const fakeProc = () => new EventEmitter();
const exitSpy = () => { const e = (c) => e.calls.push(c); e.calls = []; return e; };
const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
const noSecrets = (text, s) => !s.passwords.some((p) => text.includes(p)) && !/eyJ[A-Za-z0-9_-]{8,}\.eyJ/.test(text) && !/\.sig\b/.test(text);

// ------------------------------------------------------------------ Part A: the stop handler
test('every stop signal: this run\'s users deleted ONCE, exit code of the signal, report without secrets', async () => {
  for (const [sig, code] of Object.entries(SIGNAL_EXIT_CODES)) {
    const s = authState();
    const users = mkUsers(s);
    await users.create('a');
    await users.create('b');
    const proc = fakeProc();
    const exit = exitSpy();
    const log = [];
    const h = installStopCleanup(users, { proc, exit, log: (l) => log.push(l) });
    proc.emit(sig);
    await h.stopping;
    assert.deepEqual(exit.calls, [code], `${sig}: exit ${code}`);
    assert.equal(s.users.size, 0, `${sig}: both deleted`);
    assert.equal(s.deletes, 2, `${sig}: one delete per user (once)`);
    assert.match(log.join('\n'), /test users: 2 deleted/);
    assert.ok(noSecrets(log.join('\n'), s), `${sig}: no password/token in the output`);
    h.dispose();
  }
  assert.equal(STOP_CLEANUP_LIMIT_MS, 20_000);
});

test('repeated signals: the cleanup still runs only once; the 2nd signal exits at once', async () => {
  const s = authState('slow:200');
  const users = mkUsers(s);
  await users.create('a');
  await users.create('b');
  const proc = fakeProc();
  const exit = exitSpy();
  const h = installStopCleanup(users, { proc, exit, log: () => {} });
  proc.emit('SIGINT');
  proc.emit('SIGINT');
  proc.emit('SIGTERM');
  assert.deepEqual(exit.calls, [130, 143], 'later signals exit immediately (the user insists)');
  await h.stopping;
  assert.equal(s.deletes, 2, 'one cleanup, never a second one');
  h.dispose();
});

test('a signal DURING the normal end-of-run cleanup joins it (no second cleanup) and still exits with its code', async () => {
  const s = authState('slow:150');
  const users = mkUsers(s);
  await users.create('a');
  await users.create('b');
  const proc = fakeProc();
  const exit = exitSpy();
  const h = installStopCleanup(users, { proc, exit, log: () => {} });
  const normal = runWithTestUsers(users, async () => [{ ok: true }], () => {});
  await new Promise((r) => setTimeout(r, 20)); // the normal cleanup has started
  proc.emit('SIGTERM');
  const [out] = await Promise.all([normal, h.stopping]);
  assert.equal(s.deletes, 2, 'the same single cleanup');
  assert.equal(out.cleanup.deleted, 2);
  assert.deepEqual(exit.calls, [143]);
  h.dispose();
});

test('TIME LIMIT: deletions still running at the limit are CANCELLED; the rest is reported; nothing secret; exits', async () => {
  const s = authState('hang');
  const users = mkUsers(s);
  await users.create('a');
  await users.create('b');
  const proc = fakeProc();
  const exit = exitSpy();
  const log = [];
  const h = installStopCleanup(users, { proc, exit, log: (l) => log.push(l), limitMs: 300 });
  const t0 = Date.now();
  proc.emit('SIGINT');
  await h.stopping;
  const took = Date.now() - t0;
  assert.ok(took < 2_000, `ended at the limit (${took} ms)`);
  assert.deepEqual(exit.calls, [130]);
  assert.ok(s.aborted >= 1, 'the request in progress was cancelled');
  const text = log.join('\n');
  assert.match(text, /TEST USERS NOT DELETED \(2\)/);
  assert.match(text, /stg-stop01-a-1@example\.invalid/);
  assert.match(text, /stg-stop01-b-2@example\.invalid/);
  assert.match(text, /time limit/);
  assert.ok(noSecrets(text, s));
  assert.equal(s.users.size, 2, 'honest: they really were not deleted');
  h.dispose();
});

test('no timer or listener is left behind (after a stop, after a normal run)', async () => {
  const before = timers();
  const s = authState();
  const users = mkUsers(s);
  await users.create('a');
  const proc = fakeProc();
  const h = installStopCleanup(users, { proc, exit: () => {}, log: () => {} });
  assert.equal(proc.listenerCount('SIGINT'), 1);
  proc.emit('SIGINT');
  await h.stopping;
  assert.equal(timers(), before, 'the 20 s limit timer was cleared');
  h.dispose();
  for (const sig of Object.keys(SIGNAL_EXIT_CODES)) assert.equal(proc.listenerCount(sig), 0, `${sig} handler removed`);
  // normal run: handlers removed, no timer created at all
  const users2 = mkUsers(authState(), 'stop02');
  const proc2 = fakeProc();
  const h2 = installStopCleanup(users2, { proc: proc2, exit: () => assert.fail('no exit on a normal run'), log: () => {} });
  await runWithTestUsers(users2, async () => [{ ok: true }], () => {});
  h2.dispose();
  assert.equal(proc2.listenerCount('SIGINT'), 0);
  assert.equal(timers(), before);
});

test('after a stop no NEW user is created; a sign-up already in flight is deleted too', async () => {
  const s = authState();
  let releaseSignUp;
  const gate = new Promise((r) => (releaseSignUp = r));
  const slowSignUp = async (input, init) => {
    if (String(input).includes(':signUp') && s.users.size === 1) await gate; // the 2nd sign-up is slow
    return inProcessFetch(s)(input, init);
  };
  const users = makeStagingUsers(st, { fetch: guardedFetch(st, slowSignUp), runId: 'stop03', sleep: async () => {} });
  await users.create('a');
  const pending = users.create('b'); // in flight when the stop comes
  const proc = fakeProc();
  const h = installStopCleanup(users, { proc, exit: () => {}, log: () => {} });
  proc.emit('SIGINT');
  await assert.rejects(users.create('c'), /cleanup already started/);
  releaseSignUp();
  await assert.rejects(pending, /cleanup started while this user was being created/);
  await h.stopping;
  assert.equal(s.users.size, 0, 'both deleted, including the one that was being created');
  h.dispose();
});

// ------------------------------------------------------------------ Part B: a REAL child process
async function authServer(mode = 'ok') {
  const s = authState(mode);
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const ac = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ac.abort(); });
      const r = await s.handle(req.url.split('?')[0], JSON.parse(body || '{}'), ac.signal);
      if (!r) return;
      res.writeHead(r[0], { 'content-type': 'application/json' });
      res.end(JSON.stringify(r[1]));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  s.port = server.address().port;
  s.close = () => { server.closeAllConnections?.(); return new Promise((r) => server.close(r)); };
  return s;
}
/**
 * Runs the PowerShell helper WITHOUT blocking this process (the fake Auth server lives here and must keep answering
 * the child). Hard limit: the helper is ended after 90 s. Resolves { stdout, stderr }.
 */
function runHelper(args) {
  return new Promise((resolveRun) => {
    const p = spawn('powershell.exe', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => p.kill(), 90_000);
    p.on('close', () => {
      clearTimeout(t);
      resolveRun({ stdout, stderr });
    });
  });
}
const CHILD = resolve(HERE, 'fixtures/stop-child.mjs');
const PS_HELPER = resolve(HERE, 'fixtures/windows-ctrl-break.ps1');
const isWin = process.platform === 'win32';

test('Windows, REAL Ctrl+Break (console event -> SIGBREAK): the child deletes its 2 users and exits 149', { skip: !isWin && 'Windows only' }, async () => {
  const s = await authServer('ok');
  const logFile = join(dir, 'child-break.log');
  try {
    const r = await runHelper(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_HELPER,
      '-Node', process.execPath, '-Script', CHILD, '-ArgsLine', `${s.port} "${keyPath}" "${logFile}" 20000`, '-LogFile', logFile]);
    const out = String(r.stdout || '').trim();
    const childLog = existsSync(logFile) ? readFileSync(logFile, 'utf8').slice(0, 400) : '(no log)';
    assert.match(out, /^EXIT 149 AFTER_MS \d+$/m, `helper said: ${out} ${String(r.stderr || '').slice(0, 300)} | child log: ${childLog}`);
    const log = readFileSync(logFile, 'utf8');
    assert.match(log, /SIGBREAK — stopping/);
    assert.match(log, /test users: 2 deleted/);
    assert.equal(s.users.size, 0, 'the fake Auth server has no user left');
    assert.ok(noSecrets(log, s));
  } finally {
    await s.close();
  }
});

test('Windows, REAL Ctrl+Break with deletions that never answer: stops at the limit, cancels them, reports both, exits 149', { skip: !isWin && 'Windows only' }, async () => {
  const s = await authServer('hang');
  const logFile = join(dir, 'child-break-hang.log');
  try {
    const r = await runHelper(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_HELPER,
      '-Node', process.execPath, '-Script', CHILD, '-ArgsLine', `${s.port} "${keyPath}" "${logFile}" 1500`, '-LogFile', logFile]);
    const out = String(r.stdout || '').trim();
    const m = out.match(/^EXIT (\d+) AFTER_MS (\d+)$/m);
    assert.ok(m, `helper said: ${out}`);
    assert.equal(Number(m[1]), 149);
    assert.ok(Number(m[2]) < 10_000, `exited ${m[2]} ms after the signal (limit 1.5 s)`);
    const log = readFileSync(logFile, 'utf8');
    assert.match(log, /TEST USERS NOT DELETED \(2\)/);
    assert.match(log, /time limit/);
    assert.ok(noSecrets(log, s));
    for (let i = 0; i < 20 && s.aborted < 1; i++) await new Promise((x) => setTimeout(x, 50));
    assert.ok(s.aborted >= 1, 'the hanging delete request was closed (cancelled)');
    assert.equal(s.users.size, 2, 'honest: not deleted');
  } finally {
    await s.close();
  }
});

test('Windows, "SIGTERM" from another process = immediate termination: NO cleanup (documented — removed by hand)', { skip: !isWin && 'Windows only' }, async () => {
  const s = await authServer('ok');
  const logFile = join(dir, 'child-term.log');
  try {
    const child = spawn(process.execPath, [CHILD, String(s.port), keyPath, logFile, '20000'], { stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 150 && !(existsSync(logFile) && readFileSync(logFile, 'utf8').includes('READY')); i++) await new Promise((x) => setTimeout(x, 100));
    assert.ok(readFileSync(logFile, 'utf8').includes('READY'));
    const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
    child.kill('SIGTERM');
    const e = await exited;
    assert.equal(e.signal, 'SIGTERM', 'terminated, no handler ran');
    assert.equal(readFileSync(logFile, 'utf8').includes('stopping'), false, 'the stop handler never ran');
    assert.equal(s.users.size, 2, 'the users REMAIN — this is why the README describes manual cleanup');
  } finally {
    await s.close();
  }
});

for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`Linux/macOS, REAL ${sig}: the child deletes its 2 users and exits ${code}`, { skip: isWin && 'not runnable on Windows (no catchable signal can be sent to a process there)' }, async () => {
    const s = await authServer('ok');
    const logFile = join(dir, `child-${sig}.log`);
    try {
      const child = spawn(process.execPath, [CHILD, String(s.port), keyPath, logFile, '20000'], { stdio: 'ignore' });
      for (let i = 0; i < 150 && !(existsSync(logFile) && readFileSync(logFile, 'utf8').includes('READY')); i++) await new Promise((x) => setTimeout(x, 100));
      const exited = new Promise((r) => child.on('exit', (c) => r(c)));
      child.kill(sig);
      assert.equal(await exited, code);
      assert.equal(s.users.size, 0);
      assert.match(readFileSync(logFile, 'utf8'), /test users: 2 deleted/);
    } finally {
      await s.close();
    }
  });
}
