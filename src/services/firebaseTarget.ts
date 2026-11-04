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
  | { kind: 'emulator'; config: FirebaseWebConfig; firestore: LoopbackEndpoint; auth: LoopbackEndpoint };

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

export function resolveFirebaseTarget({ isDev, env, productionConfig, localOverride }: ResolveInput): FirebaseTarget {
  const target = str(env.VITE_FIREBASE_TARGET).toLowerCase();

  if (isDev) {
    const problems: string[] = [];
    if (target !== 'emulator') problems.push('local development requires VITE_FIREBASE_TARGET=emulator (copy .env.example to .env.development.local)');
    if (localOverride) problems.push('a Firebase config saved in this browser (localStorage "anta_firebase_config") is not allowed in local development — remove it');
    if (problems.length) throw new FirebaseTargetError(problems);
  }

  if (target === 'emulator') return emulatorTarget(env, productionConfig);

  if (target === '' || target === 'production') {
    if (localOverride) return { kind: 'production', config: localOverride, source: 'localStorage' };
    if (productionConfig) return { kind: 'production', config: productionConfig, source: 'inline' };
    throw new FirebaseTargetError(['no production Firebase config available']);
  }

  throw new FirebaseTargetError([`unknown VITE_FIREBASE_TARGET "${target}" (allowed: production, emulator)`]);
}
