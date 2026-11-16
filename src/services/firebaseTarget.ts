// Decides which Firebase backend the web app talks to. Pure: no imports, no side effects, unit-tested.
//
// Fail-closed rules
// - Local development (Vite dev server, import.meta.env.DEV): ONLY the emulator target is accepted —
//   a "demo-" project, emulators on 127.0.0.1, no production identifier anywhere, and no Firebase config
//   saved in the browser (localStorage override). Anything else throws FirebaseTargetError.
// - Production builds (no VITE_FIREBASE_TARGET, or "production"): unchanged behaviour — the inline production
//   config from firebase.ts, or the admin's localStorage override exactly as before. No new variable needed.
// - VITE_FIREBASE_TARGET=emulator in a build: emulator config (local preview only; Vercel builds are refused
//   by tools/firebase-env-guard.ts).

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
  databaseURL?: string;
};

export type LoopbackEndpoint = { host: '127.0.0.1'; port: number };

export type FirebaseTarget =
  | { kind: 'production'; config: FirebaseWebConfig; source: 'inline' | 'localStorage' }
  | { kind: 'emulator'; config: FirebaseWebConfig; firestore: LoopbackEndpoint; auth: LoopbackEndpoint }
  /** local development against the cloud STAGING project; orders go through the local staging proxy only */
  | { kind: 'staging'; config: FirebaseWebConfig; workerUrl: string };

export type ResolveInput = {
  isDev: boolean;
  env: Record<string, unknown>;
  productionConfig: FirebaseWebConfig | null;
  localOverride: FirebaseWebConfig | null;
};

export class FirebaseTargetError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(`FIREBASE TARGET REFUSED:\n - ${problems.join('\n - ')}`);
    this.name = 'FirebaseTargetError';
    this.problems = problems;
  }
}

export const DEMO_PROJECT_RE = /^demo-[a-z0-9-]{1,40}$/;
const LOOPBACK_RE = /^127\.0\.0\.1:(\d{2,5})$/;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** "127.0.0.1:<port>" only — no localhost, no LAN address, no scheme. */
export function parseLoopbackEndpoint(value: unknown, name: string, problems: string[]): LoopbackEndpoint | null {
  const m = str(value).match(LOOPBACK_RE);
  const port = m ? Number(m[1]) : NaN;
  if (!m || port < 1024 || port > 65535) {
    problems.push(`${name} must be 127.0.0.1:<port> (got "${str(value) || 'unset'}")`);
    return null;
  }
  return { host: '127.0.0.1', port };
}

/** Identifiers of the production web app that must never appear in a local/emulator configuration. */
export function productionIdentifiers(cfg: FirebaseWebConfig | null): string[] {
  if (!cfg) return [];
  return [cfg.projectId, cfg.apiKey, cfg.appId, cfg.messagingSenderId, cfg.authDomain, cfg.storageBucket, cfg.databaseURL, cfg.measurementId]
    .map(str)
    .filter((v) => v.length >= 6);
}

