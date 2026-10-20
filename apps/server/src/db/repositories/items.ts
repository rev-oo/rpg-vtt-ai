import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { generateId } from '../../domain/auth/tokens.js';
import type { DbOrTx } from '../client.js';
import { items } from '../schema.js';

import {
  containsText,
  expiredCondition,
  isLive,
  restoreState,
  trashCondition,
  type RestoreResult,
  type Retention,
  type Trash,
} from './soft-delete.js';

export type Item = typeof items.$inferSelect;

export type NewItem = Pick<typeof items.$inferInsert, 'tableId' | 'type' | 'name' | 'dataVersion'> &
  Partial<Pick<typeof items.$inferInsert, 'actorId' | 'sourceId' | 'imageUrl' | 'system'>>;

export type ItemPatch = Partial<Pick<Item, 'name' | 'imageUrl' | 'system'>>;

export interface ItemFilter {
  /** `null`: the table's library (FR-ENT-05); an id: the items owned by that actor. */
  actorId: string | null;
  /** Case-insensitive substring of the name. */
  search?: string;
  type?: string;
  /** Default: live items. */
  trash?: Trash;
}

export function createItem(db: DbOrTx, input: NewItem, now: Date): Item {
  return db
    .insert(items)
    .values({ ...input, id: generateId(), createdAt: now, updatedAt: now })
    .returning()
    .get();
}

/** A live item; deleted items are only reachable through the trash. */
export function findItem(db: DbOrTx, id: string): Item | undefined {
  return db
    .select()
    .from(items)
    .where(and(eq(items.id, id), isLive(items.softDeletedAt)))
    .get();
}

/** Library or owned items of a table, ordered by name. */
export function listItems(
  db: DbOrTx,
  tableId: string,
  filter: ItemFilter,
  retention: Retention,
): Item[] {
  return db
    .select()
    .from(items)
    .where(
      and(
        eq(items.tableId, tableId),
        filter.actorId === null ? isNull(items.actorId) : eq(items.actorId, filter.actorId),
        trashCondition(items.softDeletedAt, filter.trash ?? 'live', retention),
        filter.type === undefined ? undefined : eq(items.type, filter.type),
        filter.search ? containsText(items.name, filter.search) : undefined,
      ),
    )
    .orderBy(asc(sql`lower(${items.name})`), asc(items.id))
    .all();
}

/** Updates a live item; `undefined` if it does not exist or is deleted. */
export function updateItem(db: DbOrTx, id: string, patch: ItemPatch, now: Date): Item | undefined {
  return db
    .update(items)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(items.id, id), isLive(items.softDeletedAt)))
    .returning()
    .all()[0];
}

/** Moves a live item to the trash. Returns false if there was none. */
export function softDeleteItem(db: DbOrTx, id: string, now: Date): boolean {
  const deleted = db
    .update(items)
    .set({ softDeletedAt: now, updatedAt: now })
    .where(and(eq(items.id, id), isLive(items.softDeletedAt)))
    .returning({ id: items.id })
    .all();
  return deleted.length > 0;
}

/** Restores an item deleted within the retention window (FR-ENT-04). */
export function restoreItem(db: DbOrTx, id: string, retention: Retention): RestoreResult {
  const item = db.select().from(items).where(eq(items.id, id)).get();
  if (!item) return 'not_found';
  const state = restoreState(item.softDeletedAt, retention);
  if (state !== 'restorable') return state;
  db.update(items)
    .set({ softDeletedAt: null, updatedAt: retention.now })
    .where(eq(items.id, id))
    .run();
  return 'restored';
}

/** Permanently removes items whose retention window has closed; returns how many. */
export function purgeDeletedItems(db: DbOrTx, retention: Retention): number {
  return db.delete(items).where(expiredCondition(items.softDeletedAt, retention)).run().changes;
}
