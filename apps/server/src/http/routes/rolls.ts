import { z } from 'zod';

import { cardApplyBody, commandRequestBody, rollRequestBody } from '@vtt/shared/api';

import { findChatMessage } from '../../db/repositories/index.js';
import { applyCardAction } from '../../domain/card-actions.js';
import { requireVisibleMessage, toChatMessage } from '../../domain/chat.js';
import { sendCommandMessages, sendRollMessages } from '../../domain/rolls.js';
import { notFound } from '../../errors.js';
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

  /** A slash command of the table's system (FR-PLUGIN-10, ADR-048); answered like a roll. */
  app.post('/api/v1/tables/:id/commands', async (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { membership } = requireMember(db, request, id);
    const body = parseInput(commandRequestBody, request.body);
    const rows = await sendCommandMessages(
      db,
      { tableId: id, userId: membership.userId, role: membership.role },
      body,
      options,
    );
    for (const row of rows) publishChatMessage(events, row);
    return reply.code(201).send({ message: toChatMessage(rows[0]) });
  });

  /**
   * A card's apply action, such as taking a hit's damage (T-1617), on the actor of the token
   * the caller has selected. The change reaches everyone through the actor's document.
   */
  app.post('/api/v1/messages/:id/apply', async (request) => {
    const { id } = parseInput(idParams, request.params);
    const row = findChatMessage(db, id);
    if (!row) throw notFound('Message not found.');
    const { membership } = requireMember(db, request, row.tableId);
    const subject = { userId: membership.userId, role: membership.role };
    requireVisibleMessage(subject, row);
    const body = parseInput(cardApplyBody, request.body);
    const value = await applyCardAction(db, subject, row, body, options);
    return { value };
  });
}
