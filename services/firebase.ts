// src/services/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { initializeFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';

let app: FirebaseApp | undefined;
let db: Firestore | null = null;
let auth: Auth | null = null;

/**
 * ✅ Keep it as boolean for simple UI checks
 * (your AdminDashboard uses it as a boolean)
 */
export let isFirebaseInitialized = false;

const STORAGE_KEY = 'anta_firebase_config';

const isBrowser = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined';

/** ✅ safe JSON parse */
const safeJsonParse = (value: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/** ✅ Initialize once */
const initWithConfig = (config: any) => {
  if (!config || typeof config !== 'object') throw new Error('Invalid Firebase config object');

  // If already initialized, skip
  if (isFirebaseInitialized && db && auth) return;

  // Reuse existing app if present
  app = getApps().length ? getApp() : initializeApp(config);

  db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
  });

  auth = getAuth(app);

  isFirebaseInitialized = true;
  console.log('🔥 Firebase initialized');
};

/**
 * ✅ Initialize Firebase safely in browser environments only
 * - Won’t crash SSR/build/tests
 */
export const initFirebase = () => {
  if (!isBrowser()) {
    // In SSR/build we keep mock mode
    isFirebaseInitialized = false;
    db = null;
    auth = null;
    return;
  }

  try {
    // 1) Try LocalStorage
    const storedConfig = safeJsonParse(localStorage.getItem(STORAGE_KEY));
    if (storedConfig) {
      initWithConfig(storedConfig);
      console.log('🔥 Firebase initialized from local config');
      return;
    }

    // 2) Hardcoded fallback (optional)
    const firebaseConfig = {
      apiKey: 'YOUR_API_KEY_HERE',
      authDomain: 'your-project.firebaseapp.com',
      projectId: 'your-project-id',
      storageBucket: 'your-project.appspot.com',
      messagingSenderId: '00000000000',
      appId: '1:00000000:web:00000000000',
    };

    if (firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY_HERE') {
      initWithConfig(firebaseConfig);
      console.log('🔥 Firebase initialized from hardcoded config');
      return;
    }

    console.log(
      'ℹ️ Running in Mock Mode (LocalStorage). Go to Admin Dashboard > Settings to connect Firebase.'
    );
    isFirebaseInitialized = false;
    db = null;
    auth = null;
  } catch (e) {
    console.error('Failed to init firebase', e);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    isFirebaseInitialized = false;
    db = null;
    auth = null;
  }
};

/**
 * ✅ Call init immediately (client-side safe)
 * If you ever move to SSR, it won't crash because of isBrowser()
 */
initFirebase();

/** ✅ Safer getters (prevents accidental null usage) */
export const getFirestoreDb = (): Firestore | null => db;
export const getFirebaseAuth = (): Auth | null => auth;

/** ✅ Optional helper for UI */
export const firebaseReady = () => isFirebaseInitialized && !!db && !!auth;

export const setFirebaseConfig = (config: any) => {
  if (!isBrowser()) throw new Error('Cannot set Firebase config outside browser');

  try {
    // Validate JSON-serializable
    JSON.stringify(config);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));

    // Reload safely
    window.location.reload();
  } catch {
    throw new Error('Invalid Firebase config');
  }
};

export const removeFirebaseConfig = () => {
  if (!isBrowser()) return;
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
};

/** Keep old exports for compatibility */
export { db, auth };