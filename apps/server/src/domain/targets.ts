import type { FormulaFunction } from '@vtt/formula';
import type { RolledTarget } from '@vtt/plugin-engine';
import type { PluginDefinition } from '@vtt/plugin-schema';
import type { Subject } from '@vtt/shared';
import type { CardApplyInput, CardTarget, RecipeCard } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import {
  findActor,
  findChatMessage,
  updateChatMessageCard,
  type ChatMessageRow,
} from '../db/repositories/index.js';
import { conflict, forbidden, unprocessable } from '../errors.js';

import { actorAccess, dataFilter, requireWritableTable } from './entities.js';
import type { RollOptions } from './rolls.js';
import { findScene } from './scenes.js';
import { findTable } from './tables.js';
import { findToken, visibleTo } from './tokens.js';

// Targets (T-1615, ADR-082): a roll may carry the tokens its roller targets on the map. A
// recipe that targets actors reads the first as `@target`, and its card offers actions, such
// as applying damage, that step a counter of each target for those who may edit it.

/** The actors a roll targets: as the engine reads them, and as the card keeps them. */
export interface RollTargets {
  rolled: RolledTarget[];
  card: CardTarget[];
}

/**
 * The actors behind the tokens a member targets. Each must be a token of the table that the
 * member can see on the map, standing for an actor; anything else is refused as unknown, so
 * hidden tokens cannot be probed. Rolls read a target's data without its secret fields,
 * whoever rolls: a player's attack reads what a GM's would.
 */
export function rollTargets(
  db: DbOrTx,
  { tableId, subject }: { tableId: string; subject: Subject },
  tokenIds: readonly string[],
  plugin: PluginDefinition,
  { liveData, heldItems }: Pick<RollOptions, 'liveData' | 'heldItems'>,
): RollTargets {
  const main = dataFilter(plugin, 'player');
  const targets: RollTargets = { rolled: [], card: [] };
  for (const tokenId of new Set(tokenIds)) {
    const token = findToken(db, tokenId);
    const scene = token && findScene(db, token.sceneId);
    const actor = token?.actorId ? findActor(db, token.actorId) : undefined;
    if (
      !token ||
      scene?.tableId !== tableId ||
      !actor ||
      !visibleTo(subject, { token, actor }, scene)
    ) {
      throw unprocessable('unknown_target', 'Target only tokens of actors you can see on the map.');
    }
    const data = liveData?.(actor) ?? actor.system;
    targets.rolled.push({
      id: actor.id,
      name: actor.name,
      type: actor.type,
      data: main('actor', actor.type, data),
      items: heldItems?.(actor) ?? [],
    });
    targets.card.push({ tokenId, actorId: actor.id, name: actor.name, applied: [] });
  }
  return targets;
}

/** The card's targets with `action` marked done, or undone, on the target at `index`. */
const marked = (card: RecipeCard, index: number, action: number, done: boolean): RecipeCard => ({
  ...card,
  targets: (card.targets ?? []).map((target, at) =>
    at !== index
      ? target
      : {
          ...target,
          applied: done
            ? [...target.applied, action]
            : target.applied.filter((each) => each !== action),
        },
  ),
});

/**
 * Does one of a card's actions to one of its targets (T-1615), such as applying damage: steps
 * the target's counter by the amount worked out when the card was rolled, within its bounds.
 * The member must be able to edit the target, and each action is done once per target: it is
 * marked done before the counter moves, so two clicks cannot both apply it.
 */
export async function applyCardAction(
  db: DbOrTx,
  subject: Subject,
  row: ChatMessageRow,
  { target, action }: Required<CardApplyInput>,
  options: Pick<RollOptions, 'definition' | 'code' | 'adjust' | 'logger'>,
): Promise<ChatMessageRow> {
  const chosen = row.card?.targets?.[target];
  const step = row.card?.card?.apply?.[action];
  if (!row.card || !chosen || !step || step.error !== undefined) {
    throw unprocessable('unknown_action', 'The card has no such action for that target.');
  }
  const table = findTable(db, row.tableId);
  if (table) requireWritableTable(db, table);
  const plugin = table ? options.definition?.(table.systemId) : undefined;
  if (!table || plugin?.manifest.id !== row.card.system) {
    throw unprocessable('system_unavailable', 'The table’s system no longer rolls this card.');
  }
  const actor = findActor(db, chosen.actorId);
  if (actor?.tableId !== row.tableId) {
    throw unprocessable('unknown_target', `${chosen.name} is no longer at the table.`);
  }
  if (actorAccess(subject, actor) !== 'owner') {
    throw forbidden(`You cannot change ${chosen.name}.`);
  }

  // Marked done first, in one transaction with the check, so the action runs once.
  const claimed = db.transaction((tx) => {
    const current = findChatMessage(tx, row.id);
    const card = current?.card;
    if (!card) return undefined;
    if (card.targets?.[target]?.applied.includes(action)) {
      throw conflict('already_applied', `That was already done to ${chosen.name}.`);
    }
    return updateChatMessageCard(tx, row.id, marked(card, target, action, true));
  });
  if (!claimed?.card) throw unprocessable('unknown_action', 'The card is gone.');

  let functions: Readonly<Record<string, FormulaFunction>> = {};
  try {
    functions = (await options.code?.(table.systemId))?.functions ?? {};
  } catch (error) {
    options.logger.warn({ err: error, plugin: table.systemId }, 'plugin code unavailable');
  }
  const value = await options.adjust?.(
    { kind: 'actor', entity: actor },
    'main',
    step.field.split('.'),
    step.amount,
    functions,
  );
  if (value === undefined) {
    db.transaction((tx) => {
      const card = findChatMessage(tx, row.id)?.card;
      if (card) updateChatMessageCard(tx, row.id, marked(card, target, action, false));
    });
    throw unprocessable('not_a_counter', `"${step.field}" is not a counter of ${chosen.name}.`);
  }
  return claimed;
}
