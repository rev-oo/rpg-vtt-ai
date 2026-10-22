import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

import { RUNTIME_GLOBAL, SHARED_MODULES } from './src/plugin-host/shared-modules.js';

// The API server; the dev and preview servers proxy /api, plugin files and the /ws sockets to
// it so cookies stay same-origin. The Host header is kept, which the socket's origin check
// relies on.
const apiTarget = process.env.VTT_API_URL ?? 'http://localhost:3000';
const proxy = {
  '/api': { target: apiTarget, changeOrigin: false },
  '/plugins': { target: apiTarget, changeOrigin: false },
  '/ws': { target: apiTarget, changeOrigin: false, ws: true },
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A module that re-exports one shared module from the app's global (ADR-025). */
async function shimSource(specifier: string): Promise<string> {
  const exported = (await import(specifier)) as Record<string, unknown>;
  const names = Object.keys(exported).filter((name) => name !== 'default' && IDENTIFIER.test(name));
  return [
    `const m = globalThis[${JSON.stringify(RUNTIME_GLOBAL)}][${JSON.stringify(specifier)}];`,
    'export default m.default ?? m;',
    `export const { ${names.join(', ')} } = m;`,
    '',
  ].join('\n');
}

/** Serves the shims of `SHARED_MODULES` in dev and writes them into the client build. */
function pluginRuntime(): Plugin {
  const byUrl = new Map<string, string>(
    Object.entries(SHARED_MODULES).map(([specifier, url]) => [url, specifier]),
  );
  return {
    name: 'vtt-plugin-runtime',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const specifier = byUrl.get(request.url ?? '');
        if (!specifier) {
          next();
          return;
        }
        shimSource(specifier).then(
          (source) => {
            response.setHeader('content-type', 'text/javascript; charset=utf-8');
            response.end(source);
          },
          (error: unknown) => {
            next(error);
          },
        );
      });
    },
    async generateBundle() {
      if (this.environment.name !== 'client') return;
      for (const [url, specifier] of byUrl) {
        this.emitFile({
          type: 'asset',
          fileName: url.slice(1),
          source: await shimSource(specifier),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), pluginRuntime()],
  server: { proxy },
  preview: { proxy },
});
