// LOCAL CPU estimate of the order Worker v2 in the real Workers runtime (workerd under `wrangler dev --local`).
//
// Method: sample the CPU time of the workerd process(es) serving the order Worker before/after a BATCH of
// requests, subtract the idle CPU rate measured beforehand, divide by the batch size.
// Windows only accounts process CPU in ~15.6 ms ticks, so single requests are not measured individually.
//
// These numbers are ESTIMATES and UPPER-BOUND-ish: they include the local proxy/dev-server work, HTTP
// parsing and logging inside workerd, on this machine's CPU. They do NOT prove anything about Cloudflare's
// 10 ms CPU limit on Workers Free, which is measured on Cloudflare's machines, per isolate, excluding I/O wait.

import { spawnSync } from 'node:child_process';
import { checkoutOrder, line } from '../fixtures.mjs';
import { makeCreateBudget } from '../../staging/scenarios.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => String(spawnSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).stdout || '').trim();

/** workerd.exe processes descending from a pid (the wrangler dev process of one Worker). */
export function workerdUnder(rootPid) {
  const out = ps(
    `$all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name; $t = @{}; $t[${Number(rootPid)}] = 1; ` +
      'do { $n = 0; foreach ($p in $all) { if (-not $t.ContainsKey([int]$p.ProcessId) -and $t.ContainsKey([int]$p.ParentProcessId)) { $t[[int]$p.ProcessId] = 1; $n++ } } } while ($n -gt 0); ' +
      "($all | Where-Object { $t.ContainsKey([int]$_.ProcessId) -and $_.Name -eq 'workerd.exe' } | ForEach-Object { $_.ProcessId }) -join ','"
  );
  return out.split(',').filter(Boolean).map(Number);
}

