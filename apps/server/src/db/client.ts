import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** A transaction handle; helpers that run inside or outside a transaction accept `DbOrTx`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export const DATABASE_FILENAME = 'vtt.sqlite';

/** Locates `apps/server` whether running from `src/` (tests) or `dist/src/` (built). */
function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Could not find the @vtt/server package root');
    }
    dir = parent;
  }
  return dir;
}

export const MIGRATIONS_DIR = path.join(packageRoot(), 'drizzle');

/**
 * Opens the database. Pass `':memory:'` for tests; otherwise the file lives in
 * `dataDir` and its directory is created if needed (specs §4.3).
 */
export function openDatabase(location: { dataDir: string } | ':memory:'): Db {
  let filename = ':memory:';
  if (location !== ':memory:') {
    mkdirSync(location.dataDir, { recursive: true });
    filename = path.join(location.dataDir, DATABASE_FILENAME);
  }
  const sqlite = new Database(filename);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  return drizzle({ client: sqlite, schema });
}

/** Applies pending migrations from `apps/server/drizzle`. Safe to run on every start. */
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
