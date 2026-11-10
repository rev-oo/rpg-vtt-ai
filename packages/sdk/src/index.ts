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

/** An item as server code gets it (T-1610): its fields and its derived values. */
export interface HandlerItem {
  id: string;
  name: string;
  type: string;
  /** Its fields; secret fields are left out. */
  data: Record<string, unknown>;
  /** Its derived values, as `@item.derived` reads them. */
  derived: Record<string, Value>;
}

/**
 * A message posted by a handler, as the roll's speaker and to the roll's audience: `text`, or a
 * lang `key` with `params` (T-1611), and the rolls it shows.
 */
export interface HandlerPost {
  /** Text everyone reads as written. */
  text?: string;
  /**
   * A key of the plugin's lang files, instead of `text`: each viewer reads it in their
   * language, `{name}` filled from `params`. It needs an English text, which the message keeps
   * for everything else (exports, a disabled plugin).
   */
  key?: string;
  /** The key's parameters; a string that is a lang key (`ability.dex`) is translated too. */
  params?: Readonly<Record<string, string | number>>;
  rolls?: readonly HandlerRoll[];
}

/** What server code can do: everything goes through the server, on behalf of who rolled. */
export interface ServerContext {
  /**
   * Rolls a formula against the recipe's actor, its derived values, its items' totals
   * (`@items`), `@settings` and `@args`.
   */
  roll(formula: string): Promise<HandlerRoll>;
  chat: {
    /** Posts a message; a handler must post at least one, and at most 10. */
    post(message: HandlerPost): Promise<void>;
  };
  actors: {
    /** An actor of the table, with the fields the roller may see; `null` if they cannot see it. */
    get(id: string): Promise<HandlerActor | null>;
    /**
     * Steps a counter field (`x-counter`) of an actor the roller may edit, within its bounds;
     * returns its new value. A path into a collection names the row by id: `attacks.<id>.uses`.
     */
    adjust(id: string, path: string, delta: number): Promise<number>;
    /**
     * Sets a text, number or true/false field that is not a counter, of an actor the roller may
     * edit (T-1610). The value must fit the field, or the call throws.
     */
    set(id: string, path: string, value: string | number | boolean): Promise<void>;
  };
  items: {
    /**
     * Steps a counter field of an item the roller may edit, within its bounds (T-1610): one held
     * by an actor they own, or, for GMs and assistants, one in the library. Returns its new value.
     */
    adjust(id: string, path: string, delta: number): Promise<number>;
  };
  log(message: string, data?: Readonly<Record<string, unknown>>): void;
  /** Stops the code with a message the caller sees, such as how to use a command. */
  fail(message: string): never;
}

/** A roll a recipe posted, as its `then` handler gets it (T-1610). */
export interface PostedRoll {
  /** The first roll's total, which `@total` reads. */
  total: number;
  /** The label of the outcome that matched, or `null`. */
  outcome: string | null;
  /** Every roll in order: one, or one per named formula. */
  rolls: readonly RollResult[];
}

/** What a `handler` recipe, or a formula recipe's `then` handler, receives. */
export interface HandlerInput {
  ctx: ServerContext;
  /** The actor the recipe was rolled for. */
  actor: HandlerActor;
  /** The actor's derived values, as `@derived` reads them (T-1610). */
  derived: Readonly<Record<string, Value>>;
  /** The actor's item totals, as `@items` reads them (T-1610). */
  totals: Readonly<Record<string, Value>>;
  /** The items the actor holds (T-1610). */
  items: readonly HandlerItem[];
  /** The item the roll is made with, when the recipe declares `item` (T-1610). */
  item?: HandlerItem;
  /** The roll button's `args`. */
  args: Readonly<Record<string, Value>>;
  /** For `then`: the options, as `@options` read them; empty for handler recipes. */
  options: Readonly<Record<string, string | number>>;
  /** For `then`: the roll the recipe posted (T-1610). */
  result?: PostedRoll;
}

/**
 * Runs a `handler` recipe, which must post at least one message, or a formula recipe's `then`,
 * after its roll is posted, which may post nothing. A `then` that fails leaves the roll posted.
 */
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

/**
 * What a `migrate` hook gets (ADR-072): one actor's or item's data, both layers, as the
 * `migrations/` steps left it, in the stored form (a collection is a map of rows by id).
 */
export interface MigrateInput {
  kind: 'actor' | 'item';
  type: string;
  /** The version the data was made with or last brought up to. */
  from: string;
  /** The version it is brought up to: the table's new version. */
  to: string;
  data: Readonly<Record<string, unknown>>;
}

/**
 * Brings data up to the table's new version where the steps cannot, when a GM upgrades it.
 * Returns the new data, which must fit the type's schema; throwing, or data that does not
 * fit, leaves the entity as it was and reports it. It runs on data only: it has no `ctx`.
 */
export type MigrateHook = (
  input: MigrateInput,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

/** Combat hooks (ADR-050) and the data migration hook (ADR-072). */
export interface Hooks {
  onTurnStart?: TurnStartHook;
  orderCombatants?: OrderCombatantsHook;
  migrate?: MigrateHook;
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
