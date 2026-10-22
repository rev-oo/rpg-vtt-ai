import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readPluginFolder } from '@vtt/plugin-io';

const REFERENCE = fileURLToPath(new URL('../../../../plugins/', import.meta.url));

/** A sheet node with its `custom:` nodes left out, wherever they sit. */
function withoutCustomNodes(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter(
        (node: unknown) =>
          !(
            typeof node === 'object' &&
            node !== null &&
            'type' in node &&
            typeof node.type === 'string' &&
            node.type.startsWith('custom:')
          ),
      )
      .map(withoutCustomNodes);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, withoutCustomNodes(child)]),
    );
  }
  return value;
}

const toJson = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

/**
 * The files of a reference plugin from `plugins/` without its code: no `code/` folder, no
 * `custom:` sheet nodes and `hasCode: false`. The server only loads compiled code (ADR-026), and
 * these tests are about the plugin's data files; the code is tested through the CLI and e2e
 * (ADR-027).
 */
export async function referencePluginFiles(id: string): Promise<Map<string, Buffer>> {
  const dir = path.join(REFERENCE, id);
  const { files: listed } = await readPluginFolder(dir);
  const files = new Map<string, Buffer>();
  for (const file of listed.keys()) {
    if (file.startsWith('code/')) continue;
    const data = await readFile(path.join(dir, file));
    if (file === 'plugin.json') {
      files.set(file, toJson({ ...(JSON.parse(data.toString()) as object), hasCode: false }));
    } else if (file.startsWith('sheets/')) {
      files.set(file, toJson(withoutCustomNodes(JSON.parse(data.toString()))));
    } else {
      files.set(file, data);
    }
  }
  return files;
}

/** Writes {@link referencePluginFiles} into a plugin folder. */
export async function copyReferencePlugin(id: string, target: string): Promise<void> {
  for (const [file, data] of await referencePluginFiles(id)) {
    await mkdir(path.dirname(path.join(target, file)), { recursive: true });
    await writeFile(path.join(target, file), data);
  }
}
