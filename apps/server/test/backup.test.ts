import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { backupDataDir } from '../src/db/backup.js';
import { openDatabase, runMigrations } from '../src/db/client.js';
import { users } from '../src/db/schema.js';

import { insertUser } from './support/fixtures.js';

const AT = new Date('2026-10-23T18:30:05.123Z');

function dataDir() {
  const root = mkdtempSync(path.join(tmpdir(), 'vtt-backup-'));
  const data = path.join(root, 'data');
  const db = openDatabase({ dataDir: data });
  runMigrations(db);
  return { root, data, db };
}

describe('backupDataDir (T-0605, FR-ADMIN-05)', () => {
  it('copies a consistent database while it is open, plus the plugin folders', () => {
    const { root, data, db } = dataDir();
    // Writes still in the WAL, not checkpointed into vtt.sqlite, must be in the backup.
    const ayla = insertUser(db, { username: 'ayla' });
    mkdirSync(path.join(data, 'plugins', 'tiny-d20'), { recursive: true });
    writeFileSync(path.join(data, 'plugins', 'tiny-d20', 'plugin.json'), '{}');

    const result = backupDataDir(data, path.join(root, 'backups'), AT);
    expect(result).toEqual({
      dir: path.join(root, 'backups', 'vtt-backup-2026-10-23T18-30-05Z'),
      plugins: true,
    });
    // The server keeps writing; the backup does not change.
    db.update(users).set({ displayName: 'Changed' }).where(eq(users.id, ayla.id)).run();

    const copy = openDatabase({ dataDir: result.dir });
    expect(copy.$client.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(copy.select().from(users).all()).toMatchObject([
      { username: 'ayla', displayName: 'Test User' },
    ]);
    expect(readFileSync(path.join(result.dir, 'plugins', 'tiny-d20', 'plugin.json'), 'utf8')).toBe(
      '{}',
    );
    copy.$client.close();
    db.$client.close();
  });

  it('never overwrites a backup and needs a database', () => {
    const { root, data, db } = dataDir();
    const backups = path.join(root, 'backups');
    expect(backupDataDir(data, backups, AT).plugins).toBe(false);
    expect(() => backupDataDir(data, backups, AT)).toThrow(/already exists/);
    expect(() => backupDataDir(path.join(root, 'nothing'), backups, AT)).toThrow(/No database/);
    expect(existsSync(path.join(root, 'nothing'))).toBe(false);
    db.$client.close();
  });
});
