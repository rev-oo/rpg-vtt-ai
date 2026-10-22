import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { createServer, type Plugin, type ViteDevServer } from 'vite';

import { scopeCss } from '@vtt/plugin-schema';

import type { Output } from '../io.js';

import { checkPlugin } from './validate.js';

const VIRTUAL = 'virtual:vtt-plugin';
const RESOLVED = `\0${VIRTUAL}`;
/** Modules plugin code takes from the page instead of its own folder (ADR-025). */
const SHARED = /^(?:react|react-dom|@vtt\/sdk)(?:\/.*)?$/;
const CLIENT_ENTRY = /^code\/client\.(?:[cm]?[jt]sx?)$/;

/** The CLI's package folder, from `src/` in tests or `dist/src/` when built. */
function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
  return dir;
}

/** The page's view of the plugin: validated, with scoped CSS and its client entry. */
export async function previewModule(dir: string): Promise<string> {
  const checked = await checkPlugin(dir);
  const id = checked.manifest?.id ?? path.basename(dir);
  const css = (checked.plugin?.styles ?? [])
    .map((file) => scopeCss(checked.files.get(file) ?? '', { pluginId: id, file }).css)
    .join('\n');
  const client = [...checked.files.keys()].find((file) => CLIENT_ENTRY.test(file));
  const data = {
    id,
    definition: checked.errors > 0 ? null : (checked.plugin ?? null),
    issues: checked.issues,
    css,
    client:
      client === undefined
        ? null
        : `/@fs/${path.join(dir, client).split(path.sep).join('/').replace(/^\//, '')}`,
  };
  return `export default ${JSON.stringify(data)};`;
}

/** Serves the plugin as a virtual module and reloads the page when its files change. */
function pluginSource(dir: string, page: string): Plugin {
  return {
    name: 'vtt-plugin-source',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source === VIRTUAL) return RESOLVED;
      // Plugin code shares the page's React and SDK, as in the app's import map.
      if (importer?.startsWith(dir) && SHARED.test(source)) {
        return this.resolve(source, path.join(page, 'main.tsx'), { ...options, skipSelf: true });
      }
      return null;
    },
    load(id) {
      return id === RESOLVED ? previewModule(dir) : null;
    },
    configureServer(server) {
      server.watcher.add(dir);
      server.watcher.on('all', (_event, file) => {
        if (!file.startsWith(dir) || file.startsWith(path.join(dir, 'code'))) return;
        const module = server.moduleGraph.getModuleById(RESOLVED);
        if (module) server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

/** Starts the preview server of the plugin in `dir`, an absolute path. */
export async function startDevServer(dir: string, port: number): Promise<ViteDevServer> {
  const root = packageRoot();
  const page = path.join(root, 'dev');
  const server = await createServer({
    configFile: false,
    root: page,
    logLevel: 'warn',
    plugins: [tailwindcss(), pluginSource(dir, page)],
    server: { port, strictPort: false, fs: { allow: [page, dir, path.resolve(root, '../..')] } },
    optimizeDeps: { include: ['react', 'react/jsx-runtime', 'react-dom/client'] },
  });
  await server.listen();
  return server;
}

/** `vtt-plugin dev <dir> [--port <n>]`: the sheet preview of one plugin, live (§8.13). */
export async function devCommand(folder: string, port: number, output: Output): Promise<number> {
  const dir = path.resolve(folder);
  if (!existsSync(path.join(dir, 'plugin.json'))) {
    output.err(`${folder} has no plugin.json.`);
    return 2;
  }
  const server = await startDevServer(dir, port);
  const url = server.resolvedUrls?.local[0] ?? `http://localhost:${String(port)}/`;
  output.out(`Previewing ${dir} at ${url} (Ctrl+C to stop)`);
  await new Promise<void>((resolve) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        void server.close().then(resolve);
      });
    }
  });
  return 0;
}
