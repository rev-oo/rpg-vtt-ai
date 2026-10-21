import { readdir, readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REFERENCE_PLUGINS = ['tiny-d20', 'tiny-pool'] as const;

const pluginsDir = fileURLToPath(new URL('../../../../plugins/', import.meta.url));

/** Every JSON file of a reference plugin, keyed by its path inside the plugin folder. */
export async function pluginJsonFiles(id: string): Promise<Map<string, unknown>> {
  const root = `${pluginsDir}${id}`;
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = new Map<string, unknown>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const path = `${entry.parentPath}/${entry.name}`;
    files.set(relative(root, path), JSON.parse(await readFile(path, 'utf8')) as unknown);
  }
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
}

/** A committed file under `schemas/`. */
export async function committedSchema(kind: string): Promise<unknown> {
  const url = new URL(`../../schemas/${kind}.schema.json`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8')) as unknown;
}
