// Minimal Chrome DevTools Protocol client for the LOCAL UI e2e (Node's built-in WebSocket, 127.0.0.1 only).
//
// Browser: Chrome for Testing "chrome-headless-shell" ONLY (no updater, no background services). The installed
// desktop Chrome/Edge is never used: it launches its own updater outside the browser's network settings.
// Isolation, three layers: (1) host resolver resolves NOTHING but 127.0.0.1, (2) every non-loopback request goes to
// a dead proxy (127.0.0.1:1) so even IP literals cannot leave, (3) run.mjs's socket monitor + process-name check.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Where the verified Chrome for Testing headless shell lives (outside the repo); override with E2E_HEADLESS_SHELL. */
export const HEADLESS_SHELL = process.env.E2E_HEADLESS_SHELL ||
  join(process.env.LOCALAPPDATA || '', 'dairsharaf-test-tools', 'chrome-headless-shell', '155.0.8059.84', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');

export function chromeArgs(port, profileDir) {
  return [
    '--headless=new', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profileDir}`,
    // isolation: nothing but loopback resolves; everything else goes to a dead proxy; no background traffic
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
    '--proxy-server=http://127.0.0.1:1', '--proxy-bypass-list=127.0.0.1',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-extensions',
    '--disable-domain-reliability', '--no-pings', '--dns-prefetch-disable', '--metrics-recording-only', '--no-first-run',
    '--no-default-browser-check', '--disable-client-side-phishing-detection', '--password-store=basic', '--use-mock-keychain',
    '--disable-features=OptimizationHints,MediaRouter,Translate,AutofillServerCommunication,CertificateTransparencyComponentUpdater,DialMediaRouteProvider',
    '--disable-gpu', '--window-size=1280,900', 'about:blank',
  ];
}

export async function launchChrome({ port, tmpDir, track }) {
  const exe = HEADLESS_SHELL;
  // fail closed: no fallback to the desktop browser
  if (!existsSync(exe) || basename(exe).toLowerCase() !== 'chrome-headless-shell.exe') {
    throw new Error(`chrome-headless-shell not found at ${exe} — UI test refused (no fallback to the desktop browser)`);
  }
  const profile = join(tmpDir, 'chrome-profile');
  mkdirSync(profile, { recursive: true });
  const child = spawn(exe, chromeArgs(port, profile), { stdio: 'ignore' });
  track?.(child);
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return { child, exe };
    } catch {}
    await sleep(200);
  }
  throw new Error('Chrome DevTools endpoint did not start');
}

/** Open a new tab and return a small driver for it. */
export async function openTab(port) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('CDP websocket failed'));
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else resolve(msg.result);
    }
  };
  // every DevTools command has a time limit: a command that never gets an answer (e.g. an evaluate issued while the
  // page navigates) must fail and be retried by waitFor — never freeze the whole run
  const SEND_TIMEOUT_MS = 30_000;
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      const timer = setTimeout(() => {
        if (pending.delete(mid)) reject(new Error(`DevTools ${method}: no answer within ${SEND_TIMEOUT_MS} ms`));
      }, SEND_TIMEOUT_MS);
      pending.set(mid, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result?.value;
  };
  const waitFor = async (expression, timeoutMs = 20_000, label = expression) => {
    const end = Date.now() + timeoutMs;
    let last;
    while (Date.now() < end) {
      try {
        last = await evaluate(expression);
        if (last) return last;
      } catch {}
      await sleep(200);
    }
    throw new Error(`timeout waiting for: ${String(label).slice(0, 120)} (last=${JSON.stringify(last)})`);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  return {
    targetId: t.id,
    send,
    evaluate,
    waitFor,
    navigate: async (url) => {
      await send('Page.navigate', { url });
      await waitFor('document.readyState === "complete"', 30_000, `load ${url}`);
    },
    reload: async () => {
      await send('Page.reload', { ignoreCache: true });
      await sleep(300);
      await waitFor('document.readyState === "complete"', 30_000, 'reload');
    },
    close: async () => {
      try {
        await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`);
      } catch {}
      try {
        ws.close();
      } catch {}
    },
  };
}
