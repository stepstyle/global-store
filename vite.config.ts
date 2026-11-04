import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { firebaseEnvGuard } from './tools/firebase-env-guard.ts';

export default defineConfig({
  base: '/', // ✅ مهم
  plugins: [
    // Fail-closed: `vite` (dev) only runs against the Firebase Emulator + a demo- project; `vite preview` refuses
    // production bundles; production builds are unchanged (see tools/firebase-env-guard.ts, .env.example).
    firebaseEnvGuard({ root: __dirname, loadEnv }),
    react(),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // Local only: the dev/preview servers listen on 127.0.0.1 (not the LAN) and keep Vite's host check.
  server: { port: 3000, host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1' },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1000, // بدل 500 الافتراضية
  },
});
