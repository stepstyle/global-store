// src/services/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { initializeFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { resolveFirebaseTarget, FirebaseTargetError, type FirebaseWebConfig, type FirebaseTarget } from './firebaseTarget';
import { requireLive } from '../config/deployEnv';

declare const __DEPLOY_ENV__: 'production' | 'sandbox' | 'local-test';

let app: FirebaseApp | undefined;
let db: Firestore | null = null;
let auth: Auth | null = null;
/** the target Firebase was initialised with (production / emulator / staging): the Lite catalogue read uses the same */
let activeTarget: FirebaseTarget | null = null;

export let isFirebaseInitialized = false;
/** a valid config was found but initialising Firebase FAILED: a signed-in customer cannot be recognised -> identity unknown */
let initFailed = false;

const STORAGE_KEY = 'anta_firebase_config';

const isBrowser = (): boolean =>
  typeof window !== 'undefined' && typeof localStorage !== 'undefined';

const safeJsonParse = <T,>(value: string | null): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

const normalizeConfig = (cfg: Partial<FirebaseWebConfig>): FirebaseWebConfig | null => {
  const out: Partial<FirebaseWebConfig> = {
    apiKey: cfg.apiKey?.trim(),
    authDomain: cfg.authDomain?.trim(),
    projectId: cfg.projectId?.trim(),
    storageBucket: cfg.storageBucket?.trim(),
    messagingSenderId: cfg.messagingSenderId?.trim(),
    appId: cfg.appId?.trim(),
    measurementId: cfg.measurementId?.trim(),
    databaseURL: cfg.databaseURL?.trim(),
  };

  const required: (keyof FirebaseWebConfig)[] = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId',
  ];

  for (const k of required) {
    if (!isNonEmptyString(out[k])) return null;
  }

  // simple sanity checks
  if (
    out.apiKey === 'YOUR_API_KEY_HERE' ||
    out.projectId === 'your-project-id' ||
    out.authDomain?.includes('your-project') ||
    out.storageBucket?.includes('your-project')
  ) {
    return null;
  }

  return out as FirebaseWebConfig;
};

/**
 * ✅ Recommended: set via Vercel/Netlify environment variables (VITE_*)
 * For now you already hardcoded your config here — it works.
 */
const getEnvConfig = (): FirebaseWebConfig | null => {
  // 🛡️ Deploy guard: the production project config exists ONLY in the production build. In a sandbox build
  // (Preview / Development / local) this check is the constant `false`, so the bundler removes the config below.
  if (__DEPLOY_ENV__ !== 'production') return null;

  // Option A: Use VITE_* env (production best practice)
  // const cfg: Partial<FirebaseWebConfig> = {
  //   apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  //   authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  //   projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  //   storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  //   messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  //   appId: import.meta.env.VITE_FIREBASE_APP_ID,
  //   measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  // };

  // Option B: Your current inline config (OK for dev/project)
  const cfg: Partial<FirebaseWebConfig> = {
    apiKey: 'AIzaSyClkSIiIkMIXgIafRh4PwnAQTgUdg2SmpM',
    authDomain: "auth.dairsharaf.com",
    projectId: 'antastore1-82b50',
    storageBucket: 'antastore1-82b50.firebasestorage.app',
    messagingSenderId: '503316431812',
    appId: '1:503316431812:web:89c78ebf26769e0cb45a91',
    measurementId: 'G-0451BYDEC2',
    databaseURL: 'https://antastore1-82b50-default-rtdb.firebaseio.com',
  };

  return normalizeConfig(cfg);
};

const getLocalConfig = (): FirebaseWebConfig | null => {
  if (!isBrowser()) return null;
  const stored = safeJsonParse<Partial<FirebaseWebConfig>>(localStorage.getItem(STORAGE_KEY));
  if (!stored) return null;
  return normalizeConfig(stored);
};

