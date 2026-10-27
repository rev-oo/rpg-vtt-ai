import type { RollResult, Scalar, Value } from '@vtt/formula';

// What plugin shared and server code may use (specs §8.10, ADR-047). The server runs both in a
// worker thread per plugin; `defineShared` and `defineServer` only give the exports their types.

export const packageName = '@vtt/sdk';

/** A function formulas can call by name. It must be pure and return a number, text or true/false. */
export type SharedFunction = (...args: Value[]) => Scalar;

/** The default export of `code/shared`. */
export interface SharedDefinition {
  functions?: Readonly<Record<string, SharedFunction>>;
}

/** Declares the functions of `code/shared`, which formulas call on the server and in sheets. */
export function defineShared<const T extends SharedDefinition>(definition: T): T {
  return definition;
}

/** A roll made with `ctx.roll`. Pass it to `ctx.chat.post` to show it. */
export interface HandlerRoll extends RollResult {
  /** Which roll of this call it is; the server posts its own copy, so results cannot be changed. */
  readonly ref: number;
}

/** An actor as the player who rolled may see it. */
export interface HandlerActor {
  id: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
}

/** A message posted by a handler, as the roll's speaker and to the roll's audience. */
export interface HandlerPost {
  text?: string;
  rolls?: readonly HandlerRoll[];
}

/** What server code can do: everything goes through the server, on behalf of who rolled. */
export interface ServerContext {
  /** Rolls a formula against the recipe's actor, its derived values, `@settings` and `@args`. */
  roll(formula: string): Promise<HandlerRoll>;
  chat: {
    /** Posts a message; a handler must post at least one, and at most 10. */
    post(message: HandlerPost): Promise<void>;
  };
  actors: {
    /** An actor of the table, with the fields the roller may see; `null` if they cannot see it. */
    get(id: string): Promise<HandlerActor | null>;
    /** Steps a counter field (`x-counter`) of an actor the roller may edit; returns its new value. */
    adjust(id: string, path: string, delta: number): Promise<number>;
  };
  log(message: string, data?: Readonly<Record<string, unknown>>): void;
  /** Stops the code with a message the caller sees, such as how to use a command. */
  fail(message: string): never;
}

/** What a `handler` recipe receives. */
export interface HandlerInput {
  ctx: ServerContext;
  /** The actor the recipe was rolled for. */
  actor: HandlerActor;
  /** The roll button's `args`. */
  args: Readonly<Record<string, Value>>;
}

export type Handler = (input: HandlerInput) => Promise<void> | void;

/** What a slash command gets: `/name args` typed by a member (ADR-048). */
export interface CommandInput {
  ctx: ServerContext;
  /** The actor the member speaks as, if any. */
  actor: HandlerActor | null;
  /** The text after the command's name. */
  args: string;
}

export type Command = (input: CommandInput) => Promise<void> | void;

/** A combatant as combat hooks see it (ADR-050). */
export interface HookCombatant {
  id: string;
  name: string;
  initiative: number | null;
  /** Only GMs and assistants see hidden combatants. */
  hidden: boolean;
  /** The actor type's `controlledBy`; free-form combatants are on the GM's side. */
  side: 'player' | 'gm';
  /** Adding order. */
  sort: number;
  actor: HandlerActor | null;
}

/**
 * Called when the turn passes to a combatant: on start and on "next turn", not when the GM
 * steps back. It acts as the GM, speaking as the combatant's actor; `ctx.roll` reads its data.
 */
export type TurnStartHook = (input: {
  ctx: ServerContext;
  combatant: HookCombatant;
  actor: HandlerActor | null;
  round: number;
}) => Promise<void> | void;

/**
 * Orders the encounter after every change, replacing `combat.json`'s `order`: returns every
 * combatant's id once, in turn order. Any other answer is ignored with a warning in the log.
 */
export type OrderCombatantsHook = (input: {
  ctx: ServerContext;
  combatants: readonly HookCombatant[];
}) => Promise<readonly string[]> | readonly string[];

/** Combat hooks (ADR-050). */
export interface Hooks {
  onTurnStart?: TurnStartHook;
  orderCombatants?: OrderCombatantsHook;
}

/** The default export of `code/server`. */
export interface ServerDefinition {
  /** Run by `handler` recipes in `rolls.json`, by name. */
  handlers?: Readonly<Record<string, Handler>>;
  /** Slash commands, by name: lower-case letters, digits, `-` and `_` (ADR-048). */
  commands?: Readonly<Record<string, Command>>;
  hooks?: Hooks;
}

/** Declares the handlers, commands and hooks of `code/server`. */
export function defineServer<const T extends ServerDefinition>(definition: T): T {
  return definition;
}
