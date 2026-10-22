import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PLUGIN_FILES, pluginJsonSchema, type PluginFileKind } from '@vtt/plugin-schema';

import type { Output } from '../io.js';

/** The JSON Schemas editors use for plugin files, by file name. */
export function jsonSchemaFiles(): Map<string, string> {
  return new Map(
    (Object.keys(PLUGIN_FILES) as PluginFileKind[]).map((kind) => [
      `${kind}.schema.json`,
      `${JSON.stringify(pluginJsonSchema(kind), null, 2)}\n`,
    ]),
  );
}

/** `vtt-plugin schema [--out <dir>]`: writes the schemas, or prints them as one JSON object. */
export async function schemaCommand(out: string | undefined, output: Output): Promise<number> {
  const files = jsonSchemaFiles();
  if (out === undefined) {
    const all = Object.fromEntries(
      [...files].map(([name, text]) => [name, JSON.parse(text) as unknown]),
    );
    output.out(JSON.stringify(all, null, 2));
    return 0;
  }
  await mkdir(out, { recursive: true });
  for (const [name, text] of files) await writeFile(path.join(out, name), text);
  output.out(`Wrote ${String(files.size)} schemas to ${out}`);
  return 0;
}
