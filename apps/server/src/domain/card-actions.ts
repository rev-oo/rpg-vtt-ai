import type { z } from 'zod';

import type { FormulaFunction } from '@vtt/formula';
import { isGmLike, type Subject } from '@vtt/shared';
import { MAX_ADJUST_DELTA, type cardApplyBody } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { findActor, type ChatMessageRow } from '../db/repositories/index.js';
import { forbidden, notFound, unprocessable } from '../errors.js';

import { actorAccess, requireWritableTable } from './entities.js';
import type { RollOptions } from './rolls.js';
import { findTable } from './tables.js';

/**
 * Applies a card's apply action (T-1617): steps the counter it names on `actorId`, the actor of
 * the token the caller has selected, by the amount worked out when the roll was made, within
 * the counter's bounds. The caller must see the message and be able to edit the actor; a GM
 * or assistant also reaches the actor's secret counters. Returns the counter's new value.
 */
export async function applyCardAction(
  db: DbOrTx,
  subject: Subject,
  row: ChatMessageRow,
  input: z.output<typeof cardApplyBody>,
  { code, adjust, logger }: RollOptions,
): Promise<number> {
  const action = row.card?.card?.actions?.[input.action];
  if (action?.kind !== 'apply')
    throw unprocessable('unknown_action', 'The card has no such action to apply.');
  if (action.error !== undefined)
    throw unprocessable('action_failed', `The action could not be worked out: ${action.error}`);
  const table = findTable(db, row.tableId);
  if (!table) throw notFound('Table not found.');
  requireWritableTable(db, table);
  const actor = findActor(db, input.actorId);
  if (actor?.tableId !== table.id) throw notFound('Actor not found.');
  if (actorAccess(subject, actor) !== 'owner')
    throw forbidden('Only those who may edit the actor can apply this to it.');
  if (!adjust) throw unprocessable('action_failed', 'Counters cannot be changed here.');

  // Formula bounds may call the system's shared functions (T-1610).
  let functions: Readonly<Record<string, FormulaFunction>> = {};
  try {
    functions = (await code?.(table.systemId))?.functions ?? {};
  } catch (error) {
    logger.warn({ err: error, plugin: table.systemId }, 'plugin code unavailable');
  }
  const delta = Math.max(-MAX_ADJUST_DELTA, Math.min(MAX_ADJUST_DELTA, action.amount));
  const layers = isGmLike(subject.role) ? (['main', 'secret'] as const) : (['main'] as const);
  for (const layer of layers) {
    const value = await adjust(
      { kind: 'actor', entity: actor },
      layer,
      action.field.split('.'),
      delta,
      functions,
    );
    if (value !== undefined) return value;
  }
  throw unprocessable('not_a_counter', `"${action.field}" is not a counter of that actor.`);
}
