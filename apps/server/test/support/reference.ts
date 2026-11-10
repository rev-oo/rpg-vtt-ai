import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { readPluginArchive, readPluginFolder } from '@vtt/plugin-io';

const REFERENCE = fileURLToPath(new URL('../../../../plugins/', import.meta.url));
// The built plugin CLI, a dev dependency so that it is built before these tests. The server may
// not import it (specs §4.4): the tests run it, as an author would.
const CLI = fileURLToPath(
  new URL('../../node_modules/@vtt/plugin-cli/dist/src/bin.js', import.meta.url),
);

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
 * most tests are about the plugin's data files. {@link packedReferencePlugin} has the code.
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

const packed = new Map<string, Promise<Map<string, Buffer>>>();

async function pack(id: string): Promise<Map<string, Buffer>> {
  const temp = await mkdtemp(path.join(tmpdir(), 'vtt-pack-'));
  try {
    const out = path.join(temp, `${id}.vttplugin`);
    await promisify(execFile)(process.execPath, [
      CLI,
      'pack',
      path.join(REFERENCE, id),
      '--out',
      out,
    ]);
    return readPluginArchive(await readFile(out));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

/**
 * A reference plugin with its code, packed by `vtt-plugin pack` as an author would ship it
 * (T-1613): its `code/` holds the compiled `client.js`, `shared.js` and `server.js`. Packed
 * once per test file.
 */
export function packedReferencePlugin(id: string): Promise<Map<string, Buffer>> {
  let files = packed.get(id);
  if (!files) {
    files = pack(id);
    packed.set(id, files);
  }
  return files;
}

/**
 * Writes a reference plugin into a plugin folder: {@link referencePluginFiles}, or with `code`,
 * {@link packedReferencePlugin}.
 */
export async function copyReferencePlugin(
  id: string,
  target: string,
  { code = false }: { code?: boolean } = {},
): Promise<void> {
  const files = code ? await packedReferencePlugin(id) : await referencePluginFiles(id);
  for (const [file, data] of files) {
    await mkdir(path.dirname(path.join(target, file)), { recursive: true });
    await writeFile(path.join(target, file), data);
  }
}
