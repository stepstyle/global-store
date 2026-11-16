// src/config/deployEnv.ts
// Fail-closed deployment guard. The value is fixed at BUILD time by vite.config.ts (see resolveDeployEnv):
//   'production' only for a Vercel Production build (VERCEL=1 + VERCEL_ENV=production), or an explicit
//   off-Vercel STORE_BUILD_TARGET=production build. Anything else (Preview, Development, local, unset,
//   unknown) is 'sandbox': no production Firebase, no Worker, no e-mail, no uploads, no tracking.
declare const __DEPLOY_ENV__: 'production' | 'sandbox';

export type DeployEnv = 'production' | 'sandbox';

export const DEPLOY_ENV: DeployEnv = __DEPLOY_ENV__ === 'production' ? 'production' : 'sandbox';
export const IS_LIVE: boolean = __DEPLOY_ENV__ === 'production';

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
