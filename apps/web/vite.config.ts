import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// The API server; the dev and preview servers proxy /api, plugin files and the /ws sockets to
// it so cookies stay same-origin. The Host header is kept, which the socket's origin check
// relies on.
const apiTarget = process.env.VTT_API_URL ?? 'http://localhost:3000';
const proxy = {
  '/api': { target: apiTarget, changeOrigin: false },
  '/plugins': { target: apiTarget, changeOrigin: false },
  '/ws': { target: apiTarget, changeOrigin: false, ws: true },
};

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  server: { proxy },
  preview: { proxy },
});
