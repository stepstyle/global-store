// scripts/deploy-env.mjs — build-time, fail-closed decision used by vite.config.ts (and by the guard tests).
//
//   'production' when VERCEL_ENV === 'production' exactly (set by Vercel itself for Production deployments).
//   On Vercel (VERCEL=1 or any VERCEL_ENV present): everything else => 'sandbox' — 'preview', 'development',
//                          unset, empty, other case, extra spaces. STORE_BUILD_TARGET is ignored there, so no project
//                          variable can open the guard on a Preview.
//   Off Vercel:            'production' ONLY with an explicit STORE_BUILD_TARGET=production (manual release build,
//                          e.g. Firebase Hosting).
//                          'local-test' ONLY with an explicit VITE_FIREBASE_TARGET=emulator|staging (the local
//                          Emulator / Staging test runs). That target is validated separately and fail-closed by
//                          tools/firebase-env-guard.ts + src/services/firebaseTarget.ts (demo-/staging project only,
//                          loopback URLs, no production identifier), and it can never apply on Vercel.
//                          Plain `npm run build` / `npm run dev` => 'sandbox'.
export const LOCAL_TEST_TARGETS = Object.freeze(['emulator', 'staging']);

/**
 * @param {Record<string, string | undefined>} env  process.env
 * @param {{ firebaseTarget?: string }} [opts]       VITE_FIREBASE_TARGET as Vite loads it for this mode (env files + process.env)
 */
export function resolveDeployEnv(env, { firebaseTarget } = {}) {
  if (env.VERCEL_ENV === 'production') {
    return { deployEnv: 'production', reason: 'VERCEL_ENV="production"' };
  }
  const onVercel = env.VERCEL === '1' || env.VERCEL_ENV !== undefined;
  if (onVercel) {
    return { deployEnv: 'sandbox', reason: `on Vercel, VERCEL_ENV=${describe(env.VERCEL_ENV)}` };
  }
  if (env.STORE_BUILD_TARGET === 'production') {
    return { deployEnv: 'production', reason: 'not on Vercel, STORE_BUILD_TARGET="production"' };
  }
  if (LOCAL_TEST_TARGETS.includes(firebaseTarget)) {
    return { deployEnv: 'local-test', reason: `not on Vercel, VITE_FIREBASE_TARGET=${describe(firebaseTarget)}` };
  }
  return { deployEnv: 'sandbox', reason: `not on Vercel, STORE_BUILD_TARGET=${describe(env.STORE_BUILD_TARGET)}` };
}

const describe = (v) => (v === undefined ? '(unset)' : JSON.stringify(v));

// Tracking tags removed from index.html in sandbox builds (Google Analytics gtag + Meta Pixel).
const TRACKING_SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const TRACKING_MARKERS = /googletagmanager\.com|gtag\(|fbq\(|connect\.facebook\.net|facebook\.com\/tr/i;
const TRACKING_NOSCRIPT = /<noscript\b[^>]*>[\s\S]*?facebook\.com\/tr[\s\S]*?<\/noscript>/gi;

/** @param {string} html */
export function stripTracking(html) {
  return html
    .replace(TRACKING_SCRIPT, (tag) => (TRACKING_MARKERS.test(tag) ? '' : tag))
    .replace(TRACKING_NOSCRIPT, '');
}

// Env prefix that nothing sets: a sandbox build exposes NO VITE_* value (worker URL, Gemini key, ...).
export const SANDBOX_ENV_PREFIX = 'SANDBOX_EXPOSES_NO_ENV__';
