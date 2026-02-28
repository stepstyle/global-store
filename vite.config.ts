import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: '/', // ✅ مهم
  plugins: [react()],
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