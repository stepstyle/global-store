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
  // optional legacy keys (ignored safely)
  databaseURL?: string;
};

let app: FirebaseApp | undefined;
let db: Firestore | null = null;
let auth: Auth | null = null;

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

const initWithConfig = (config: FirebaseWebConfig) => {
  if (isFirebaseInitialized && db && auth) return;

  app = getApps().length ? getApp() : initializeApp(config);

  db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
  });

  auth = getAuth(app);

  isFirebaseInitialized = true;
  if (import.meta.env.DEV) console.log('🔥 Firebase initialized');
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
 * Priority:
 * 1) LocalStorage config (Admin override)
 * 2) Env config (recommended)
 * 3) Mock mode
 */
export const initFirebase = () => {
  if (!isBrowser()) {
    resetToMock('non-browser environment');
    return;
  }

  try {
    const localCfg = getLocalConfig();
    if (localCfg) {
      initWithConfig(localCfg);
      if (import.meta.env.DEV) console.log('🔥 Firebase initialized from localStorage config');
      return;
    }

    const envCfg = getEnvConfig();
    if (envCfg) {
      initWithConfig(envCfg);
      if (import.meta.env.DEV) console.log('🔥 Firebase initialized from env config');
      return;
    }

    resetToMock('missing/invalid config');
  } catch (e) {
    if (import.meta.env.DEV) console.error('Failed to init Firebase', e);
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
export const firebaseReady = () => isFirebaseInitialized && !!db && !!auth;

/**
 * ✅ Allow Admin UI to set config (stored locally per browser)
 * NOTE: per-device. For production, use VITE_* env.
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