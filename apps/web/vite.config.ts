import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API server; the dev and preview servers proxy /api to it so cookies stay same-origin.
const apiTarget = process.env.VTT_API_URL ?? 'http://localhost:3000';
const proxy = { '/api': { target: apiTarget, changeOrigin: false } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `tsc -b` type-checks into dist/src; the bundle goes to its own folder.
  build: { outDir: 'dist/app', emptyOutDir: true },
  server: { proxy },
  preview: { proxy },
});
