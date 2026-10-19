import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DATABASE_FILENAME, openDatabase, runMigrations } from '../src/db/client.js';
import { gameTables, members, users } from '../src/db/schema.js';

import { createTestDb } from './support/db.js';

const tableNames = (db: ReturnType<typeof createTestDb>) =>
  db.$client
    .prepare("select name from sqlite_master where type = 'table' order by name")
    .pluck()
    .all();

describe('database', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('creates the database file, in WAL mode, from scratch', () => {
    const dataDir = path.join(mkdtempSync(path.join(tmpdir(), 'vtt-db-')), 'nested');
    dirs.push(path.dirname(dataDir));

    const db = openDatabase({ dataDir });
    runMigrations(db);

    expect(existsSync(path.join(dataDir, DATABASE_FILENAME))).toBe(true);
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
    db.$client.close();
  });

  it('creates every core table', () => {
    expect(tableNames(createTestDb())).toEqual(
      expect.arrayContaining([
        'game_tables',
        'instance_settings',
        'invites',
        'members',
        'plugins',
        'sessions',
        'users',
      ]),
    );
  });

  it('is safe to run migrations again', () => {
    const db = createTestDb();
    expect(() => {
      runMigrations(db);
    }).not.toThrow();
  });

  it('enforces foreign keys', () => {
    const db = createTestDb();
    expect(() =>
      db.insert(members).values({ tableId: 'missing', userId: 'missing', role: 'player' }).run(),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      db
        .insert(gameTables)
        .values({ id: 't1', name: 'T', systemId: 'no-such-plugin', systemVersion: '1.0.0' })
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('treats usernames as case-insensitive unique', () => {
    const db = createTestDb();
    const user = { displayName: 'A', passwordHash: 'x' };
    db.insert(users)
      .values({ ...user, id: 'u1', username: 'Alice' })
      .run();
    expect(() =>
      db
        .insert(users)
        .values({ ...user, id: 'u2', username: 'alice' })
        .run(),
    ).toThrow(/UNIQUE/);
  });
});
