import { randomInt } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import {
  FormulaError,
  roll,
  type FormulaFunction,
  type Rng,
  type RollResult,
  type Value,
} from '@vtt/formula';
import {
  chatCardView,
  createRules,
  EngineError,
  playerDefinition,
  type Rules,
} from '@vtt/plugin-engine';
import type { PluginDefinition } from '@vtt/plugin-schema';
import { canSendChat, isGmLike, type Subject, type TableRole } from '@vtt/shared';
import {
  MAX_ADJUST_DELTA,
  MAX_CHAT_TEXT,
  MAX_FORMULA_LENGTH,
  type FieldPath,
  type RecipeCard,
  type rollRequestBody,
} from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import {
  createChatMessage,
  findActor,
  type Actor,
  type ChatMessageRow,
} from '../db/repositories/index.js';
import { forbidden, unprocessable } from '../errors.js';
import { PluginCodeError, type LoadedCode } from '../plugins/code-runtime.js';

import { recipientsFor, speakerFor } from './chat.js';
import { actorAccess, dataFilter, requireWritableSystem, type DataFilter } from './entities.js';
import { findTable } from './tables.js';

export type RollRequest = z.output<typeof rollRequestBody>;

/** The messages a roll posted: always at least one. */
export type PostedMessages = [ChatMessageRow, ...ChatMessageRow[]];

/** Rolls with a cryptographically secure RNG (FR-CHAT-04). */
export const secureRng: Rng = { nextInt: (n) => randomInt(n) };

/** The most messages one handler may post (ADR-047). */
export const MAX_HANDLER_POSTS = 10;

/** Steps a counter of an actor's live document; `undefined` when the path is no counter there. */
export type AdjustCounter = (
  actor: Actor,
  layer: 'main' | 'secret',
  path: FieldPath,
  delta: number,
) => Promise<number | undefined>;

