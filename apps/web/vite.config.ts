import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

import { framePage } from './scripts/frame-page.js';
import { FRAME_URL } from './src/plugin-host/frame-protocol.js';

// The API server; the dev and preview servers proxy /api, plugin files and the /ws sockets to
// it so cookies stay same-origin. The Host header is kept, which the socket's origin check
// relies on.
const apiTarget = process.env.VTT_API_URL ?? 'http://localhost:3000';
const proxy = {
  '/api': { target: apiTarget, changeOrigin: false },
  '/plugins': { target: apiTarget, changeOrigin: false },
  '/ws': { target: apiTarget, changeOrigin: false, ws: true },
};

/** Serves the plugin frame page in dev and writes it into the client build (ADR-074). */
function pluginFrame(): Plugin {
  let page: Promise<string> | null = null;
  const built = () => (page ??= framePage());
  return {
    name: 'vtt-plugin-frame',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== FRAME_URL) {
          next();
          return;
        }
        built().then(
          (html) => {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(html);
          },
          (error: unknown) => {
            next(error);
          },
        );
      });
    },
    async generateBundle() {
      if (this.environment.name !== 'client') return;
      this.emitFile({ type: 'asset', fileName: FRAME_URL.slice(1), source: await built() });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), pluginFrame()],
  server: { proxy },
  // The build prerenders index.html through a preview server it reaches at 127.0.0.1; bound
  // to `localhost`, it can listen on ::1 instead (as in Docker) and the build fails.
  preview: { host: '127.0.0.1', proxy },
});
