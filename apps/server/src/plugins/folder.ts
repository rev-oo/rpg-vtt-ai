import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { PluginIssue } from '@vtt/plugin-schema';

/** JSON and CSS files above this size are not read (and reported), so a scan stays cheap. */
export const MAX_TEXT_BYTES = 1024 * 1024;

/** The files the validator reads; the rest only need to be listed. */
const isText = (file: string) => file.endsWith('.json') || /^styles\/[^/]+\.css$/.test(file);

export interface PluginFolder {
  /** Every regular file, `/`-separated and relative; JSON and style files carry their text. */
  files: Map<string, string>;
  /** Problems found while reading, in the validator's format. */
  issues: PluginIssue[];
}

/**
 * Reads a plugin folder for the validator. Symbolic links are skipped rather than followed,
 * so a plugin cannot pull in files from outside its folder.
 */
export async function readPluginFolder(dir: string): Promise<PluginFolder> {
  const files = new Map<string, string>();
  const issues: PluginIssue[] = [];
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const file = path.relative(dir, full).split(path.sep).join('/');
    if (!isText(file)) {
      files.set(file, '');
      continue;
    }
    const { size } = await stat(full);
    if (size > MAX_TEXT_BYTES) {
      issues.push({
        severity: 'error',
        code: 'file_too_large',
        file,
        path: [],
        params: { limit: MAX_TEXT_BYTES },
      });
      continue;
    }
    files.set(file, await readFile(full, 'utf8'));
  }
  return { files, issues };
}
