import { openDatabase, runMigrations, type Db } from '../../src/db/client.js';

/** A fresh, fully migrated in-memory database. */
export function createTestDb(): Db {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}
