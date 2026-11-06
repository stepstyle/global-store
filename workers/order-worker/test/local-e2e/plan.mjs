// Fixed plan of the LOCAL e2e run: one demo project, fixed 127.0.0.1 ports, local config files.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const WORKER_ROOT = resolve(here, '../..');

export const PROJECT_ID = 'demo-dairsharaf-e2e';
export const PORTS = {
  emulator: 8087,
  // E2E_EMULATOR_WS_PORT: another free 127.0.0.1 port when 9152 is taken (e.g. by an unrelated emulator)
  emulatorWs: /^\d{4,5}$/.test(process.env.E2E_EMULATOR_WS_PORT || '') ? Number(process.env.E2E_EMULATOR_WS_PORT) : 9152,
  authEmulator: 9099, // Firebase Auth emulator (UI suite: real sign-in in the browser; its tokens are unsigned)
  hub: 4410,
  logging: 4510,
  order: 8787,
  sink: 8788,
  mock: 8789,
  orderInspector: 9330,
  sinkInspector: 9331,
  probe: 8791,
  probeInspector: 9332,
  vite: 3000, // the web app (Vite dev server, emulator mode) for the UI suite
  cdp: 9341, // headless Chrome DevTools endpoint for the UI suite
};
export const URLS = {
  order: `http://127.0.0.1:${PORTS.order}`,
  sink: `http://127.0.0.1:${PORTS.sink}`,
  mock: `http://127.0.0.1:${PORTS.mock}`,
  probe: `http://127.0.0.1:${PORTS.probe}`,
  firestore: `http://127.0.0.1:${PORTS.emulator}/v1`,
};
export const FILES = {
  orderToml: resolve(here, 'wrangler.order.toml'),
  sinkToml: resolve(here, 'wrangler.sink.toml'),
  probeToml: resolve(here, 'wrangler.cpuprobe.toml'),
  firebaseJson: resolve(here, 'firebase.json'),
  jail: resolve(here, 'net-jail.cjs'),
  monitor: resolve(here, 'monitor.ps1'),
  inner: resolve(here, 'inner.mjs'),
  wrangler: resolve(WORKER_ROOT, 'node_modules/wrangler/bin/wrangler.js'),
  compatRules: resolve(WORKER_ROOT, '../../firebase/rules-test/firestore.rules.compat'),
  // test-only proposals; selected with E2E_RULES=transition|final (default compat)
  transitionRules: resolve(WORKER_ROOT, '../../firebase/rules-test/firestore.rules.transition'),
  finalRules: resolve(WORKER_ROOT, '../../firebase/rules-test/firestore.rules.final'),
};
export const PLAN = {
  projectId: PROJECT_ID,
  ports: PORTS,
  urls: URLS,
  wranglerFiles: [FILES.orderToml, FILES.sinkToml, FILES.probeToml],
  firebaseJson: FILES.firebaseJson,
};
/** Accepted by the local Turnstile mock; any other value (or none) fails verification. */
export const TURNSTILE_PASS_TOKEN = 'local-e2e-turnstile-pass';
