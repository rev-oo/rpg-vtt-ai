import { eq } from 'drizzle-orm';

import { canSeeAudience, canViewActor, type Ownership, type TableRole } from '@vtt/shared';
import type { EntityChanged } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import type { Actor, ChatMessageRow, Item } from '../db/repositories/index.js';
import { members } from '../db/schema.js';
import { messageAudience, toChatMessage } from '../domain/chat.js';

import type { EventHub } from './hub.js';

export type EntityChange = EntityChanged['change'];

/** The current members of a table and their roles. */
export function membersOf(db: DbOrTx, tableId: string): Map<string, TableRole> {
  const rows = db
    .select({ userId: members.userId, role: members.role })
    .from(members)
    .where(eq(members.tableId, tableId))
    .all();
  return new Map(rows.map((m) => [m.userId, m.role]));
}

/** Delivers a chat message to the subscribers its audience allows (FR-CHAT-02, NFR-08). */
export function publishChatMessage(hub: EventHub, row: ChatMessageRow): void {
  const audience = messageAudience(row);
  hub.publish(
    row.tableId,
    { type: 'chat.message', tableId: row.tableId, payload: { message: toChatMessage(row) } },
    (subject) => canSeeAudience(subject, audience),
  );
}

/**
 * Tells the members who can see an actor that it changed (FR-ENT-07). Pass the ownership it
 * had before an update, so members who just lost access also refresh.
 */
export function publishActorChanged(
  hub: EventHub,
  change: EntityChange,
  actor: Actor,
  previousOwnership?: Ownership,
): void {
  hub.publish(
    actor.tableId,
    {
      type: 'entity.changed',
      tableId: actor.tableId,
      payload: { kind: 'actor', id: actor.id, change, actorId: null },
    },
    (subject) =>
      canViewActor(subject, actor.ownership) ||
      (previousOwnership !== undefined && canViewActor(subject, previousOwnership)),
  );
}

/** Library items reach every member; owned items reach those who can see their actor. */
export function publishItemChanged(
  hub: EventHub,
  change: EntityChange,
  item: Item,
  actor: Actor | undefined,
): void {
  hub.publish(
    item.tableId,
    {
      type: 'entity.changed',
      tableId: item.tableId,
      payload: { kind: 'item', id: item.id, change, actorId: item.actorId },
    },
    (subject) => (actor ? canViewActor(subject, actor.ownership) : true),
  );
}
