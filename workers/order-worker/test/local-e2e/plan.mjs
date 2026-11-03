// Fixed plan of the LOCAL e2e run: one demo project, fixed 127.0.0.1 ports, local config files.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const WORKER_ROOT = resolve(here, '../..');

export const PROJECT_ID = 'demo-dairsharaf-e2e';
export const PORTS = {
  emulator: 8087,
  emulatorWs: 9152,
  hub: 4410,
  logging: 4510,
  order: 8787,
  sink: 8788,
  mock: 8789,
  orderInspector: 9330,
  sinkInspector: 9331,
};
export const URLS = {
  order: `http://127.0.0.1:${PORTS.order}`,
  sink: `http://127.0.0.1:${PORTS.sink}`,
  mock: `http://127.0.0.1:${PORTS.mock}`,
  firestore: `http://127.0.0.1:${PORTS.emulator}/v1`,
};
export const FILES = {
  orderToml: resolve(here, 'wrangler.order.toml'),
  sinkToml: resolve(here, 'wrangler.sink.toml'),
  firebaseJson: resolve(here, 'firebase.json'),
  jail: resolve(here, 'net-jail.cjs'),
  monitor: resolve(here, 'monitor.ps1'),
  inner: resolve(here, 'inner.mjs'),
  wrangler: resolve(WORKER_ROOT, 'node_modules/wrangler/bin/wrangler.js'),
  compatRules: resolve(WORKER_ROOT, '../../firebase/rules-test/firestore.rules.compat'),
};
export const PLAN = {
  projectId: PROJECT_ID,
  ports: PORTS,
  urls: URLS,
  wranglerFiles: [FILES.orderToml, FILES.sinkToml],
  firebaseJson: FILES.firebaseJson,
};
/** Accepted by the local Turnstile mock; any other value (or none) fails verification. */
export const TURNSTILE_PASS_TOKEN = 'local-e2e-turnstile-pass';
