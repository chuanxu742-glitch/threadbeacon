import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'web'),
  publicDir: resolve(__dirname, 'public'),
  plugins: [react()],
  build: { outDir: resolve(__dirname, 'dist-web'), emptyOutDir: true },
  server: { port: 3000, proxy: { '/api': 'http://localhost:8080' } },
});
