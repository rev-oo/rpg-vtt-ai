import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// The API server; the dev and preview servers proxy /api to it so cookies stay same-origin.
const apiTarget = process.env.VTT_API_URL ?? 'http://localhost:3000';
const proxy = { '/api': { target: apiTarget, changeOrigin: false } };

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  server: { proxy },
  preview: { proxy },
});
