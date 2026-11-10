import { readdir, readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REFERENCE_PLUGINS = [
  'tiny-d20',
  'tiny-pool',
  'parchment-skin',
  'dice-3d',
  'srd5',
] as const;

const pluginsDir = fileURLToPath(new URL('../../../../plugins/', import.meta.url));

/** Left out as `vtt-plugin pack` and the server leave them out: dot files and `node_modules`. */
const ignored = (path: string): boolean =>
  path.split('/').some((segment) => segment.startsWith('.') || segment === 'node_modules');

/** Every file of a reference plugin as text, keyed by its path inside the plugin folder. */
export async function pluginFiles(id: string): Promise<Map<string, string>> {
  const root = `${pluginsDir}${id}`;
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = `${entry.parentPath}/${entry.name}`;
    if (ignored(relative(root, path))) continue;
    files.set(relative(root, path), await readFile(path, 'utf8'));
  }
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Every JSON file of a reference plugin, parsed. JSON under `code/` is the author's tooling
 * (dice-3d's `package.json` and `tsconfig.json`), bundled away by `pack`, not a plugin file.
 */
export async function pluginJsonFiles(id: string): Promise<Map<string, unknown>> {
  const files = [...(await pluginFiles(id))].filter(
    ([path]) => path.endsWith('.json') && !path.startsWith('code/'),
  );
  return new Map(files.map(([path, text]) => [path, JSON.parse(text) as unknown]));
}

/** A committed file under `schemas/`. */
export async function committedSchema(kind: string): Promise<unknown> {
  const url = new URL(`../../schemas/${kind}.schema.json`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8')) as unknown;
}
