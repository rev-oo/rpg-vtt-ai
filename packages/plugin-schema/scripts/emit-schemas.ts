// Writes `schemas/<kind>.schema.json` from the Zod source (T-0401), and the plugin file
// reference `docs/plugin-reference.md` from them (T-0704). Run by `pnpm build`;
// test/json-schema.test.ts and test/reference.test.ts fail when the committed files are stale.
import { mkdir, writeFile } from 'node:fs/promises';

import {
  PLUGIN_FILES,
  type PluginFileKind,
  pluginJsonSchema,
  pluginReference,
} from '@vtt/plugin-schema';

const directory = new URL('../../schemas/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const kind of Object.keys(PLUGIN_FILES) as PluginFileKind[]) {
  const json = `${JSON.stringify(pluginJsonSchema(kind), null, 2)}\n`;
  await writeFile(new URL(`${kind}.schema.json`, directory), json);
}
await writeFile(
  new URL('../../../../docs/plugin-reference.md', import.meta.url),
  pluginReference(),
);
