import { and, eq, gt, or, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

// Keyset pages for lists ordered by name, then id (§10.1, ADR-057).

/** Where a page starts: after this lowercased name and id. */
export interface NameKey {
  name: string;
  id: string;
}

/** A window on a list: rows after `after`, at most `limit`; the whole list without them. */
export interface ListWindow {
  after?: NameKey | undefined;
  limit?: number | undefined;
}

/** Rows ordered after `key` by `lower(name), id`. */
export function afterName(
  name: SQLiteColumn,
  id: SQLiteColumn,
  key: NameKey | undefined,
): SQL | undefined {
  if (!key) return undefined;
  const lower = sql`lower(${name})`;
  return or(gt(lower, key.name), and(eq(lower, key.name), gt(id, key.id)));
}

/** SQLite reads a negative LIMIT as no limit. */
export const limitOf = (window: ListWindow): number => window.limit ?? -1;
