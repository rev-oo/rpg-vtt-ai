import { and, asc, eq, sql } from 'drizzle-orm';

import { generateId } from '../../domain/auth/tokens.js';
import type { DbOrTx } from '../client.js';
import { actors } from '../schema.js';

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

export type Actor = typeof actors.$inferSelect;

export type NewActor = Pick<
  typeof actors.$inferInsert,
  'tableId' | 'type' | 'name' | 'dataVersion'
> &
  Partial<Pick<typeof actors.$inferInsert, 'imageUrl' | 'ownership' | 'system' | 'createdBy'>>;

/** Fields to change; `undefined` leaves a field as it is. */
export type ActorPatch = {
  [K in 'name' | 'imageUrl' | 'ownership' | 'system']?: Actor[K] | undefined;
};

export interface ActorFilter {
  /** Case-insensitive substring of the name. */
  search?: string | undefined;
  type?: string | undefined;
  /** Default: live actors. */
  trash?: Trash | undefined;
}

export function createActor(db: DbOrTx, input: NewActor, now: Date): Actor {
  return db
    .insert(actors)
    .values({ ...input, id: generateId(), createdAt: now, updatedAt: now })
    .returning()
    .get();
}

/** A live entity; pass `includeDeleted` to also find it in the trash. */
export function findActor(
  db: DbOrTx,
  id: string,
  { includeDeleted = false }: { includeDeleted?: boolean } = {},
): Actor | undefined {
  return db
    .select()
    .from(actors)
    .where(and(eq(actors.id, id), includeDeleted ? undefined : isLive(actors.softDeletedAt)))
    .get();
}

/** A table's actors, ordered by name (FR-ENT-04). */
export function listActors(
  db: DbOrTx,
  tableId: string,
  filter: ActorFilter,
  retention: Retention,
): Actor[] {
  return db
    .select()
    .from(actors)
    .where(
      and(
        eq(actors.tableId, tableId),
        trashCondition(actors.softDeletedAt, filter.trash ?? 'live', retention),
        filter.type === undefined ? undefined : eq(actors.type, filter.type),
        filter.search ? containsText(actors.name, filter.search) : undefined,
      ),
    )
    .orderBy(asc(sql`lower(${actors.name})`), asc(actors.id))
    .all();
}

/** Updates a live actor; `undefined` if it does not exist or is deleted. */
export function updateActor(
  db: DbOrTx,
  id: string,
  patch: ActorPatch,
  now: Date,
): Actor | undefined {
  return db
    .update(actors)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(actors.id, id), isLive(actors.softDeletedAt)))
    .returning()
    .all()[0];
}

/** Moves a live actor to the trash. Returns false if there was none. */
export function softDeleteActor(db: DbOrTx, id: string, now: Date): boolean {
  const deleted = db
    .update(actors)
    .set({ softDeletedAt: now, updatedAt: now })
    .where(and(eq(actors.id, id), isLive(actors.softDeletedAt)))
    .returning({ id: actors.id })
    .all();
  return deleted.length > 0;
}

/** Restores an actor deleted within the retention window (FR-ENT-04). */
export function restoreActor(db: DbOrTx, id: string, retention: Retention): RestoreResult {
  const actor = db.select().from(actors).where(eq(actors.id, id)).get();
  if (!actor) return 'not_found';
  const state = restoreState(actor.softDeletedAt, retention);
  if (state !== 'restorable') return state;
  db.update(actors)
    .set({ softDeletedAt: null, updatedAt: retention.now })
    .where(eq(actors.id, id))
    .run();
  return 'restored';
}

/** Permanently removes actors whose retention window has closed; returns how many. */
export function purgeDeletedActors(db: DbOrTx, retention: Retention): number {
  return db.delete(actors).where(expiredCondition(actors.softDeletedAt, retention)).run().changes;
}

/** Drops a user's per-user level on every actor of a table; they fall back to the default. */
export function removeActorOwner(db: DbOrTx, tableId: string, userId: string): void {
  db.update(actors)
    .set({ ownership: withoutOwner(actors.ownership, userId) })
    .where(eq(actors.tableId, tableId))
    .run();
}
