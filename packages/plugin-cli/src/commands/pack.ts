import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { transform as transformCss } from 'lightningcss';
import { rolldown } from 'rolldown';

import { ARCHIVE_EXTENSION, isIgnoredFile, pluginFolderOf, writeZip } from '@vtt/plugin-io';
import { validatePlugin } from '@vtt/plugin-schema';

import { UsageError, type Output } from '../io.js';

import { checkPlugin, printIssues } from './validate.js';

/** The code entries of §8.10, each compiled to `code/<name>.js`. */
const ENTRY = /^code\/(client|server|shared)\.(?:[cm]?[jt]sx?)$/;
/** Source files under `code/` that are bundled into the entries instead of shipped. */
const SOURCE = /^code\/.+\.(?:[cm]?[jt]sx?|json)$/;
/** What client code gets from the app's import map instead of bundling it (ADR-025). */
const SHARED = /^(?:react|react-dom|@vtt\/sdk)(?:\/.*)?$/;
/**
 * Shared and server code run where there is no `node_modules`, so this CLI's own copy of the
 * SDK is bundled into them (ADR-047).
 */
const SDK = createRequire(import.meta.url).resolve('@vtt/sdk');
const STYLESHEET = /^styles\/[^/]+\.css$/;

/** Compiles one code entry into a single ES module. */
async function compile(dir: string, file: string): Promise<Buffer> {
  const client = file.startsWith('code/client.');
  // Browsers load `code/shared` too, so it targets neither side.
  const platform = client ? 'browser' : file.startsWith('code/shared.') ? 'neutral' : 'node';
  const bundle = await rolldown({
    input: path.join(dir, file),
    cwd: dir,
    platform,
    external: (id) => (client && SHARED.test(id)) || id.startsWith('node:'),
    ...(!client && { resolve: { alias: { '@vtt/sdk': SDK } } }),
    transform: { jsx: 'react-jsx' },
    logLevel: 'silent',
  });
  try {
    const { output } = await bundle.generate({ format: 'esm', minify: true, codeSplitting: false });
    const [chunk] = output;
    return Buffer.from(chunk.code);
  } finally {
    await bundle.close();
  }
}

/**
 * The files of the archive (ADR-026): the plugin's files with `code/` compiled to one ES module
 * per entry and its stylesheets minified. Dot files, `node_modules` and archives (an earlier
 * `pack` run inside the folder writes one there) are left out.
 */
export async function packFiles(
  folder: string,
  files: Iterable<string>,
): Promise<Map<string, Buffer>> {
  const dir = path.resolve(folder);
  const packed = new Map<string, Buffer>();
  const entries = new Map<string, string>();
  for (const file of [...files].sort()) {
    if (isIgnoredFile(file) || file.endsWith(ARCHIVE_EXTENSION)) continue;
    const entry = ENTRY.exec(file);
    if (entry?.[1] !== undefined) {
      const output = `code/${entry[1]}.js`;
      const other = entries.get(output);
      if (other !== undefined)
        throw new UsageError(`${other} and ${file} both compile to ${output}.`);
      entries.set(output, file);
      continue;
    }
    if (SOURCE.test(file)) continue;
    const data = await readFile(path.join(dir, file));
    if (STYLESHEET.test(file)) {
      const { code } = transformCss({ filename: file, code: data, minify: true });
      packed.set(file, Buffer.from(code));
    } else {
      packed.set(file, data);
    }
  }
  for (const [output, source] of entries) packed.set(output, await compile(dir, source));
  return new Map([...packed].sort(([a], [b]) => a.localeCompare(b)));
}

/** `vtt-plugin pack <dir> [--out <file>]`: validates, compiles and writes a `.vttplugin`. */
export async function packCommand(
  dir: string,
  out: string | undefined,
  output: Output,
): Promise<number> {
  const checked = await checkPlugin(dir);
  if (checked.errors > 0 || !checked.manifest) {
    printIssues(checked.issues, output);
    output.err(`${dir}: fix the errors before packing.`);
    return 1;
  }
  const packed = await packFiles(dir, checked.files.keys());
  // What the server will validate after unpacking.
  const folder = pluginFolderOf(packed);
  const after = [...folder.issues, ...validatePlugin(folder.files).issues].filter(
    (issue) => issue.severity === 'error',
  );
  if (after.length > 0) {
    printIssues(after, output);
    output.err(`${dir}: the packed plugin has errors.`);
    return 1;
  }
  const { id, version } = checked.manifest;
  const file = out ?? `${id}-${version}${ARCHIVE_EXTENSION}`;
  const zip = writeZip(packed);
  await writeFile(file, zip);
  output.out(
    `Packed ${id} ${version}: ${String(packed.size)} files, ${String(zip.length)} bytes → ${file}`,
  );
  return 0;
}
