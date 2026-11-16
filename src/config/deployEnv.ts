// src/config/deployEnv.ts
// Fail-closed deployment guard. The value is fixed at BUILD time by vite.config.ts (see resolveDeployEnv):
//   'production' only for a Vercel Production build (VERCEL=1 + VERCEL_ENV=production), or an explicit
//   off-Vercel STORE_BUILD_TARGET=production build.
//   'local-test' only off Vercel with an explicit VITE_FIREBASE_TARGET=emulator|staging: the app talks to the
//   Firebase Emulator / the Staging project and a local Worker (validated by tools/firebase-env-guard.ts and
//   src/services/firebaseTarget.ts), never to production. No e-mail, upload, tracking or WhatsApp hand-off.
//   Anything else (Preview, Development, local, unset, unknown) is 'sandbox': no Firebase, no Worker, no e-mail,
//   no uploads, no tracking.
declare const __DEPLOY_ENV__: 'production' | 'sandbox' | 'local-test';

export type DeployEnv = 'production' | 'sandbox' | 'local-test';

export const DEPLOY_ENV: DeployEnv =
  __DEPLOY_ENV__ === 'production' ? 'production' : __DEPLOY_ENV__ === 'local-test' ? 'local-test' : 'sandbox';
export const IS_LIVE: boolean = __DEPLOY_ENV__ === 'production';
export const IS_LOCAL_TEST: boolean = __DEPLOY_ENV__ === 'local-test';
/** A backend (Firebase + order Worker) may be used: production, or the validated local Emulator/Staging target. */
export const BACKEND_ENABLED: boolean = __DEPLOY_ENV__ === 'production' || __DEPLOY_ENV__ === 'local-test';

export class SandboxBlockedError extends Error {
  readonly code = 'SANDBOX_BLOCKED';
  constructor(readonly operation: string) {
    super(`نسخة اختبار: العملية "${operation}" معطّلة ولا تصل إلى أي خدمة حقيقية.`);
    this.name = 'SandboxBlockedError';
  }
}

/** Throws unless this is the live production build. Call before any write or outbound side effect. */
export const requireLive = (operation: string): void => {
  if (__DEPLOY_ENV__ !== 'production') throw new SandboxBlockedError(operation);
};
