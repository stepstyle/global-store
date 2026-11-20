import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { resolveDeployEnv, stripTracking, SANDBOX_ENV_PREFIX } from './scripts/deploy-env.mjs';
import { firebaseEnvGuard, STAGING_ENV_DIR } from './tools/firebase-env-guard.ts';

export default defineConfig(({ mode }) => {
  // `vite --mode staging` (npm run dev:staging) reads env files ONLY from env/staging/ — never the repository root
  // (.env.local, production files). Every other mode keeps Vite's default (the root), unchanged.
  const envDir = mode === 'staging' ? STAGING_ENV_DIR : undefined;
  const viteEnv = loadEnv(mode, path.resolve(__dirname, envDir ?? '.'), 'VITE_');
  const firebaseTarget = viteEnv.VITE_FIREBASE_TARGET;
  // prize wheel build mode, folded at build time so a build without the wheel does not even contain its code
  const wheelMode = viteEnv.VITE_WHEEL_MODE === 'live' || viteEnv.VITE_WHEEL_MODE === 'test' ? viteEnv.VITE_WHEEL_MODE : 'off';

  // 🛡️ Fail-closed deployment guard (see scripts/deploy-env.mjs and src/config/deployEnv.ts)
  const { deployEnv, reason } = resolveDeployEnv(process.env, { firebaseTarget });
  const isLive = deployEnv === 'production';
  console.log(`[deploy-guard] ${deployEnv.toUpperCase()} build (${reason})`);

  const sandboxHtml = (): Plugin => ({
    name: 'deploy-guard-sandbox-html',
    transformIndexHtml: (html) => (isLive ? html : stripTracking(html)),
  });

  return {
    base: '/', // ✅ مهم
    ...(envDir ? { envDir } : {}),
    plugins: [
      // Fail-closed: `vite` (dev) only runs against the Firebase Emulator + a demo- project, or (mode staging) the
      // dairsharaf-staging project through the local staging proxy; `vite preview` refuses production bundles;
      // production builds are unchanged (see tools/firebase-env-guard.ts, .env.example, env/staging/).
      firebaseEnvGuard({ root: __dirname, loadEnv }),
      react(),
      sandboxHtml(),
    ],
    define: { __DEPLOY_ENV__: JSON.stringify(deployEnv), __WHEEL_MODE__: JSON.stringify(wheelMode) },
    // sandbox: no VITE_* value is exposed to the client bundle (local-test values are validated by firebaseEnvGuard)
    ...(deployEnv === 'sandbox' ? { envPrefix: SANDBOX_ENV_PREFIX } : {}),
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    // Local only: the dev/preview servers listen on 127.0.0.1 (not the LAN) and keep Vite's host check.
    // staging: the file watcher never even looks at .env files of the repository.
    server: { port: 3000, host: '127.0.0.1', strictPort: true, ...(mode === 'staging' ? { watch: { ignored: ['**/.env', '**/.env.*'] } } : {}) },
    preview: { host: '127.0.0.1' },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 1000, // بدل 500 الافتراضية
    },
  };
});
