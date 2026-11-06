import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { firebaseEnvGuard, STAGING_ENV_DIR } from './tools/firebase-env-guard.ts';

export default defineConfig(({ mode }) => ({
  base: '/', // ✅ مهم
  // `vite --mode staging` (npm run dev:staging) reads env files ONLY from env/staging/ — never the repository root
  // (.env.local, production files). Every other mode keeps Vite's default (the root), unchanged.
  ...(mode === 'staging' ? { envDir: STAGING_ENV_DIR } : {}),
  plugins: [
    // Fail-closed: `vite` (dev) only runs against the Firebase Emulator + a demo- project, or (mode staging) the
    // dairsharaf-staging project through the local staging proxy; `vite preview` refuses production bundles;
    // production builds are unchanged (see tools/firebase-env-guard.ts, .env.example, env/staging/).
    firebaseEnvGuard({ root: __dirname, loadEnv }),
    react(),
  ],
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
}));
