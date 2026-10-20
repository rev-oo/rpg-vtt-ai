import { z } from 'zod';

import { rollRequestBody } from '@vtt/shared/api';

import { toChatMessage } from '../../domain/chat.js';
import { sendRollMessage } from '../../domain/rolls.js';
import { publishChatMessage } from '../../realtime/notify.js';
import type { AppContext } from '../app.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });

/** Rolls a typed formula into the chat (FR-CHAT-03, 08). The socket's `roll.request` does the same. */
export function rollRoutes({ app, db, events, now, rng }: AppContext): void {
  app.post('/api/v1/tables/:id/rolls', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { membership } = requireMember(db, request, id);
    const body = parseInput(rollRequestBody, request.body);
    const row = sendRollMessage(
      db,
      { tableId: id, userId: membership.userId, role: membership.role },
      body,
      { now: now(), rng },
    );
    publishChatMessage(events, row);
    return reply.code(201).send({ message: toChatMessage(row) });
  });
}