function emulatorTarget(env: Record<string, unknown>, productionConfig: FirebaseWebConfig | null): FirebaseTarget {
  const problems: string[] = [];
  const projectId = str(env.VITE_FIREBASE_PROJECT_ID);
  if (!DEMO_PROJECT_RE.test(projectId)) problems.push(`VITE_FIREBASE_PROJECT_ID must be a "demo-" project (got "${projectId || 'unset'}")`);

  const forbidden = productionIdentifiers(productionConfig);
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith('VITE_')) continue;
    const val = str(v);
    if (val && forbidden.some((id) => val.includes(id))) problems.push(`${k} contains a production Firebase identifier`);
  }

  const firestore = parseLoopbackEndpoint(env.VITE_FIRESTORE_EMULATOR_HOST, 'VITE_FIRESTORE_EMULATOR_HOST', problems);
  const auth = parseLoopbackEndpoint(env.VITE_AUTH_EMULATOR_HOST, 'VITE_AUTH_EMULATOR_HOST', problems);
  if (firestore && auth && firestore.port === auth.port) problems.push('Firestore and Auth emulators must use different ports');
  if (problems.length || !firestore || !auth) throw new FirebaseTargetError(problems);

  return {
    kind: 'emulator',
    firestore,
    auth,
    // Fake, non-secret values: the emulators accept any key for a demo- project.
    config: {
      apiKey: 'demo-local-api-key',
      authDomain: `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: `${projectId}.appspot.com`,
      messagingSenderId: '000000000000',
      appId: '1:000000000000:web:0000000000000000',
    },
  };
}

// ---- staging (local development only) --------------------------------------------------------------------------
/** The ONE cloud project the staging target may use (exact match — no pattern, no other "-staging" project). */
export const STAGING_PROJECT_ID = 'dairsharaf-staging';
/** the local staging proxy (workers/order-worker/staging/proxy.mjs): http://127.0.0.1:<port>, nothing else */
const STAGING_PROXY_RE = /^http:\/\/127\.0\.0\.1:(\d{4,5})$/;
/** the ONLY VITE_ variables a staging session may carry (public Firebase web identifiers + the local proxy URL) */
export const STAGING_ALLOWED_VITE_KEYS: readonly string[] = Object.freeze([
  'VITE_FIREBASE_TARGET', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_WORKER_URL',
  'VITE_TURNSTILE_SITE_KEY',
]);
/** Cloudflare's public Turnstile TEST site keys — the only ones a staging session may use (the staging Worker's
 *  TURNSTILE_SECRET is the always-pass TEST secret, which accepts only the dummy tokens these keys produce). */
export const TURNSTILE_TEST_SITE_KEY_RE = /^[123]x0{20}[A-F]{2}$/;

function stagingTarget(env: Record<string, unknown>, productionConfig: FirebaseWebConfig | null): FirebaseTarget {
  const problems: string[] = [];
  const projectId = str(env.VITE_FIREBASE_PROJECT_ID);
  if (projectId !== STAGING_PROJECT_ID) problems.push(`staging target requires VITE_FIREBASE_PROJECT_ID=${STAGING_PROJECT_ID} (got "${projectId || 'unset'}")`);

  const forbidden = productionIdentifiers(productionConfig);
  if (!productionConfig) problems.push('cannot read the production Firebase identifiers — staging refused (fail-closed)');
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith('VITE_')) continue;
    const val = str(v);
    if (val && forbidden.some((id) => val.includes(id))) problems.push(`${k} contains a production Firebase identifier`);
  }

  const apiKey = str(env.VITE_FIREBASE_API_KEY);
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(apiKey)) problems.push('VITE_FIREBASE_API_KEY (staging web key) missing or malformed');
  const appId = str(env.VITE_FIREBASE_APP_ID);
  const appM = appId.match(/^1:(\d{6,20}):web:[0-9a-f]{6,40}$/);
  if (!appM) problems.push('VITE_FIREBASE_APP_ID (staging web app id) missing or malformed');
  const authDomain = str(env.VITE_FIREBASE_AUTH_DOMAIN) || `${projectId}.firebaseapp.com`;
  if (authDomain !== `${projectId}.firebaseapp.com`) problems.push(`VITE_FIREBASE_AUTH_DOMAIN must be ${projectId}.firebaseapp.com`);
  const storageBucket = str(env.VITE_FIREBASE_STORAGE_BUCKET) || `${projectId}.firebasestorage.app`;
  if (!storageBucket.startsWith(`${projectId}.`)) problems.push('VITE_FIREBASE_STORAGE_BUCKET must belong to the staging project');
  const sender = str(env.VITE_FIREBASE_MESSAGING_SENDER_ID) || (appM ? appM[1] : '');
  if (appM && sender !== appM[1]) problems.push('VITE_FIREBASE_MESSAGING_SENDER_ID does not match VITE_FIREBASE_APP_ID');
  const tsKey = str(env.VITE_TURNSTILE_SITE_KEY);
  if (tsKey && !TURNSTILE_TEST_SITE_KEY_RE.test(tsKey)) problems.push('VITE_TURNSTILE_SITE_KEY must be a Cloudflare Turnstile TEST site key in staging');
  // no analytics / measurement for a staging session
  if (str(env.VITE_FIREBASE_MEASUREMENT_ID)) problems.push('VITE_FIREBASE_MEASUREMENT_ID must be empty for staging');
  // emulator settings mixed in would make it ambiguous which backend is used
  for (const k of ['VITE_FIRESTORE_EMULATOR_HOST', 'VITE_AUTH_EMULATOR_HOST']) if (str(env[k])) problems.push(`${k} must be empty for the staging target`);
  // orders: ONLY through the local staging proxy (it adds the staging access secret; the browser never sees it)
  const workerUrl = str(env.VITE_WORKER_URL);
  if (!STAGING_PROXY_RE.test(workerUrl)) problems.push('staging target requires VITE_WORKER_URL=http://127.0.0.1:<port> (the local staging proxy)');
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith('VITE_')) continue;
    // allow-list: Vite also copies VITE_* from the inherited shell environment (e.g. VITE_GEMINI_API_KEY) into the
    // browser bundle — in staging nothing but the public staging Firebase identifiers and the proxy URL may pass
    if (!STAGING_ALLOWED_VITE_KEYS.includes(k)) problems.push(`${k} is not allowed in the staging target (only ${STAGING_ALLOWED_VITE_KEYS.join(', ')})`);
    if (/STAGING_ACCESS|WORKER_AUTH|SINK_|PRIVATE_KEY|SECRET|TOKEN/i.test(k)) problems.push(`${k}: secrets never go into VITE_ variables`);
    else if (/[0-9a-f]{64}/i.test(str(v))) problems.push(`${k} looks like a secret token — never in VITE_ variables`);
  }
  if (problems.length) throw new FirebaseTargetError(problems);

  return {
    kind: 'staging',
    workerUrl,
    config: { apiKey, authDomain, projectId, storageBucket, messagingSenderId: sender, appId },
  };
}

export function resolveFirebaseTarget({ isDev, env, productionConfig, localOverride }: ResolveInput): FirebaseTarget {
  const target = str(env.VITE_FIREBASE_TARGET).toLowerCase();

  if (isDev) {
    const problems: string[] = [];
    if (target !== 'emulator' && target !== 'staging') {
      problems.push('local development requires VITE_FIREBASE_TARGET=emulator (copy .env.example to .env.development.local), or =staging with the local staging proxy (.env.staging.example)');
    }
    if (localOverride) problems.push('a Firebase config saved in this browser (localStorage "anta_firebase_config") is not allowed in local development — remove it');
    if (problems.length) throw new FirebaseTargetError(problems);
  }

  if (target === 'emulator') return emulatorTarget(env, productionConfig);

  if (target === 'staging') {
    // never part of a build: a staging bundle could be deployed or previewed by mistake
    if (!isDev) throw new FirebaseTargetError(['VITE_FIREBASE_TARGET=staging is for the local dev server only — never a build']);
    return stagingTarget(env, productionConfig);
  }

  if (target === '' || target === 'production') {
    if (localOverride) return { kind: 'production', config: localOverride, source: 'localStorage' };
    if (productionConfig) return { kind: 'production', config: productionConfig, source: 'inline' };
    throw new FirebaseTargetError(['no production Firebase config available']);
  }

  throw new FirebaseTargetError([`unknown VITE_FIREBASE_TARGET "${target}" (allowed: production, emulator, staging [dev only])`]);
}
