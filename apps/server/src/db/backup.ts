import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { DATABASE_FILENAME } from './client.js';

export interface BackupResult {
  /** The new backup folder: `vtt.sqlite` and, if there were any, `plugins/`. */
  dir: string;
  plugins: boolean;
}

/**
 * Takes a consistent backup of `DATA_DIR` while the server runs (FR-ADMIN-05, NFR-02).
 * `VACUUM INTO` writes a snapshot of the database, WAL included, in one read transaction, so
 * writes made meanwhile are either all in it or not at all. The plugin folders are copied
 * afterwards; they change only when an admin installs or removes a plugin.
 */
export function backupDataDir(
  dataDir: string,
  destination: string,
  now = new Date(),
): BackupResult {
  const source = path.join(dataDir, DATABASE_FILENAME);
  if (!existsSync(source)) throw new Error(`No database at ${source}`);

  const stamp = now
    .toISOString()
    .replaceAll(':', '-')
    .replace(/\.\d+Z$/, 'Z');
  const dir = path.join(destination, `vtt-backup-${stamp}`);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  mkdirSync(dir, { recursive: true });

  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    db.prepare('VACUUM INTO ?').run(path.join(dir, DATABASE_FILENAME));
  } finally {
    db.close();
  }

  const pluginsDir = path.join(dataDir, 'plugins');
  const plugins = existsSync(pluginsDir);
  if (plugins) cpSync(pluginsDir, path.join(dir, 'plugins'), { recursive: true });
  return { dir, plugins };
}
