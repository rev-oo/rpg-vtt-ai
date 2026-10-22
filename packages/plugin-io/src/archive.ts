import { readZip, ArchiveError, type ZipLimits } from './zip.js';

/** What a `.vttplugin` archive may hold (ADR-026). */
export const ARCHIVE_LIMITS: ZipLimits = {
  maxEntries: 2000,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
};

/** The largest archive the server accepts. */
export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;

/** The file extension `vtt-plugin pack` writes. */
export const ARCHIVE_EXTENSION = '.vttplugin';

/** Folders and files packing leaves out, and an archive may not hold. */
export const isIgnoredFile = (file: string): boolean =>
  file.split('/').some((segment) => segment.startsWith('.') || segment === 'node_modules');

/**
 * The files of a plugin archive, relative to the plugin folder. `plugin.json` is at the root,
 * or inside one top-level folder, which is dropped (a zipped folder). Dot files and
 * `node_modules` are left out.
 */
export function readPluginArchive(zip: Buffer): Map<string, Buffer> {
  const entries = readZip(zip, ARCHIVE_LIMITS);
  let prefix = '';
  if (!entries.has('plugin.json')) {
    const tops = new Set([...entries.keys()].map((name) => name.split('/')[0]));
    const [top] = tops;
    if (tops.size !== 1 || top === undefined || !entries.has(`${top}/plugin.json`)) {
      throw new ArchiveError('no_manifest', 'The archive has no plugin.json.');
    }
    prefix = `${top}/`;
  }
  const files = new Map<string, Buffer>();
  for (const [name, data] of entries) {
    const file = name.slice(prefix.length);
    if (!isIgnoredFile(file)) files.set(file, data);
  }
  return files;
}
