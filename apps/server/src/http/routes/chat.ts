import { z } from 'zod';

import { chatHistoryQuery, chatSendBody } from '@vtt/shared/api';

import { listChatMessages } from '../../db/repositories/index.js';
import { decodeCursor, encodeCursor, sendChatMessage, toChatMessage } from '../../domain/chat.js';
import { publishChatMessage } from '../../realtime/notify.js';
import type { AppContext } from '../app.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });

/** Chat history and posting (FR-CHAT-01, 02, 07). The socket's `chat.send` does the same. */
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
}
