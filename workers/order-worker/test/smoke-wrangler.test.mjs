// Smoke test in the real Workers runtime (workerd) via `wrangler dev` — LOCAL mode only.
// Uses wrangler.toml [vars]: emulator on 127.0.0.1:8086, mocks on 127.0.0.1:8790.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { emulatorHost, startMockServices, clearDb, seedProducts, getDecoded, productStock, sleep } from './helpers.mjs';
import { checkoutOrder } from './fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:8787';
let mock;
let child;
let output = '';

before(async () => {
  if (emulatorHost() !== '127.0.0.1:8086') throw new Error('smoke test expects the emulator on 127.0.0.1:8086 (wrangler.toml)');
  mock = await startMockServices(8790);
  child = spawn(
    process.execPath,
    [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--ip', '127.0.0.1', '--port', '8787', '--test-scheduled', '--show-interactive-dev-session=false'],
    { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`wrangler dev did not start:\n${output.slice(-2000)}`);
});

after(async () => {
  if (child?.pid) {
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      else child.kill('SIGTERM');
    } catch {}
  }
  assert.deepEqual(mock?.state.unexpected || [], []);
  await mock?.close();
});

test('workerd: root responds with v2 version', async () => {
  const r = await fetch(`${BASE}/`);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.match(body.version, /^v2\./);
});

test('workerd: create-order -> stored, stock deducted, notified; status endpoint has no PII', async () => {
  await clearDb();
  await seedProducts();
  mock.reset();
  const o = checkoutOrder();
  const r = await fetch(`${BASE}/create-order`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://dairsharaf.com' },
    body: JSON.stringify({ order: o }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://dairsharaf.com');
  assert.deepEqual(await r.json(), { ok: true, orderId: o.id, replay: false });

  // waitUntil runs after the response; channels are sent one after the other
  for (let i = 0; i < 100 && (mock.sent('telegram') < 1 || mock.sent('email') < 1); i++) await sleep(100);
  if (mock.sent('telegram') !== 1 || mock.sent('email') !== 1) {
    const led = await getDecoded(`orderLedger/${o.id}`);
    const diag = { calls: mock.state.calls.map((c) => [c.channel, c.ok]), ledger: led ? { mode: led.mode, notifications: led.notifications } : null, wrangler: output.slice(-1500) };
    assert.fail(`telegram not delivered in workerd: ${JSON.stringify(diag, null, 1)}`);
  }
  assert.equal(mock.sent('email'), 1);
  assert.equal(await productStock('p-simple'), 8);
  assert.equal((await getDecoded(`orderLedger/${o.id}`)).mode, 'created');

  const s = await fetch(`${BASE}/orders/${o.id}/status`);
  assert.deepEqual(await s.json(), { ok: true, exists: true, status: 'new' });

  const replay = await fetch(`${BASE}/create-order`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order: o }) });
  assert.equal((await replay.json()).replay, true);
  assert.equal(await productStock('p-simple'), 8);
});

test('workerd: /test without auth -> 401; cron trigger runs', async () => {
  assert.equal((await fetch(`${BASE}/test`)).status, 401);
  const c = await fetch(`${BASE}/__scheduled?cron=*/5+*+*+*+*`);
  assert.equal(c.status, 200);
});
