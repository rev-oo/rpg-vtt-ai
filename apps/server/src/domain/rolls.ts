import { randomInt } from 'node:crypto';

import type { z } from 'zod';

import { FormulaError, roll, type Rng, type RollResult } from '@vtt/formula';
import { chatCardView, createRules, EngineError, type Rules } from '@vtt/plugin-engine';
import type { PluginDefinition } from '@vtt/plugin-schema';
import { canSendChat, type Subject, type TableRole } from '@vtt/shared';
import type { RecipeCard, rollRequestBody } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { createChatMessage, type Actor, type ChatMessageRow } from '../db/repositories/index.js';
import { forbidden, unprocessable } from '../errors.js';

import { recipientsFor, speakerFor } from './chat.js';
import { requireWritableSystem } from './entities.js';
import { findTable } from './tables.js';

export type RollRequest = z.output<typeof rollRequestBody>;

/** Rolls with a cryptographically secure RNG (FR-CHAT-04). */
export const secureRng: Rng = { nextInt: (n) => randomInt(n) };

export interface RollOptions {
  now: Date;
  rng: Rng;
  /** The validated definition of a system plugin, from the registry (ADR-020). */
  definition?: (systemId: string) => PluginDefinition | undefined;
}

/** A formula engine error as `422 invalid_formula` (ADR-018). */
function invalidFormula(error: FormulaError) {
  return unprocessable('invalid_formula', error.message, {
    reason: error.code,
    line: error.line,
    column: error.column,
  });
}

/** Runs `roll`, turning formula and engine errors into 422s. */
function rolling<T>(roll: () => T): T {
  try {
    return roll();
  } catch (error) {
    if (error instanceof FormulaError) throw invalidFormula(error);
    if (error instanceof EngineError) throw unprocessable(error.code, error.message);
    throw error;
  }
}

/** The plugin's texts in its default language, for the plain-text fallback of a card. */
function translator(plugin: PluginDefinition): (text: string) => string {
  const locale = plugin.manifest.defaultLocale ?? plugin.manifest.locales?.[0] ?? 'en';
  const lang = plugin.lang[locale] ?? {};
  return (text) => (Object.hasOwn(lang, text) ? (lang[text] ?? text) : text);
}

/** A typed formula: against the actor and the system's rules when both are known. */
function rollFormula(
  formula: string,
  actor: Actor | null,
  system: { plugin: PluginDefinition; rules: Rules } | undefined,
  rng: Rng,
): RollResult {
  if (!system) return rolling(() => roll(formula, { rng, data: actor?.system ?? {} }));
  // An actor whose type the plugin no longer has still rolls against its raw data.
  const known = actor !== null && Object.hasOwn(system.plugin.actorTypes, actor.type);
  return rolling(() =>
    system.rules.rollFormula(formula, {
      ...(known ? { type: actor.type } : {}),
      data: actor?.system ?? {},
      rng,
    }),
  );
}

/**
 * Rolls a formula typed by a member, or a roll recipe of the table's system, and stores the
 * message (FR-CHAT-03, 08). Speaking as an actor rolls against that actor's data with its
 * derived values, the table settings and the system's custom dice (FR-DICE-02, 03; ADR-025).
 * A recipe needs an actor; it posts a `card` message whose text is the plain-text fallback
 * (FR-CHAT-06). The audience works as for text messages, so a `gm` roll reaches only the
 * sender, the GM and assistants (FR-CHAT-05).
 */
export function sendRollMessage(
  db: DbOrTx,
  sender: { tableId: string; userId: string; role: TableRole },
  input: RollRequest,
  { now, rng, definition }: RollOptions,
): ChatMessageRow {
  if (!canSendChat(sender.role)) throw forbidden('Spectators cannot roll.');
  const subject: Subject = { userId: sender.userId, role: sender.role };

  return db.transaction((tx) => {
    const table = findTable(tx, sender.tableId);
    if (table) requireWritableSystem(tx, table);
    const { speaker, actor } = speakerFor(tx, sender.tableId, subject, input.actorId);
    const recipients = recipientsFor(tx, sender, input);
    const plugin = table ? definition?.(table.systemId) : undefined;
    const system =
      table && plugin
        ? { plugin, rules: createRules(plugin, { settings: table.settings }) }
        : undefined;
    const message = {
      tableId: sender.tableId,
      senderId: sender.userId,
      speaker,
      audience: input.audience,
      recipients,
    };

    if (input.recipe) {
      const { name, args } = input.recipe;
      if (!system)
        throw unprocessable('system_unavailable', 'The table’s system cannot roll recipes.');
      if (!actor) throw unprocessable('actor_required', 'Choose an actor to roll for.');
      const result = rolling(() =>
        system.rules.roll(name, { kind: 'actor', type: actor.type, data: actor.system, args, rng }),
      );
      const view = chatCardView(result, {
        hasTemplate: () => false,
        translate: translator(system.plugin),
      });
      const card: RecipeCard = {
        system: system.plugin.manifest.id,
        recipe: result.recipe,
        label: result.label ?? null,
        outcome: result.outcome,
        card: result.card ?? null,
      };
      return createChatMessage(
        tx,
        {
          ...message,
          kind: 'card',
          text: view.kind === 'text' ? view.text : '',
          rolls: [result.roll],
          card,
        },
        now,
      );
    }

    const result = rollFormula(input.formula ?? '', actor, system, rng);
    return createChatMessage(
      tx,
      { ...message, kind: 'roll', text: input.formula ?? '', rolls: [result] },
      now,
    );
  });
}
