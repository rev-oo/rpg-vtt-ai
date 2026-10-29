import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { DATABASE_FILENAME } from './client.js';

/** Backup folders are named `vtt-backup-<UTC time>`, which sorts oldest first. */
const BACKUP_PREFIX = 'vtt-backup-';
const BACKUP_NAME = /^vtt-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z$/;

/** `2026-10-23T18-30-05Z`: the time to the second, without characters some filesystems refuse. */
const stampOf = (date: Date) =>
  date
    .toISOString()
    .replaceAll(':', '-')
    .replace(/\.\d+Z$/, 'Z');

export interface BackupResult {
  /** The new backup folder: `vtt.sqlite` and, if there were any, `plugins/` and `assets/`. */
  dir: string;
  plugins: boolean;
  /** Uploaded images (ADR-064). */
  assets: boolean;
}

/**
 * Takes a consistent backup of `DATA_DIR` while the server runs (FR-ADMIN-05, NFR-02).
 * `VACUUM INTO` writes a snapshot of the database, WAL included, in one read transaction, so
 * writes made meanwhile are either all in it or not at all. The plugin folders are copied
 * afterwards; they change only when an admin installs or removes a plugin. So are uploaded
 * assets (ADR-064): an upload made meanwhile may have its file without its row, or the
 * other way round, and an asset whose file is missing is not served.
 */
export function backupDataDir(
  dataDir: string,
  destination: string,
  now = new Date(),
): BackupResult {
  const source = path.join(dataDir, DATABASE_FILENAME);
  if (!existsSync(source)) throw new Error(`No database at ${source}`);

  const dir = path.join(destination, `${BACKUP_PREFIX}${stampOf(now)}`);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  mkdirSync(dir, { recursive: true });

  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    db.prepare('VACUUM INTO ?').run(path.join(dir, DATABASE_FILENAME));
  } finally {
    db.close();
  }

  const copied = (folder: string) => {
    const source = path.join(dataDir, folder);
    if (!existsSync(source)) return false;
    cpSync(source, path.join(dir, folder), { recursive: true });
    return true;
  };
  const plugins = copied('plugins');
  return { dir, plugins, assets: copied('assets') };
}

/** The backup folders in `destination` this command named, oldest first, with their times. */
export function listBackups(destination: string): { name: string; takenAt: Date }[] {
  if (!existsSync(destination)) return [];
  return readdirSync(destination, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const match = BACKUP_NAME.exec(entry.name);
      if (!match) return [];
      const [, day, hours, minutes, seconds] = match;
      const takenAt = new Date(
        `${String(day)}T${String(hours)}:${String(minutes)}:${String(seconds)}Z`,
      );
      return [{ name: entry.name, takenAt }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Removes all but the newest `keep` backups; other folders in `destination` are left alone. */
export function pruneBackups(destination: string, keep: number): string[] {
  const backups = listBackups(destination);
  const removed = backups.slice(0, Math.max(0, backups.length - keep)).map((b) => b.name);
  for (const name of removed)
    rmSync(path.join(destination, name), { recursive: true, force: true });
  return removed;
}
