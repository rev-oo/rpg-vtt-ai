import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import { canSendChat, type MessageAudience, type Subject, type TableRole } from '@vtt/shared';
import type { ChatMessage, chatSendBody, Speaker } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { createChatMessage, findActor, type ChatMessageRow } from '../db/repositories/index.js';
import { members, users } from '../db/schema.js';
import { badRequest, forbidden, unprocessable } from '../errors.js';

import { actorAccess } from './entities.js';

export type ChatSend = z.output<typeof chatSendBody>;

export function toChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    tableId: row.tableId,
    senderId: row.senderId,
    speaker: row.speaker,
    audience: row.audience,
    recipientIds: row.recipients,
    kind: row.kind,
    text: row.text,
    rolls: row.rolls,
    card: row.card ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Who may receive a message, on delivery and in history (FR-CHAT-02). */
export function messageAudience(row: ChatMessageRow): MessageAudience {
  // A deleted sender matches nobody.
  return { audience: row.audience, senderId: row.senderId ?? '', recipientIds: row.recipients };
}

/** History cursors are opaque to clients: the message's `seq`, base64url-encoded. */
export function encodeCursor(row: ChatMessageRow): string {
  return Buffer.from(`m${String(row.seq)}`).toString('base64url');
}

const CURSOR = /^m(\d{1,15})$/;

export function decodeCursor(cursor: string): number {
  const match = CURSOR.exec(Buffer.from(cursor, 'base64url').toString());
  if (!match?.[1]) throw badRequest('invalid_cursor', 'Invalid history cursor.');
  return Number(match[1]);
}

/**
 * Stores a text message from a member (FR-CHAT-01, 02). Spectators may not post; a member
 * may speak as an actor they own (GMs and assistants own every actor); whisper recipients
 * must be members of the table.
 */
export function sendChatMessage(
  db: DbOrTx,
  sender: { tableId: string; userId: string; role: TableRole },
  input: ChatSend,
  now: Date,
): ChatMessageRow {
  if (!canSendChat(sender.role)) throw forbidden('Spectators cannot post in chat.');
  const subject: Subject = { userId: sender.userId, role: sender.role };

  return db.transaction((tx) =>
    createChatMessage(
      tx,
      {
        tableId: sender.tableId,
        senderId: sender.userId,
        speaker: speakerFor(tx, sender.tableId, subject, input.actorId),
        audience: input.audience,
        recipients:
          input.audience === 'whisper'
            ? whisperRecipients(tx, sender.tableId, sender.userId, input.recipientIds)
            : [],
        kind: 'text',
        text: input.text,
      },
      now,
    ),
  );
}

function speakerFor(
  db: DbOrTx,
  tableId: string,
  subject: Subject,
  actorId: string | null,
): Speaker {
  if (actorId) {
    const actor = findActor(db, actorId);
    // Hidden and foreign actors get the same answer, so ids cannot be probed.
    if (actor?.tableId !== tableId || actorAccess(subject, actor) !== 'owner') {
      throw unprocessable('invalid_speaker', 'You can only speak as an actor you own.');
    }
    return { name: actor.name, actorId: actor.id, imageUrl: actor.imageUrl };
  }
  const user = db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, subject.userId))
    .get();
  return { name: user?.displayName ?? '', actorId: null, imageUrl: null };
}

function whisperRecipients(
  db: DbOrTx,
  tableId: string,
  senderId: string,
  recipientIds: readonly string[],
): string[] {
  const memberIds = new Set(
    db
      .select({ userId: members.userId })
      .from(members)
      .where(eq(members.tableId, tableId))
      .all()
      .map((m) => m.userId),
  );
  // The sender always sees their own whisper, so they are not listed.
  const recipients = [...new Set(recipientIds)].filter((id) => id !== senderId);
  if (recipients.length === 0 || recipients.some((id) => !memberIds.has(id))) {
    throw unprocessable('invalid_recipient', 'Whisper recipients must be other table members.');
  }
  return recipients;
}
