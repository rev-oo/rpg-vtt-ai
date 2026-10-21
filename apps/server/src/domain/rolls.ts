import { randomInt } from 'node:crypto';

import type { z } from 'zod';

import { FormulaError, roll, type Rng } from '@vtt/formula';
import { canSendChat, type Subject, type TableRole } from '@vtt/shared';
import type { rollRequestBody } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { createChatMessage, type ChatMessageRow } from '../db/repositories/index.js';
import { forbidden, unprocessable } from '../errors.js';

import { recipientsFor, speakerFor } from './chat.js';
import { requireWritableSystem } from './entities.js';
import { findTable } from './tables.js';

export type RollRequest = z.output<typeof rollRequestBody>;

/** Rolls with a cryptographically secure RNG (FR-CHAT-04). */
export const secureRng: Rng = { nextInt: (n) => randomInt(n) };

/**
 * Rolls a formula typed by a member and stores the roll message (FR-CHAT-03, 08). Speaking
 * as an actor rolls against that actor's data (FR-DICE-02); the audience works as for text
 * messages, so a `gm` roll reaches only the sender, the GM and assistants (FR-CHAT-05).
 */
export function sendRollMessage(
  db: DbOrTx,
  sender: { tableId: string; userId: string; role: TableRole },
  input: RollRequest,
  { now, rng }: { now: Date; rng: Rng },
): ChatMessageRow {
  if (!canSendChat(sender.role)) throw forbidden('Spectators cannot roll.');
  const subject: Subject = { userId: sender.userId, role: sender.role };

  return db.transaction((tx) => {
    const table = findTable(tx, sender.tableId);
    if (table) requireWritableSystem(tx, table);
    const { speaker, actor } = speakerFor(tx, sender.tableId, subject, input.actorId);
    const recipients = recipientsFor(tx, sender, input);
    let result;
    try {
      // Derived values and custom dice come from the system plugin (M4).
      result = roll(input.formula, { rng, data: actor?.system ?? {} });
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      throw unprocessable('invalid_formula', error.message, {
        reason: error.code,
        line: error.line,
        column: error.column,
      });
    }
    return createChatMessage(
      tx,
      {
        tableId: sender.tableId,
        senderId: sender.userId,
        speaker,
        audience: input.audience,
        recipients,
        kind: 'roll',
        text: input.formula,
        rolls: [result],
      },
      now,
    );
  });
}
