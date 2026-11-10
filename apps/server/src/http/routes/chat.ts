import { z } from 'zod';

import { cardApplyBody, chatEditBody, chatHistoryQuery, chatSendBody } from '@vtt/shared/api';

import { findChatMessage, listChatMessages } from '../../db/repositories/index.js';
import {
  decodeCursor,
  editChatMessage,
  encodeCursor,
  removeChatMessage,
  requireVisibleMessage,
  sendChatMessage,
  toChatMessage,
} from '../../domain/chat.js';
import { requireUnarchived } from '../../domain/entities.js';
import { applyCardAction } from '../../domain/targets.js';
import { notFound } from '../../errors.js';
import {
  publishChatDeleted,
  publishChatMessage,
  publishChatUpdated,
} from '../../realtime/notify.js';
import type { AppContext } from '../app.js';
import { requireMember } from '../membership.js';
import { rollOptions } from '../roll-options.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });

/**
 * Chat history, posting, editing and deleting (FR-CHAT-01, 02, 07, 09), and card actions
 * (T-1615). The socket's `chat.send` posts too.
 */
export function chatRoutes(context: AppContext): void {
  const { app, db, events, now } = context;
  const options = rollOptions(context);
  app.get('/api/v1/tables/:id/messages', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { membership } = requireMember(db, request, id);
    const query = parseInput(chatHistoryQuery, request.query);
    const viewer = { userId: membership.userId, role: membership.role };

    // One extra row tells whether an older page exists.
    const rows = listChatMessages(db, id, viewer, {
      before: query.before === undefined ? undefined : decodeCursor(query.before),
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const oldest = page.at(-1);
    return {
      messages: page.map(toChatMessage),
      nextCursor: rows.length > query.limit && oldest ? encodeCursor(oldest) : null,
    };
  });

  app.post('/api/v1/tables/:id/messages', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { membership } = requireMember(db, request, id);
    const body = parseInput(chatSendBody, request.body);
    const row = sendChatMessage(
      db,
      { tableId: id, userId: membership.userId, role: membership.role },
      body,
      now(),
    );
    publishChatMessage(events, row);
    return reply.code(201).send({ message: toChatMessage(row) });
  });

  /** A message the caller may see, and who they are at its table. */
  const messageOf = (request: Parameters<typeof requireMember>[1], id: string) => {
    const row = findChatMessage(db, id);
    if (!row) throw notFound('Message not found.');
    const { membership, table } = requireMember(db, request, row.tableId);
    const subject = { userId: membership.userId, role: membership.role };
    requireVisibleMessage(subject, row);
    requireUnarchived(table);
    return { subject, row };
  };

  app.patch('/api/v1/messages/:id', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { subject, row } = messageOf(request, id);
    const { text } = parseInput(chatEditBody, request.body);
    const edited = editChatMessage(db, subject, row, text, now());
    publishChatUpdated(events, edited);
    return { message: toChatMessage(edited) };
  });

  /**
   * Does one of a card's actions to one of the roll's targets (T-1615), such as applying its
   * damage; the card then shows it done to everyone who sees it.
   */
  app.post('/api/v1/messages/:id/apply', async (request) => {
    const { id } = parseInput(idParams, request.params);
    const { subject, row } = messageOf(request, id);
    const body = parseInput(cardApplyBody, request.body);
    const applied = await applyCardAction(db, subject, row, body, options);
    publishChatUpdated(events, applied);
    return { message: toChatMessage(applied) };
  });

  app.delete('/api/v1/messages/:id', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { subject, row } = messageOf(request, id);
    removeChatMessage(db, subject, row, now());
    publishChatDeleted(events, row);
    return reply.code(204).send();
  });
}