export interface RollOptions {
  now: () => Date;
  rng: Rng;
  logger: FastifyBaseLogger;
  /** The validated definition of a system plugin, from the registry (ADR-020). */
  definition?: (systemId: string) => PluginDefinition | undefined;
  /** An actor's live sheet data while its document is loaded (specs §9.6). */
  liveData?: (actor: Actor) => Record<string, unknown> | undefined;
  /** The system's shared and server code, if it has any (ADR-047). */
  code?: (systemId: string) => Promise<LoadedCode | undefined>;
  /** For handlers' `ctx.actors.adjust`. */
  adjust?: AdjustCounter;
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

/**
 * A typed formula: against the actor and the system's rules when both are known. It reads
 * only what the sender may see of the actor, so a formula cannot reveal secret fields.
 */
function rollFormula(
  formula: string,
  actor: Actor | null,
  system: { plugin: PluginDefinition; rules: Rules } | undefined,
  { rng, visible }: { rng: Rng; visible: DataFilter },
): RollResult {
  const data = actor ? visible('actor', actor.type, actor.system) : {};
  if (!system) return rolling(() => roll(formula, { rng, data }));
  // An actor whose type the plugin no longer has still rolls against its raw data.
  const known = actor !== null && Object.hasOwn(system.plugin.actorTypes, actor.type);
  return rolling(() =>
    system.rules.rollFormula(formula, {
      ...(known ? { type: actor.type } : {}),
      data,
      rng,
    }),
  );
}

/** What a roll is about, worked out in one transaction before anything is rolled. */
interface Prepared {
  subject: Subject;
  message: Omit<Parameters<typeof createChatMessage>[1], 'kind' | 'text'>;
  actor: Actor | null;
  table: ReturnType<typeof findTable>;
  plugin: PluginDefinition | undefined;
}

function prepare(
  db: DbOrTx,
  sender: { tableId: string; userId: string; role: TableRole },
  input: RollRequest,
  { definition, liveData }: RollOptions,
): Prepared {
  const subject: Subject = { userId: sender.userId, role: sender.role };
  return db.transaction((tx) => {
    const table = findTable(tx, sender.tableId);
    if (table) requireWritableSystem(tx, table);
    const spoken = speakerFor(tx, sender.tableId, subject, input.actorId);
    // Rolls read the live sheet, not the projection, which lags by the store debounce.
    const actor = spoken.actor && {
      ...spoken.actor,
      system: liveData?.(spoken.actor) ?? spoken.actor.system,
    };
    return {
      subject,
      actor,
      table,
      plugin: table ? definition?.(table.systemId) : undefined,
      message: {
        tableId: sender.tableId,
        senderId: sender.userId,
        speaker: spoken.speaker,
        audience: input.audience,
        recipients: recipientsFor(tx, sender, input),
        rolls: [],
      },
    };
  });
}

/**
 * Rolls a formula typed by a member, or a roll recipe of the table's system, and stores the
 * messages (FR-CHAT-03, 08). Speaking as an actor rolls against that actor's data with its
 * derived values, the table settings, the system's custom dice and its shared functions
 * (FR-DICE-02, 03; ADR-025, ADR-047). A recipe needs an actor. A formula recipe posts one
 * `card` message whose text is the plain-text fallback (FR-CHAT-06); a `handler` recipe runs
 * plugin server code, which posts its own messages (ADR-047). The audience works as for text
 * messages, so a `gm` roll reaches only the sender, the GM and assistants (FR-CHAT-05).
 */
export async function sendRollMessages(
  db: DbOrTx,
  sender: { tableId: string; userId: string; role: TableRole },
  input: RollRequest,
  options: RollOptions,
): Promise<PostedMessages> {
  if (!canSendChat(sender.role)) throw forbidden('Spectators cannot roll.');
  const { now, rng, logger } = options;
  const prepared = prepare(db, sender, input, options);
  const { table, plugin, actor, message } = prepared;

  let code: LoadedCode | undefined;
  if (table && plugin && options.code) {
    try {
      code = await options.code(table.systemId);
    } catch (error) {
      logger.warn({ err: error, plugin: table.systemId }, 'plugin code unavailable');
      // Formulas still roll, without the shared functions; handlers need the code.
      if (input.recipe && isHandler(plugin, input.recipe.name)) {
        throw unprocessable('plugin_code_failed', 'The system’s plugin code could not be loaded.');
      }
    }
  }
  const functions = code?.functions ?? {};
  const system =
    table && plugin
      ? { plugin, rules: createRules(plugin, { settings: table.settings, functions }) }
      : undefined;

  if (input.recipe) {
    const { name, args } = input.recipe;
    if (!system)
      throw unprocessable('system_unavailable', 'The table’s system cannot roll recipes.');
    if (!actor) throw unprocessable('actor_required', 'Choose an actor to roll for.');
    if (isHandler(system.plugin, name)) {
      return runHandler(db, prepared, { name, args, code, functions }, options);
    }
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
    const row = db.transaction((tx) =>
      createChatMessage(
        tx,
        {
          ...message,
          kind: 'card',
          text: view.kind === 'text' ? view.text : '',
          rolls: [result.roll],
          card,
        },
        now(),
      ),
    );
    return [row];
  }

  const visible = dataFilter(plugin, sender.role);
  const result = rollFormula(
    input.formula ?? '',
    actor,
    typedSystem(prepared, functions) ?? system,
    {
      rng,
      visible,
    },
  );
  const row = db.transaction((tx) =>
    createChatMessage(
      tx,
      { ...message, kind: 'roll', text: input.formula ?? '', rolls: [result] },
      now(),
    ),
  );
  return [row];
}

/** A player's formula runs against the types without their secret fields (FR-SHEET-04). */
function typedSystem(
  { table, plugin, subject }: Prepared,
  functions: Readonly<Record<string, FormulaFunction>>,
): { plugin: PluginDefinition; rules: Rules } | undefined {
  if (!table || !plugin || isGmLike(subject.role)) return undefined;
  return {
    plugin,
    rules: createRules(playerDefinition(plugin), { settings: table.settings, functions }),
  };
}

function isHandler(plugin: PluginDefinition, name: string): boolean {
  const recipe = Object.hasOwn(plugin.rolls, name) ? plugin.rolls[name] : undefined;
  return recipe !== undefined && 'handler' in recipe;
}

const postInput = z.strictObject({
  text: z.string().max(MAX_CHAT_TEXT).optional(),
  rolls: z
    .array(z.object({ ref: z.number().int() }))
    .max(MAX_HANDLER_POSTS)
    .optional(),
});

const adjustInput = z.tuple([
  z.string(),
  z.string().min(1).max(512),
  z.number().min(-MAX_ADJUST_DELTA).max(MAX_ADJUST_DELTA),
]);

/**
 * Runs a `handler` recipe in the plugin's worker (ADR-047). It acts as the sender: it reads
 * actors as they may see them, rolls with player rules unless they are a GM, and posts as the
 * roll's speaker to the roll's audience. It must post at least one message.
 */
async function runHandler(
  db: DbOrTx,
  prepared: Prepared,
  call: {
    name: string;
    args: Readonly<Record<string, Value>>;
    code: LoadedCode | undefined;
    functions: Readonly<Record<string, FormulaFunction>>;
  },
  { now, rng, logger, adjust }: RollOptions,
): Promise<PostedMessages> {
  const { subject, message, actor, plugin, table } = prepared;
  const recipe =
    plugin && Object.hasOwn(plugin.rolls, call.name) ? plugin.rolls[call.name] : undefined;
  if (!actor || !plugin || !table || !recipe || !('handler' in recipe)) {
    throw unprocessable('handler_failed', 'The roll cannot run.');
  }
  const { code } = call;
  if (!code?.handlers.includes(recipe.handler)) {
    throw unprocessable(
      'handler_failed',
      `The system’s code has no handler "${recipe.handler}" for the roll "${call.name}".`,
    );
  }
  const visible = dataFilter(plugin, subject.role);
  const typed = typedSystem(prepared, call.functions) ?? {
    plugin,
    rules: createRules(plugin, { settings: table.settings, functions: call.functions }),
  };
  const view = (seen: Actor) => ({
    id: seen.id,
    name: seen.name,
    type: seen.type,
    data: visible('actor', seen.type, seen.system),
  });
  const rolls = new Map<number, RollResult>();
  const posted: ChatMessageRow[] = [];
  const log = logger.child({ plugin: plugin.manifest.id, handler: recipe.handler });

  const host = async (method: string, args: readonly unknown[]): Promise<unknown> => {
    switch (method) {
      case 'roll': {
        const formula = z.string().min(1).max(MAX_FORMULA_LENGTH).parse(args[0]);
        try {
          const result = typed.rules.rollFormula(formula, {
            type: actor.type,
            data: visible('actor', actor.type, actor.system),
            args: call.args,
            rng,
          });
          const ref = rolls.size + 1;
          rolls.set(ref, result);
          return { ...result, ref };
        } catch (error) {
          if (error instanceof FormulaError) throw new Error(error.message, { cause: error });
          throw error;
        }
      }
      case 'post': {
        if (posted.length >= MAX_HANDLER_POSTS) {
          throw new Error(`A handler may post at most ${String(MAX_HANDLER_POSTS)} messages.`);
        }
        const post = postInput.parse(args[0]);
        // The server's own copies: a handler cannot change a result (FR-CHAT-03).
        const results = (post.rolls ?? []).map(({ ref }) => {
          const result = rolls.get(ref);
          if (!result) throw new Error('Post only rolls made with ctx.roll in this handler.');
          return result;
        });
        const text = post.text?.trim() ?? '';
        if (results.length === 0 && text === '') throw new Error('A message needs text or rolls.');
        posted.push(
          db.transaction((tx) =>
            createChatMessage(
              tx,
              { ...message, kind: results.length > 0 ? 'roll' : 'text', text, rolls: results },
              now(),
            ),
          ),
        );
        return undefined;
      }
      case 'get': {
        const id = z.string().parse(args[0]);
        const found = findActor(db, id);
        if (found?.tableId !== table.id || actorAccess(subject, found) === null) return null;
        return view(found);
      }
      case 'adjust': {
        const [id, path, delta] = adjustInput.parse(args);
        const found = findActor(db, id);
        if (found?.tableId !== table.id || actorAccess(subject, found) !== 'owner') {
          throw new Error('The roller cannot edit that actor.');
        }
        if (!adjust) throw new Error('Counters cannot be adjusted here.');
        const segments = path.split('.');
        const layers = isGmLike(subject.role) ? (['main', 'secret'] as const) : (['main'] as const);
        for (const layer of layers) {
          const value = await adjust(found, layer, segments, delta);
          if (value !== undefined) return value;
        }
        throw new Error(`"${path}" is not a counter the roller can adjust.`);
      }
      default:
        throw new Error(`Unknown ctx method "${method}".`);
    }
  };

  try {
    await code.handle(recipe.handler, { actor: view(actor), args: call.args }, host);
  } catch (error) {
    if (!(error instanceof PluginCodeError)) throw error;
    log.warn({ reason: error.message, code: error.code }, 'roll handler failed');
    // What failed stays in the server log; the plugin's messages are not shown to players.
    const message =
      error.code === 'handler_timeout'
        ? 'The roll’s plugin code took too long.'
        : 'The roll’s plugin code failed.';
    // Messages it posted before failing stay posted.
    if (posted.length === 0) throw unprocessable(error.code, message);
  }
  const [first, ...rest] = posted;
  if (!first) throw unprocessable('handler_no_message', 'The roll’s plugin code posted nothing.');
  return [first, ...rest];
}
