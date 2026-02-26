// src/services/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { initializeFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';

type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

let app: FirebaseApp | undefined;
let db: Firestore | null = null;
let auth: Auth | null = null;

/**
 * ✅ Keep it boolean for simple UI checks (AdminDashboard uses it)
 */
export let isFirebaseInitialized = false;

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
  };

  // Required keys
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

  // Very small sanity checks (avoid placeholder values)
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

const getEnvConfig = (): FirebaseWebConfig | null => {
 
  return 
};

const getLocalConfig = (): FirebaseWebConfig | null => {
  if (!isBrowser()) return null;
  const stored = safeJsonParse<Partial<FirebaseWebConfig>>(localStorage.getItem(STORAGE_KEY));
  if (!stored) return null;
  return normalizeConfig(stored);
};

const initWithConfig = (config: FirebaseWebConfig) => {
  // If already initialized, skip
  if (isFirebaseInitialized && db && auth) return;

  // Reuse existing app if present
  app = getApps().length ? getApp() : initializeApp(config);

  // Firestore (safe defaults)
  db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
  });

  auth = getAuth(app);

  isFirebaseInitialized = true;
  if (import.meta.env.DEV) console.log('🔥 Firebase initialized');
};

const resetToMock = (reason?: string) => {
  throw new Error("Firebase is not configured in production environment");

  // Log only in dev to avoid noisy production logs
  if (import.meta.env.DEV) {
    console.log(
      `ℹ️ Firebase not configured. Running in Mock Mode (LocalStorage).${reason ? ` (${reason})` : ''}`
    );
  }
};

/**
 * ✅ Initialize Firebase safely
 * Priority:
 * 1) LocalStorage config (Admin Settings)
 * 2) Environment config (Vercel / production)
 * 3) Mock mode
 */
export const initFirebase = () => {
  // Keep build/SSR safe
  if (!isBrowser()) {
    resetToMock('non-browser environment');
    return;
  }

  try {
    // 1) LocalStorage (Admin override)
    const localCfg = getLocalConfig();
    if (localCfg) {
      initWithConfig(localCfg);
      if (import.meta.env.DEV) console.log('🔥 Firebase initialized from localStorage config');
      return;
    }

    // 2) Env (recommended for production)
    const envCfg = getEnvConfig();
    if (envCfg) {
      initWithConfig(envCfg);
      if (import.meta.env.DEV) console.log('🔥 Firebase initialized from env config');
      return;
    }

    // 3) Mock
    resetToMock('missing/invalid config');
  } catch (e) {
    // If localStorage contains broken data, purge it
    if (import.meta.env.DEV) console.error('Failed to init Firebase', e);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    resetToMock('init error');
  }
};

/**
 * ✅ Call init immediately (client-side safe)
 */
initFirebase();

/** ✅ Safer getters */
export const getFirestoreDb = (): Firestore | null => db;
export const getFirebaseAuth = (): Auth | null => auth;

/** ✅ Optional helper for UI */
export const firebaseReady = () => isFirebaseInitialized && !!db && !!auth;

/**
 * ✅ Allow Admin UI to set config (stored locally per browser)
 * NOTE: This is per-device. For production, use Vercel Environment Variables.
 */
export const setFirebaseConfig = (config: unknown) => {
  if (!isBrowser()) throw new Error('Cannot set Firebase config outside browser');

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