import type { DbOrTx } from '../client.js';

import { purgeDeletedActors, removeActorOwner } from './actors.js';
import { purgeDeletedItems } from './items.js';
import { purgeDeletedJournalEntries, removeJournalOwner } from './journal.js';
import type { Retention } from './soft-delete.js';

export * from './actors.js';
export * from './items.js';
export * from './journal.js';
export type { RestoreResult, Retention, Trash } from './soft-delete.js';

/** Permanently removes every entity whose retention window has closed (FR-ENT-04). */
export function purgeDeletedEntities(
  db: DbOrTx,
  retention: Retention,
): { actors: number; items: number; journalEntries: number } {
  return {
    // Items first: purging an actor would cascade to its items uncounted.
    items: purgeDeletedItems(db, retention),
    actors: purgeDeletedActors(db, retention),
    journalEntries: purgeDeletedJournalEntries(db, retention),
  };
}

/** A removed member's actors and entries stay on the table, without their level (FR-TABLE-04). */
export function removeEntityOwner(db: DbOrTx, tableId: string, userId: string): void {
  removeActorOwner(db, tableId, userId);
  removeJournalOwner(db, tableId, userId);
}
