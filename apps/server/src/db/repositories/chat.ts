import { and, desc, eq, lt, or, sql } from 'drizzle-orm';

import { isGmLike, type Subject } from '@vtt/shared';

import { generateId } from '../../domain/auth/tokens.js';
import type { DbOrTx } from '../client.js';
import { chatMessages } from '../schema.js';

export type ChatMessageRow = typeof chatMessages.$inferSelect;

export type NewChatMessage = Pick<
  typeof chatMessages.$inferInsert,
  'tableId' | 'senderId' | 'speaker' | 'audience' | 'kind' | 'text'
> &
  Partial<Pick<typeof chatMessages.$inferInsert, 'recipients' | 'rolls' | 'card'>>;

export function createChatMessage(db: DbOrTx, input: NewChatMessage, now: Date): ChatMessageRow {
  return db
    .insert(chatMessages)
    .values({ ...input, id: generateId(), createdAt: now })
    .returning()
    .get();
}

/**
 * The messages a member may see (FR-CHAT-02), applied in SQL so pages stay full: public
 * messages, their own, whispers to them, and `gm` messages for GMs and assistants.
 */
function visibleTo(viewer: Subject) {
  return or(
    eq(chatMessages.audience, 'public'),
    eq(chatMessages.senderId, viewer.userId),
    and(
      eq(chatMessages.audience, 'whisper'),
      sql`exists (select 1 from json_each(${chatMessages.recipients}) where value = ${viewer.userId})`,
    ),
    isGmLike(viewer.role) ? eq(chatMessages.audience, 'gm') : undefined,
  );
}

/** One page of history, newest first (FR-CHAT-07). */
export function listChatMessages(
  db: DbOrTx,
  tableId: string,
  viewer: Subject,
  /** `before` is the `seq` of the oldest message of the previous page. */
  { before, limit }: { before?: number | undefined; limit: number },
): ChatMessageRow[] {
  return db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.tableId, tableId),
        visibleTo(viewer),
        before === undefined ? undefined : lt(chatMessages.seq, before),
      ),
    )
    .orderBy(desc(chatMessages.seq))
    .limit(limit)
    .all();
}

/** A message by its id. */
export function findChatMessage(db: DbOrTx, id: string): ChatMessageRow | undefined {
  return db.select().from(chatMessages).where(eq(chatMessages.id, id)).get();
}

/** Replaces a message's text and marks it edited. */
export function updateChatMessageText(
  db: DbOrTx,
  id: string,
  text: string,
  now: Date,
): ChatMessageRow | undefined {
  return db
    .update(chatMessages)
    .set({ text, editedAt: now })
    .where(eq(chatMessages.id, id))
    .returning()
    .get();
}

/** Removes a message for good. */
export function deleteChatMessage(db: DbOrTx, id: string): void {
  db.delete(chatMessages).where(eq(chatMessages.id, id)).run();
}