const initWithTarget = (target: FirebaseTarget) => {
  if (isFirebaseInitialized && db && auth) return;

  app = getApps().length ? getApp() : initializeApp(target.config);

  db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
  });

  auth = getAuth(app);

  if (target.kind === 'emulator') {
    // Must run before any read/write: every request then goes to 127.0.0.1 only.
    connectFirestoreEmulator(db, target.firestore.host, target.firestore.port);
    connectAuthEmulator(auth, `http://${target.auth.host}:${target.auth.port}`, { disableWarnings: true });
  }

  isFirebaseInitialized = true;
  activeTarget = target;
  if (import.meta.env.DEV) console.log(`🔥 Firebase initialized (${target.kind}: ${target.config.projectId})`);
};

/** Local development refused: stop here and say why (nothing is initialised, nothing is contacted). */
const refuseLocal = (e: FirebaseTargetError): never => {
  isFirebaseInitialized = false;
  db = null;
  auth = null;
  try {
    const box = document.createElement('pre');
    box.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;margin:0;padding:24px;background:#7f1d1d;color:#fff;font:14px/1.5 monospace;white-space:pre-wrap;overflow:auto');
    box.textContent = `${e.message}\n\nSee .env.example — local development runs against the Firebase Emulator only.`;
    document.body.appendChild(box);
  } catch {}
  throw e;
};

const resetToMock = (reason?: string) => {
  // ✅ do not crash the app
  isFirebaseInitialized = false;
  db = null;
  auth = null;

  if (import.meta.env.DEV) {
    console.log(
      `ℹ️ Firebase not configured. Running in Mock Mode (LocalStorage).${reason ? ` (${reason})` : ''}`
    );
  }
};

/**
 * ✅ Initialize Firebase safely
 * Production build (unchanged): 1) LocalStorage config (Admin override) 2) inline config 3) Mock mode
 * Local development: Firebase Emulator + demo- project ONLY (see firebaseTarget.ts) — otherwise refused.
 */
export const initFirebase = () => {
  if (!isBrowser()) {
    resetToMock('non-browser environment');
    return;
  }

  // 🛡️ Deploy guard (fail-closed): a sandbox build never connects to ANY Firebase project, and never reads the
  // localStorage override (it could point back at production). It runs in Mock Mode (LocalStorage) only.
  if (__DEPLOY_ENV__ !== 'production' && __DEPLOY_ENV__ !== 'local-test') {
    resetToMock('sandbox build');
    return;
  }

  let target: FirebaseTarget;
  try {
    target = resolveFirebaseTarget({
      isDev: import.meta.env.DEV,
      env: import.meta.env,
      // getEnvConfig() is null outside production; the admin's localStorage override is read in production only
      productionConfig: getEnvConfig(),
      localOverride: __DEPLOY_ENV__ === 'production' ? getLocalConfig() : null,
    });
  } catch (e) {
    if (e instanceof FirebaseTargetError && import.meta.env.DEV) refuseLocal(e);
    resetToMock('missing/invalid config');
    return;
  }

  // 🛡️ local-test exists only for the Emulator / Staging targets: anything else falls back to Mock Mode.
  if (__DEPLOY_ENV__ === 'local-test' && target.kind === 'production') {
    resetToMock('local-test build never uses production');
    return;
  }

  try {
    initWithTarget(target);
    if (import.meta.env.DEV) console.log(`🔥 Firebase config source: ${target.kind === 'production' ? target.source : target.kind}`);
  } catch (e) {
    if (import.meta.env.DEV) console.error('Failed to init Firebase', e);
    initFailed = true;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    resetToMock('init error');
  }
};

// ✅ initialize immediately (client-side safe)
initFirebase();

