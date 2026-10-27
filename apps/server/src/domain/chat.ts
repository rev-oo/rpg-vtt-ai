import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import {
  canDeleteMessage,
  canEditMessage,
  canSeeAudience,
  canSendChat,
  type MessageAudience,
  type MessageAuthorship,
  type Subject,
  type TableRole,
} from '@vtt/shared';
import type { ChatMessage, chatSendBody, Speaker } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import {
  createChatMessage,
  deleteChatMessage,
  findActor,
  updateChatMessageText,
  type Actor,
  type ChatMessageRow,
} from '../db/repositories/index.js';
import { members, users } from '../db/schema.js';
import { badRequest, forbidden, notFound, unprocessable } from '../errors.js';

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
    editedAt: row.editedAt?.toISOString() ?? null,
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
        speaker: speakerFor(tx, sender.tableId, subject, input.actorId).speaker,
        audience: input.audience,
        recipients: recipientsFor(tx, sender, input),
        kind: 'text',
        text: input.text,
      },
      now,
    ),
  );
}

/** The speaker of a message, and the actor behind it if the member speaks as one. */
export function speakerFor(
  db: DbOrTx,
  tableId: string,
  subject: Subject,
  actorId: string | null,
): { speaker: Speaker; actor: Actor | null } {
  if (actorId) {
    const actor = findActor(db, actorId);
    // Hidden and foreign actors get the same answer, so ids cannot be probed.
    if (actor?.tableId !== tableId || actorAccess(subject, actor) !== 'owner') {
      throw unprocessable('invalid_speaker', 'You can only speak as an actor you own.');
    }
    return { speaker: { name: actor.name, actorId: actor.id, imageUrl: actor.imageUrl }, actor };
  }
  const user = db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, subject.userId))
    .get();
  return { speaker: { name: user?.displayName ?? '', actorId: null, imageUrl: null }, actor: null };
}

/** Whisper recipients, checked to be other members; empty for other audiences. */
export function recipientsFor(
  db: DbOrTx,
  sender: { tableId: string; userId: string },
  input: { audience: MessageAudience['audience']; recipientIds: readonly string[] },
): string[] {
  return input.audience === 'whisper'
    ? whisperRecipients(db, sender.tableId, sender.userId, input.recipientIds)
    : [];
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

/** Who may change a message, as the shared rules read it (FR-CHAT-09). */
export const authorshipOf = (row: ChatMessageRow): MessageAuthorship => ({
  senderId: row.senderId,
  kind: row.kind,
  sentAt: row.createdAt.getTime(),
});

/**
 * Throws 404 unless the member may see the message, for editing or deleting it (ADR-052):
 * others' whispers and, for players, GM-only messages answer as if they did not exist.
 */
export function requireVisibleMessage(subject: Subject, row: ChatMessageRow): void {
  if (!canSeeAudience(subject, messageAudience(row))) throw notFound('Message not found.');
}

/** The author's new text, within 5 minutes of sending a text message (FR-CHAT-09). */
export function editChatMessage(
  db: DbOrTx,
  subject: Subject,
  row: ChatMessageRow,
  text: string,
  now: Date,
): ChatMessageRow {
  if (!canEditMessage(subject, authorshipOf(row), now.getTime())) {
    throw forbidden('Only the author can edit a text message, within 5 minutes.');
  }
  return updateChatMessageText(db, row.id, text, now) ?? row;
}

/** Deletes a message: the author's within 5 minutes, or any by a GM or assistant. */
export function removeChatMessage(
  db: DbOrTx,
  subject: Subject,
  row: ChatMessageRow,
  now: Date,
): void {
  if (!canDeleteMessage(subject, authorshipOf(row), now.getTime())) {
    throw forbidden('Only the author, within 5 minutes, or a GM can delete this message.');
  }
  deleteChatMessage(db, row.id);
}
