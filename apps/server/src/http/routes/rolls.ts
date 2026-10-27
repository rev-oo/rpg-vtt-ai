import { z } from 'zod';

import { rollRequestBody } from '@vtt/shared/api';

import { toChatMessage } from '../../domain/chat.js';
import { sendRollMessages } from '../../domain/rolls.js';
import { publishChatMessage } from '../../realtime/notify.js';
import type { AppContext } from '../app.js';
import { requireMember } from '../membership.js';
import { rollOptions } from '../roll-options.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });

/**
 * Rolls a typed formula or a recipe into the chat (FR-CHAT-03, 08); the socket's `roll.request`
 * does the same. A handler recipe may post several messages (ADR-047): all are published, and
 * the first is the answer.
 */
export function rollRoutes(context: AppContext): void {
  const { app, db, events } = context;
  const options = rollOptions(context);
  app.post('/api/v1/tables/:id/rolls', async (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { membership } = requireMember(db, request, id);
    const body = parseInput(rollRequestBody, request.body);
    const rows = await sendRollMessages(
      db,
      { tableId: id, userId: membership.userId, role: membership.role },
      body,
      options,
    );
    for (const row of rows) publishChatMessage(events, row);
    return reply.code(201).send({ message: toChatMessage(rows[0]) });
  });
}
