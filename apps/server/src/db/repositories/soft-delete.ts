import { and, gt, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

// Soft delete for actors, items and journal entries (FR-ENT-04): deleting sets
// `soft_deleted_at`; the entity can be restored until the retention window ends, after which
// `purgeDeleted*` removes it for good.

/** Live entities, or those in the trash and still restorable. */
export type Trash = 'live' | 'restorable';

export type RestoreResult = 'restored' | 'not_found' | 'not_deleted' | 'expired';

/** The retention window, as seen from `now`. */
export interface Retention {
  now: Date;
  retentionMs: number;
}

/** Deleted at or before this instant means the window has closed. */
export function retentionCutoff({ now, retentionMs }: Retention): Date {
  return new Date(now.getTime() - retentionMs);
}

/** Not in the trash. */
export function isLive(column: SQLiteColumn): SQL {
  return isNull(column);
}

/** Filters a list query by trash state. */
export function trashCondition(
  column: SQLiteColumn,
  trash: Trash,
  retention: Retention,
): SQL | undefined {
  return trash === 'live'
    ? isLive(column)
    : and(isNotNull(column), gt(column, retentionCutoff(retention)));
}

/** Rows whose retention window has closed. */
export function expiredCondition(column: SQLiteColumn, retention: Retention): SQL | undefined {
  return and(isNotNull(column), lte(column, retentionCutoff(retention)));
}

/** Case-insensitive substring match without LIKE wildcards to escape. */
export function containsText(column: SQLiteColumn, search: string): SQL {
  return sql`instr(lower(${column}), ${search.toLowerCase()}) > 0`;
}

/** Whether a deleted entity can still be restored. */
export function restoreState(
  softDeletedAt: Date | null,
  retention: Retention,
): Exclude<RestoreResult, 'restored' | 'not_found'> | 'restorable' {
  if (!softDeletedAt) return 'not_deleted';
  return softDeletedAt > retentionCutoff(retention) ? 'restorable' : 'expired';
}

/** SQL for "remove this user's per-user ownership level" (FR-TABLE-04). */
export function withoutOwner(column: SQLiteColumn, userId: string): SQL {
  return sql`json_remove(${column}, ${`$.users."${userId}"`})`;
}
