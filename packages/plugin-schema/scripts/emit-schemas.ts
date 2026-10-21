// Writes `schemas/<kind>.schema.json` from the Zod source (T-0401). Run by `pnpm build`;
// test/json-schema.test.ts fails when the committed files are stale.
import { mkdir, writeFile } from 'node:fs/promises';

import { PLUGIN_FILES, type PluginFileKind, pluginJsonSchema } from '@vtt/plugin-schema';

const directory = new URL('../../schemas/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const kind of Object.keys(PLUGIN_FILES) as PluginFileKind[]) {
  const json = `${JSON.stringify(pluginJsonSchema(kind), null, 2)}\n`;
  await writeFile(new URL(`${kind}.schema.json`, directory), json);
}
