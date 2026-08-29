import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'web'),
  publicDir: resolve(__dirname, 'public'),
  plugins: [react()],
  build: { outDir: resolve(__dirname, 'dist-web'), emptyOutDir: true },
  server: { host: '127.0.0.1', port: 3000, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8080' } },
});
