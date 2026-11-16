import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { resolveDeployEnv, stripTracking, SANDBOX_ENV_PREFIX } from './scripts/deploy-env.mjs';

// 🛡️ Fail-closed deployment guard (see scripts/deploy-env.mjs and src/config/deployEnv.ts)
const { deployEnv, reason } = resolveDeployEnv(process.env);
const isLive = deployEnv === 'production';
console.log(`[deploy-guard] ${deployEnv.toUpperCase()} build (${reason})`);

const sandboxHtml = (): Plugin => ({
  name: 'deploy-guard-sandbox-html',
  transformIndexHtml: (html) => (isLive ? html : stripTracking(html)),
});

export default defineConfig({
  base: '/', // ✅ مهم
  plugins: [react(), sandboxHtml()],
  define: { __DEPLOY_ENV__: JSON.stringify(deployEnv) },
  // sandbox: no VITE_* value is exposed to the client bundle
  ...(isLive ? {} : { envPrefix: SANDBOX_ENV_PREFIX }),
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
server: { port: 3000, host: true, allowedHosts:true  },
  build: {
  outDir: 'dist',
  sourcemap: false,
  chunkSizeWarningLimit: 1000, // بدل 500 الافتراضية
},
});
