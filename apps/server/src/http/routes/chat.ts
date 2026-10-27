import { z } from 'zod';

import { chatEditBody, chatHistoryQuery, chatSendBody } from '@vtt/shared/api';

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
import { notFound } from '../../errors.js';
import {
  publishChatDeleted,
  publishChatMessage,
  publishChatUpdated,
} from '../../realtime/notify.js';
import type { AppContext } from '../app.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });

/**
 * Chat history, posting, editing and deleting (FR-CHAT-01, 02, 07, 09). The socket's
 * `chat.send` posts too.
 */
export function chatRoutes({ app, db, events, now }: AppContext): void {
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
    const { membership } = requireMember(db, request, row.tableId);
    const subject = { userId: membership.userId, role: membership.role };
    requireVisibleMessage(subject, row);
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

  app.delete('/api/v1/messages/:id', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { subject, row } = messageOf(request, id);
    removeChatMessage(db, subject, row, now());
    publishChatDeleted(events, row);
    return reply.code(204).send();
  });
}
