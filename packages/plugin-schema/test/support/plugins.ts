import { readdir, readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REFERENCE_PLUGINS = ['tiny-d20', 'tiny-pool'] as const;

const pluginsDir = fileURLToPath(new URL('../../../../plugins/', import.meta.url));

/** Every file of a reference plugin as text, keyed by its path inside the plugin folder. */
export async function pluginFiles(id: string): Promise<Map<string, string>> {
  const root = `${pluginsDir}${id}`;
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = `${entry.parentPath}/${entry.name}`;
    files.set(relative(root, path), await readFile(path, 'utf8'));
  }
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
}

/** Every JSON file of a reference plugin, parsed. */
export async function pluginJsonFiles(id: string): Promise<Map<string, unknown>> {
  const files = [...(await pluginFiles(id))].filter(([path]) => path.endsWith('.json'));
  return new Map(files.map(([path, text]) => [path, JSON.parse(text) as unknown]));
}

/** A committed file under `schemas/`. */
export async function committedSchema(kind: string): Promise<unknown> {
  const url = new URL(`../../schemas/${kind}.schema.json`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8')) as unknown;
}
