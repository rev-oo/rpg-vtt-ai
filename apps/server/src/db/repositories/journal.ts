import { and, asc, eq, sql } from 'drizzle-orm';

import { generateId } from '../../domain/auth/tokens.js';
import type { DbOrTx } from '../client.js';
import { journalEntries } from '../schema.js';

import {
  containsText,
  expiredCondition,
  isLive,
  restoreState,
  trashCondition,
  withoutOwner,
  type RestoreResult,
  type Retention,
  type Trash,
} from './soft-delete.js';

/** Journal entry metadata; the body is a collaborative document (M5). */
export type JournalEntry = typeof journalEntries.$inferSelect;

export type NewJournalEntry = Pick<typeof journalEntries.$inferInsert, 'tableId' | 'title'> &
  Partial<Pick<typeof journalEntries.$inferInsert, 'ownership' | 'hidden' | 'createdBy'>>;

/** Fields to change; `undefined` leaves a field as it is. */
export type JournalEntryPatch = {
  [K in 'title' | 'ownership' | 'hidden']?: JournalEntry[K] | undefined;
};

export interface JournalFilter {
  /** Case-insensitive substring of the title. */
  search?: string | undefined;
  /** False leaves hidden entries out, for players (FR-JOURNAL-03). Default: true. */
  includeHidden?: boolean | undefined;
  /** Default: live entries. */
  trash?: Trash | undefined;
}

export function createJournalEntry(db: DbOrTx, input: NewJournalEntry, now: Date): JournalEntry {
  return db
    .insert(journalEntries)
    .values({ ...input, id: generateId(), createdAt: now, updatedAt: now })
    .returning()
    .get();
}

/** A live entity; pass `includeDeleted` to also find it in the trash. */
export function findJournalEntry(
  db: DbOrTx,
  id: string,
  { includeDeleted = false }: { includeDeleted?: boolean } = {},
): JournalEntry | undefined {
  return db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.id, id),
        includeDeleted ? undefined : isLive(journalEntries.softDeletedAt),
      ),
    )
    .get();
}

/** A table's journal entries, ordered by title. */
export function listJournalEntries(
  db: DbOrTx,
  tableId: string,
  filter: JournalFilter,
  retention: Retention,
): JournalEntry[] {
  return db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tableId, tableId),
        trashCondition(journalEntries.softDeletedAt, filter.trash ?? 'live', retention),
        filter.includeHidden === false ? eq(journalEntries.hidden, false) : undefined,
        filter.search ? containsText(journalEntries.title, filter.search) : undefined,
      ),
    )
    .orderBy(asc(sql`lower(${journalEntries.title})`), asc(journalEntries.id))
    .all();
}

/** Updates a live entry; `undefined` if it does not exist or is deleted. */
export function updateJournalEntry(
  db: DbOrTx,
  id: string,
  patch: JournalEntryPatch,
  now: Date,
): JournalEntry | undefined {
  return db
    .update(journalEntries)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(journalEntries.id, id), isLive(journalEntries.softDeletedAt)))
    .returning()
    .all()[0];
}

/** Moves a live entry to the trash. Returns false if there was none. */
export function softDeleteJournalEntry(db: DbOrTx, id: string, now: Date): boolean {
  const deleted = db
    .update(journalEntries)
    .set({ softDeletedAt: now, updatedAt: now })
    .where(and(eq(journalEntries.id, id), isLive(journalEntries.softDeletedAt)))
    .returning({ id: journalEntries.id })
    .all();
  return deleted.length > 0;
}

/** Restores an entry deleted within the retention window. */
export function restoreJournalEntry(db: DbOrTx, id: string, retention: Retention): RestoreResult {
  const entry = db.select().from(journalEntries).where(eq(journalEntries.id, id)).get();
  if (!entry) return 'not_found';
  const state = restoreState(entry.softDeletedAt, retention);
  if (state !== 'restorable') return state;
  db.update(journalEntries)
    .set({ softDeletedAt: null, updatedAt: retention.now })
    .where(eq(journalEntries.id, id))
    .run();
  return 'restored';
}

/** Permanently removes entries whose retention window has closed; returns how many. */
export function purgeDeletedJournalEntries(db: DbOrTx, retention: Retention): number {
  return db
    .delete(journalEntries)
    .where(expiredCondition(journalEntries.softDeletedAt, retention))
    .run().changes;
}

/** Drops a user's per-user level on every entry of a table; they fall back to the default. */
export function removeJournalOwner(db: DbOrTx, tableId: string, userId: string): void {
  db.update(journalEntries)
    .set({ ownership: withoutOwner(journalEntries.ownership, userId) })
    .where(eq(journalEntries.tableId, tableId))
    .run();
}