/** CPU time (ms) per pid. */
export function cpuOf(pids) {
  const out = ps(`(Get-Process -Id ${pids.join(',')} | ForEach-Object { "$($_.Id)=$($_.TotalProcessorTime.TotalMilliseconds)" }) -join ';'`);
  return Object.fromEntries(out.split(';').filter(Boolean).map((s) => s.split('=').map(Number)));
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

async function idleRate(pids, ms = 8_000) {
  const t0 = Date.now();
  const c0 = sum(cpuOf(pids));
  await sleep(ms);
  const c1 = sum(cpuOf(pids));
  return (c1 - c0) / (Date.now() - t0); // CPU-ms per wall-ms
}

async function batch(label, pids, idle, n, fn) {
  const t0 = Date.now();
  const c0 = cpuOf(pids);
  for (let i = 0; i < n; i++) await fn(i);
  await sleep(300);
  const c1 = cpuOf(pids);
  const elapsed = Date.now() - t0;
  const raw = sum(c1) - sum(c0);
  const corrected = Math.max(0, raw - idle * elapsed);
  return {
    label,
    n,
    rawMsPerOp: +(raw / n).toFixed(2),
    estMsPerOp: +(corrected / n).toFixed(2),
    elapsedS: +(elapsed / 1000).toFixed(1),
    perProcessMs: Object.fromEntries(Object.keys(c1).map((k) => [k, +(c1[k] - (c0[k] ?? 0)).toFixed(1)])),
  };
}

export async function measureCpu({ W, S, sinkAuth, probeUrl, orderPids, probePids, turnstileToken, reseed, get, idToken }) {
  const out = { method: 'workerd process CPU, batched, idle-subtracted (Windows tick ~15.6 ms)', orderPids, probePids, rows: [] };
  const budget = makeCreateBudget({ limit: 18, windowMs: 61_000 });
  /** extra = { token (Firebase ID token -> Authorization), trackingKeyHash (next to the order) } */
  const create = async (order, extra = {}) => {
    await budget.take(1);
    const headers = { 'content-type': 'application/json', ...(extra.token ? { authorization: `Bearer ${extra.token}` } : {}) };
    const body = JSON.stringify({ order, turnstileToken, ...(extra.trackingKeyHash ? { trackingKeyHash: extra.trackingKeyHash } : {}) });
    const r = await fetch(`${W}/create-order`, { method: 'POST', headers, body });
    if (r.status !== 200) throw new Error(`create-order ${r.status} ${await r.text()}`);
  };
  const sinkOk = async (id) => {
    const calls = (await (await fetch(`${S}/calls`, { headers: sinkAuth })).json()).calls || [];
    return calls.filter((c) => c.orderId === id && c.ok).length;
  };
  /** create + wait until BOTH notifications (telegram + e-mail) were delivered — all CPU of the request incl. waitUntil */
  const createAndNotify = async (order, extra = {}) => {
    await create(order, extra);
    for (let i = 0; i < 200 && (await sinkOk(order.id)) < 2; i++) await sleep(100);
    if ((await sinkOk(order.id)) < 2) throw new Error(`notifications not delivered for ${order.id}`);
  };
  const bigOrder = () =>
    checkoutOrder({ items: [line('p-simple', 1), line('p-variants', 1, { variantId: 'var_red' }), line('p-hundred', 1), line('CSV 001 دفتر', 1), line('p-string-stock', 1), line('p-no-stock', 1)] });

  await reseed();
  await fetch(`${S}/calls`, { method: 'DELETE', headers: sinkAuth });
  const idle = await idleRate(orderPids);
  out.idleCpuMsPerSecond = +(idle * 1000).toFixed(2);

  // 1. first create-order after startup (module already evaluated by the readiness GET /)
  out.rows.push(await batch('first create-order after startup (2 lines, incl. 2 notifications)', orderPids, idle, 1, () => createAndNotify(checkoutOrder())));
  // 2. warm, typical order
  out.rows.push(await batch('warm create-order, 2 lines, incl. telegram + e-mail', orderPids, idle, 15, () => createAndNotify(checkoutOrder())));
  // 3. warm, larger order (6 lines incl. variant, CSV id, string stock, untracked)
  await reseed();
  out.rows.push(await batch('warm create-order, 6 lines, incl. telegram + e-mail', orderPids, idle, 10, () => createAndNotify(bigOrder())));
  // 4. status endpoint
  const ids = [];
  out.rows.push(await batch('GET /orders/{id}/status', orderPids, idle, 20, async (i) => {
    ids[i] = ids[i] || checkoutOrder().id;
    await fetch(`${W}/orders/${ids[i]}/status`);
  }));
  // 4b. signed-in customers (Firebase ID token) and tracking keys — added with the auth / tracking phases
  if (idToken) {
    const { hashTrackingKey, normalizeTrackingKey } = await import('../../src/tracking.js');
    const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => B32[b % 32]).join('');
    await reseed();
    const uid = (i) => `cpuUid${String(i).padStart(22, '0')}`;
    // COLD: the first signed-in request of this isolate fetches the JWKS (local mock) and imports the keys
    const t0 = await idToken(uid(0));
    out.rows.push(await batch('FIRST signed-in create-order of the isolate (JWKS fetch + importKey + RS256 verify), incl. 2 notifications', orderPids, idle, 1, () => createAndNotify(checkoutOrder({ userId: uid(0) }), { token: t0 })));
    // WARM: keys cached
    const toks = [];
    for (let i = 1; i <= 15; i++) toks[i] = await idToken(uid(i));
    out.rows.push(await batch('warm SIGNED-IN create-order (verify, keys cached), 2 lines, incl. notifications', orderPids, idle, 15, (i) => createAndNotify(checkoutOrder({ userId: uid(i + 1) }), { token: toks[i + 1] })));
    await reseed();
    const keys = Array.from({ length: 15 }, newKey);
    const hashes = await Promise.all(keys.map((k) => hashTrackingKey(normalizeTrackingKey(k))));
    out.rows.push(await batch('warm GUEST create-order WITH tracking-key hash, 2 lines, incl. notifications', orderPids, idle, 15, (i) => createAndNotify(checkoutOrder(), { trackingKeyHash: hashes[i] })));
    // summary: one order with a known key + owner token (setup outside the measured batches)
    const key = newKey();
    const owned = checkoutOrder({ userId: uid(99) });
    const ownerTok = await idToken(uid(99));
    await create(owned, { token: ownerTok, trackingKeyHash: await hashTrackingKey(normalizeTrackingKey(key)) });
    const sum = (headers) => fetch(`${W}/orders/${owned.id}/summary`, { headers }).then(async (r) => {
      await r.text();
      return r.status;
    });
    out.rows.push(await batch('GET /orders/{id}/summary with the tracking key', orderPids, idle, 20, async () => {
      if ((await sum({ 'x-tracking-key': key })) !== 200) throw new Error('summary with key refused');
    }));
    out.rows.push(await batch('GET /orders/{id}/summary with the OWNER token (no key)', orderPids, idle, 20, async () => {
      if ((await sum({ authorization: `Bearer ${ownerTok}` })) !== 200) throw new Error('summary with owner token refused');
    }));
    out.rows.push(await batch('GET /orders/{id}/summary REFUSED (wrong key)', orderPids, idle, 20, async () => {
      if ((await sum({ 'x-tracking-key': newKey() })) !== 404) throw new Error('summary with a wrong key not refused');
    }));
  }

  // 5. cron with nothing pending
  out.rows.push(await batch('cron, nothing pending', orderPids, idle, 10, () => fetch(`${W}/__scheduled?cron=*+*+*+*+*`)));
  // 6. cron retrying FAILED notifications — comparable before/after the "one order per run" change:
  //    6a: ONE order pending (2 sends) in one invocation; 6b: FIVE orders pending, ONE invocation (whatever that run
  //    delivers is counted in the label). Setup (orders + failed first sends) is outside the measured windows.
  const failFirst = async (n) => {
    await reseed();
    await fetch(`${S}/calls`, { method: 'DELETE', headers: sinkAuth });
    await fetch(`${S}/control`, { method: 'POST', headers: { ...sinkAuth, 'content-type': 'application/json' }, body: JSON.stringify({ failNext: { telegram: n, email: n } }) });
    const failed = Array.from({ length: n }, () => checkoutOrder());
    for (const o of failed) await create(o);
    for (let i = 0; i < 100; i++) {
      const states = await Promise.all(failed.map(async (o) => (await get(`orderLedger/${o.id}`))?.notifications));
      if (states.every((s) => s?.telegram?.state === 'failed' && s?.email?.state === 'failed')) break;
      await sleep(200);
    }
    return failed;
  };
  const delivered = async (orders) => (await Promise.all(orders.map((o) => sinkOk(o.id)))).reduce((a, b) => a + b, 0);
  const settle = async (orders) => {
    // the invocation's sends have landed when the delivered count stops changing for 1.5 s
    let last = -1;
    let stableSince = Date.now();
    for (let i = 0; i < 200; i++) {
      const d = await delivered(orders);
      if (d !== last) { last = d; stableSince = Date.now(); }
      else if (Date.now() - stableSince > 1_500) return d;
      await sleep(100);
    }
    return last;
  };
  {
    const one = await failFirst(1);
    out.rows.push(await batch('cron with 1 order pending (2 sends), 1 invocation', orderPids, idle, 1, async () => {
      await fetch(`${W}/__scheduled?cron=*+*+*+*+*`);
      if ((await settle(one)) < 2) throw new Error('cron did not deliver the pending order');
    }));
  }
  {
    const five = await failFirst(5);
    let got = 0;
    const row = await batch('cron with 5 orders pending, 1 invocation', orderPids, idle, 1, async () => {
      await fetch(`${W}/__scheduled?cron=*+*+*+*+*`);
      got = await settle(five);
      if (got < 2) throw new Error('cron delivered nothing');
    });
    row.label += ` (delivered ${got} sends = ${got / 2} order(s) in this run)`;
    out.rows.push(row);
  }

  // 7. RS256 service-account signing in workerd (production only; emulator mode skips it)
  const pIdle = await idleRate(probePids, 5_000);
  out.rows.push(await batch('RS256 JWT: importKey + sign (new isolate / hourly token)', probePids, pIdle, 1, () => fetch(`${probeUrl}/jwt?n=50`)));
  out.rows.at(-1).estMsPerOp = +(out.rows.at(-1).estMsPerOp / 50).toFixed(2);
  out.rows.at(-1).rawMsPerOp = +(out.rows.at(-1).rawMsPerOp / 50).toFixed(2);
  out.rows.at(-1).n = 50;
  out.rows.push(await batch('RS256 sign only (key already imported)', probePids, pIdle, 1, () => fetch(`${probeUrl}/sign-only?n=100`)));
  out.rows.at(-1).estMsPerOp = +(out.rows.at(-1).estMsPerOp / 100).toFixed(2);
  out.rows.at(-1).rawMsPerOp = +(out.rows.at(-1).rawMsPerOp / 100).toFixed(2);
  out.rows.at(-1).n = 100;
  // 8. ID token verification (src/auth.js) and tracking-key hashing (src/tracking.js), same code as the Worker
  if ((await fetch(`${probeUrl}/prep`)).status !== 200) throw new Error('probe prep failed');
  const perOp = (row, n) => {
    row.estMsPerOp = +(row.estMsPerOp / n).toFixed(3);
    row.rawMsPerOp = +(row.rawMsPerOp / n).toFixed(3);
    row.n = n;
    return row;
  };
  out.rows.push(perOp(await batch('ID token verify, COLD (JWK parse + importKey + RS256 verify; new isolate)', probePids, pIdle, 1, () => fetch(`${probeUrl}/verify-cold?n=100`)), 100));
  out.rows.push(perOp(await batch('ID token verify, WARM (keys cached: decode + claims + RS256 verify)', probePids, pIdle, 1, () => fetch(`${probeUrl}/verify-warm?n=200`)), 200));
  out.rows.push(perOp(await batch('tracking key normalize + sha-256', probePids, pIdle, 1, () => fetch(`${probeUrl}/tracking-hash?n=200`)), 200));
  return out;
}
