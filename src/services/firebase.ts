// src/services/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { initializeFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { resolveFirebaseTarget, FirebaseTargetError, type FirebaseWebConfig, type FirebaseTarget } from './firebaseTarget';

let app: FirebaseApp | undefined;
let db: Firestore | null = null;
let auth: Auth | null = null;

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

  let target: FirebaseTarget;
  try {
    target = resolveFirebaseTarget({
      isDev: import.meta.env.DEV,
      env: import.meta.env,
      productionConfig: getEnvConfig(),
      localOverride: getLocalConfig(),
    });
  } catch (e) {
    if (e instanceof FirebaseTargetError && import.meta.env.DEV) refuseLocal(e);
    resetToMock('missing/invalid config');
    return;
  }

  try {
    initWithTarget(target);
    if (import.meta.env.DEV) console.log(`🔥 Firebase config source: ${target.kind === 'production' ? target.source : 'emulator'}`);
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