// ---------------------------------------------------------------- the public catalogue read: Firestore Lite (REST)
// The full SDK reads through a WebChannel stream: several round trips before the first document (measured on the live
// site: ~6 s from its start to the products, before any product photo can be asked for). The catalogue is a one-shot
// PUBLIC read (rules: products `allow read: if true`), so it goes through Firestore Lite: ONE HTTPS request, same data,
// same project / emulator, no cache (always the server's current prices and stock). Everything else (orders, auth,
// admin writes, transactions) stays on the full SDK. Loaded as its own chunk, started right away (in parallel with the
// first render).
// It runs on a SEPARATE app instance (same project / options) WITHOUT Auth: Firestore attached to the main app waits for
// Auth to be ready before its first request, and on phones Auth first loads Google's sign-in frame (api.js + iframe) —
// measured locally: the catalogue request started only after that frame, 10–20 s later on a throttled phone. A public
// read needs no sign-in token, so it never waits for it. (Sign-in, orders and the dashboard keep the main app.)
type LiteMod = typeof import('firebase/firestore/lite');
let litePromise: Promise<{ m: LiteMod; db: import('firebase/firestore/lite').Firestore }> | null = null;
const CATALOGUE_APP = 'catalogue-public-read';
export const firestoreLite = (): Promise<{ m: LiteMod; db: import('firebase/firestore/lite').Firestore }> | null => {
  if (!app || !isFirebaseInitialized || !activeTarget) return null;
  if (!litePromise) {
    const options = app.options;
    const target = activeTarget;
    litePromise = import('firebase/firestore/lite').then((m) => {
      const existing = getApps().find((x) => x.name === CATALOGUE_APP);
      const ldb = m.getFirestore(existing || initializeApp(options, CATALOGUE_APP));
      if (target.kind === 'emulator') m.connectFirestoreEmulator(ldb, target.firestore.host, target.firestore.port);
      return { m, db: ldb };
    });
    litePromise.catch(() => { litePromise = null; });
  }
  return litePromise;
};
if (isBrowser()) void firestoreLite()?.catch(() => {});

/** ✅ Safe getters */
export const getFirestoreDb = (): Firestore | null => db;
export const getFirebaseAuth = (): Auth | null => auth;
/** Who uses this browser now ('guest' or the Firebase uid) — AFTER Firebase restored any saved session (a check made
 * too early would take a signed-in customer for a guest). */
export const IDENTITY_TIMEOUT_MS = 5_000;
/**
 * 'guest' | the Firebase uid | null = UNKNOWN (the saved session could not be restored in time, or restoring failed).
 * Callers must treat null as "do not show or restore anything bound to an identity" (never as a guest).
 * Not a security barrier: it only keeps one account's order data out of another account's pages on a shared browser.
 */
export async function currentIdentity(timeoutMs: number = IDENTITY_TIMEOUT_MS): Promise<string | null> {
  // not configured on this site: nobody can be signed in (a guest for sure). Configured but FAILED: unknown.
  if (!auth) return initFailed ? null : 'guest';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ready = typeof auth.authStateReady === 'function' ? auth.authStateReady().then(() => true) : Promise.resolve(true);
    const timedOut = new Promise<boolean>((r) => {
      timer = setTimeout(() => r(false), timeoutMs);
    });
    if (!(await Promise.race([ready, timedOut]))) return null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
  return auth.currentUser?.uid || 'guest';
}
export const firebaseReady = () => isFirebaseInitialized && !!db && !!auth;

/**
 * ✅ Allow Admin UI to set config (stored locally per browser)
 * NOTE: per-device. For production, use VITE_* env.
 */
export const setFirebaseConfig = (config: unknown) => {
  requireLive('firebase-config-override');
  if (!isBrowser()) throw new Error('Cannot set Firebase config outside browser');
  if (import.meta.env.DEV) throw new Error('Saving a Firebase config is disabled in local development (emulator only)');

  const normalized = normalizeConfig((config ?? {}) as Partial<FirebaseWebConfig>);
  if (!normalized) throw new Error('Invalid Firebase config');

  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.location.reload();
};

export const removeFirebaseConfig = () => {
  if (!isBrowser()) return;
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
};

/** Keep old exports for compatibility */
export { db, auth };