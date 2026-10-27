import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { FormulaError } from '@vtt/formula';
import { createRules, EngineError } from '@vtt/plugin-engine';
import type { Combat as CombatFile, PluginDefinition } from '@vtt/plugin-schema';
import { canViewActor, isGmLike, type Subject, type TableRole } from '@vtt/shared';
import type {
  CombatantCreateInput,
  CombatantUpdateInput,
  CombatantView,
  EncounterView,
} from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import {
  createChatMessage,
  findActor,
  type Actor,
  type ChatMessageRow,
} from '../db/repositories/index.js';
import { combatants, encounters } from '../db/schema.js';
import { conflict, notFound, unprocessable } from '../errors.js';
import type { LoadedCode } from '../plugins/code-runtime.js';

import { generateId } from './auth/tokens.js';
import { runHook, type RollOptions } from './rolls.js';
import { findTable } from './tables.js';

// A table's encounter (FR-COMBAT-01, 03, 04; ADR-049): rows changed by the GM, read by every
// member through a view that leaves out what they may not see.

export type Encounter = typeof encounters.$inferSelect;
export type Combatant = typeof combatants.$inferSelect;

/** The table's encounter, if it has one. */
export function findEncounter(db: DbOrTx, tableId: string): Encounter | undefined {
  return db.select().from(encounters).where(eq(encounters.tableId, tableId)).get();
}

function requireEncounter(db: DbOrTx, tableId: string): Encounter {
  const encounter = findEncounter(db, tableId);
  if (!encounter) throw notFound('The table has no encounter.');
  return encounter;
}

/** Which side a combatant is on: its actor type's `controlledBy`; free-form ones are the GM's. */
export type Side = 'player' | 'gm';
export type OrderRule = NonNullable<CombatFile['order']>;

/** What ordering needs to know of a combatant. */
export interface Orderable {
  id: string;
  initiative: number | null;
  side: Side;
  /** Adding order. */
  sort: number;
}

/** Highest first (`desc`) or lowest first (`asc`); those without initiative always last. */
function byInitiative(rule: 'desc' | 'asc') {
  return (a: Orderable, b: Orderable): number => {
    if (a.initiative !== b.initiative) {
      if (a.initiative === null) return 1;
      if (b.initiative === null) return -1;
      return rule === 'desc' ? b.initiative - a.initiative : a.initiative - b.initiative;
    }
    return a.sort - b.sort;
  };
}

/**
 * Turn order by a `combat.json` rule (FR-COMBAT-02, ADR-050). Ties go in adding order.
 * `sideBased`: each side acts in turn, ordered by its best initiative (the players' side on a
 * tie); within a side, highest first.
 */
export function orderCombatants<T extends Orderable>(list: readonly T[], rule: OrderRule): T[] {
  if (rule !== 'sideBased') return [...list].sort(byInitiative(rule));
  const within = [...list].sort(byInitiative('desc'));
  const best = (side: Side) =>
    within.find((c) => c.side === side && c.initiative !== null)?.initiative ?? -Infinity;
  const first: Side = best('gm') > best('player') ? 'gm' : 'player';
  return [...within.filter((c) => c.side === first), ...within.filter((c) => c.side !== first)];
}

/** The combatants in their stored turn order; ones not yet placed go last, in adding order. */
function combatantsOf(db: DbOrTx, encounterId: string): Combatant[] {
  return db
    .select()
    .from(combatants)
    .where(eq(combatants.encounterId, encounterId))
    .orderBy(sql`${combatants.position} is null`, asc(combatants.position), asc(combatants.sort))
    .all();
}

/**
 * The encounter as `subject` may see it (FR-COMBAT-04). GMs and assistants see everything.
 * Others never receive hidden combatants, nor the turn while a hidden one has it, and see an
 * actor's id only when they may see that actor.
 */
export function toEncounterView(db: DbOrTx, encounter: Encounter, subject: Subject): EncounterView {
  const gm = isGmLike(subject.role);
  const visible: CombatantView[] = [];
  for (const combatant of combatantsOf(db, encounter.id)) {
    if (combatant.hidden && !gm) continue;
    const actor = combatant.actorId ? findActor(db, combatant.actorId) : undefined;
    visible.push({
      id: combatant.id,
      actorId: actor && canViewActor(subject, actor.ownership) ? actor.id : null,
      name: combatant.name,
      initiative: combatant.initiative,
      hidden: combatant.hidden,
    });
  }
  const current = visible.some((c) => c.id === encounter.currentId) ? encounter.currentId : null;
  return { id: encounter.id, round: encounter.round, currentId: current, combatants: visible };
}

/** Starts an encounter for the table; it has none yet. */
export function createEncounter(db: DbOrTx, tableId: string, now: Date): Encounter {
  return db.transaction((tx) => {
    if (findEncounter(tx, tableId)) {
      throw conflict('encounter_exists', 'The table already has an encounter.');
    }
    return tx
      .insert(encounters)
      .values({ id: generateId(), tableId, createdAt: now, updatedAt: now })
      .returning()
      .get();
  });
}

/** Ends the encounter, which removes it with its combatants. */
export function endEncounter(db: DbOrTx, tableId: string): void {
  const encounter = requireEncounter(db, tableId);
  db.delete(encounters).where(eq(encounters.id, encounter.id)).run();
}

function touch(db: DbOrTx, encounter: Encounter, now: Date, values: Partial<Encounter> = {}) {
  return db
    .update(encounters)
    .set({ ...values, updatedAt: now })
    .where(eq(encounters.id, encounter.id))
    .returning()
    .get();
}

/** Adds an actor of the table, or a free-form entry, to the encounter. */
export function addCombatant(
  db: DbOrTx,
  tableId: string,
  input: CombatantCreateInput,
  now: Date,
): Encounter {
  return db.transaction((tx) => {
    const encounter = requireEncounter(tx, tableId);
    let name = input.name;
    if (input.actorId !== undefined) {
      const actor = findActor(tx, input.actorId);
      if (actor?.tableId !== tableId) {
        throw unprocessable('invalid_actor', 'Combatants must be actors of this table.');
      }
      name ??= actor.name;
    }
    if (name === undefined) {
      throw unprocessable('invalid_combatant', 'A free-form combatant needs a name.');
    }
    const last = combatantsOf(tx, encounter.id).reduce((max, c) => Math.max(max, c.sort), 0);
    // Placed last until the order is worked out again.
    tx.insert(combatants)
      .values({
        id: generateId(),
        encounterId: encounter.id,
        actorId: input.actorId ?? null,
        name,
        initiative: input.initiative ?? null,
        hidden: input.hidden ?? false,
        sort: last + 1,
        createdAt: now,
      })
      .run();
    return touch(tx, encounter, now);
  });
}

function requireCombatant(db: DbOrTx, encounter: Encounter, id: string): Combatant {
  const combatant = db.select().from(combatants).where(eq(combatants.id, id)).get();
  if (combatant?.encounterId !== encounter.id) throw notFound('Combatant not found.');
  return combatant;
}

/** Renames, hides or reveals a combatant, or sets its initiative, which reorders the turns. */
export function updateCombatant(
  db: DbOrTx,
  tableId: string,
  id: string,
  input: CombatantUpdateInput,
  now: Date,
): Encounter {
  return db.transaction((tx) => {
    const encounter = requireEncounter(tx, tableId);
    requireCombatant(tx, encounter, id);
    tx.update(combatants).set(input).where(eq(combatants.id, id)).run();
    return touch(tx, encounter, now);
  });
}

/** Removes a combatant; when it had the turn, the next one in order gets it. */
export function removeCombatant(db: DbOrTx, tableId: string, id: string, now: Date): Encounter {
  return db.transaction((tx) => {
    const encounter = requireEncounter(tx, tableId);
    requireCombatant(tx, encounter, id);
    let currentId = encounter.currentId;
    if (currentId === id) {
      const order = combatantsOf(tx, encounter.id);
      const index = order.findIndex((c) => c.id === id);
      const rest = order.filter((c) => c.id !== id);
      currentId = rest.length === 0 ? null : (rest[index % rest.length]?.id ?? null);
    }
    tx.delete(combatants).where(eq(combatants.id, id)).run();
    return touch(tx, encounter, now, { currentId });
  });
}

/** Round 1, first combatant in order (FR-COMBAT-03). */
export function startEncounter(db: DbOrTx, tableId: string, now: Date): Encounter {
  return db.transaction((tx) => {
    const encounter = requireEncounter(tx, tableId);
    if (encounter.round > 0) throw conflict('encounter_started', 'The encounter has started.');
    const [first] = combatantsOf(tx, encounter.id);
    if (!first) throw unprocessable('no_combatants', 'Add combatants before starting.');
    return touch(tx, encounter, now, { round: 1, currentId: first.id });
  });
}

/**
 * Passes the turn to the next combatant in order, or back to the previous one. Past the last,
 * a new round starts; back from the first, the previous round's last (never before round 1).
 */
export function moveTurn(
  db: DbOrTx,
  tableId: string,
  direction: 'next' | 'previous',
  now: Date,
): Encounter {
  return db.transaction((tx) => {
    const encounter = requireEncounter(tx, tableId);
    if (encounter.round === 0) {
      throw conflict('encounter_not_started', 'The encounter has not started.');
    }
    const order = combatantsOf(tx, encounter.id);
    if (order.length === 0) return touch(tx, encounter, now, { currentId: null });
    const index = order.findIndex((c) => c.id === encounter.currentId);
    let round = encounter.round;
    let next: number;
    if (direction === 'next') {
      next = index + 1;
      if (next >= order.length) {
        next = 0;
        round += 1;
      }
    } else if (index <= 0) {
      if (round === 1) return encounter;
      next = order.length - 1;
      round -= 1;
    } else {
      next = index - 1;
    }
    return touch(tx, encounter, now, { round, currentId: order[next]?.id ?? null });
  });
}

/** The GM or assistant changing the encounter: hooks and rolls act as them. */
export interface CombatRunner {
  tableId: string;
  userId: string;
  role: TableRole;
}

/** A combatant as plugin code sees it (ADR-050): with its side and its actor's data. */
interface CombatantInfo extends Orderable {
  name: string;
  hidden: boolean;
  actor: { id: string; name: string; type: string; data: Record<string, unknown> } | null;
}

function systemOf(db: DbOrTx, tableId: string, options: RollOptions) {
  const table = findTable(db, tableId);
  const plugin = table && options.definition?.(table.systemId);
  return table && plugin ? { table, plugin } : undefined;
}

/** The live actor behind a combatant, if it still exists. */
function actorOf(db: DbOrTx, combatant: Combatant, options: RollOptions): Actor | undefined {
  const actor = combatant.actorId ? findActor(db, combatant.actorId) : undefined;
  return actor && { ...actor, system: options.liveData?.(actor) ?? actor.system };
}

function infoOf(
  db: DbOrTx,
  combatant: Combatant,
  plugin: PluginDefinition | undefined,
  options: RollOptions,
): CombatantInfo {
  const actor = actorOf(db, combatant, options);
  const type =
    actor && plugin && Object.hasOwn(plugin.actorTypes, actor.type)
      ? plugin.actorTypes[actor.type]
      : undefined;
  return {
    id: combatant.id,
    name: combatant.name,
    initiative: combatant.initiative,
    hidden: combatant.hidden,
    sort: combatant.sort,
    side: type?.controlledBy ?? 'gm',
    actor: actor ? { id: actor.id, name: actor.name, type: actor.type, data: actor.system } : null,
  };
}

/** What a plugin's `orderCombatants` hook must return: every combatant's id, once. */
function hookOrder(value: unknown, ids: readonly string[]): string[] | undefined {
  const parsed = z.array(z.string()).safeParse(value);
  if (!parsed.success) return undefined;
  const order = parsed.data;
  const same = order.length === ids.length && new Set(order).size === ids.length;
  return same && order.every((id) => ids.includes(id)) ? order : undefined;
}

/**
 * Works out the turn order again after a change (FR-COMBAT-02, ADR-050): by the system's
 * `orderCombatants` hook when it has one and it answers with every combatant, else by
 * `combat.json`'s `order` (`desc` by default). Returns the messages the hook posted.
 */
export async function arrangeEncounter(
  db: DbOrTx,
  runner: CombatRunner,
  options: RollOptions,
): Promise<ChatMessageRow[]> {
  const encounter = findEncounter(db, runner.tableId);
  if (!encounter) return [];
  const plugin = systemOf(db, runner.tableId, options)?.plugin;
  const infos = combatantsOf(db, encounter.id).map((c) => infoOf(db, c, plugin, options));
  let order = orderCombatants(infos, plugin?.combat?.order ?? 'desc').map((c) => c.id);
  const run = await runHook(
    db,
    runner,
    { actorId: null, audience: 'gm', recipientIds: [] },
    { name: 'orderCombatants', input: { combatants: infos } },
    options,
  );
  if (run && !run.error) {
    const ids = hookOrder(run.value, order);
    if (ids) order = ids;
    else options.logger.warn({ plugin: plugin?.manifest.id }, 'orderCombatants ignored: bad ids');
  }
  db.transaction((tx) => {
    order.forEach((id, position) => {
      tx.update(combatants)
        .set({ position })
        .where(and(eq(combatants.id, id), eq(combatants.encounterId, encounter.id)))
        .run();
    });
  });
  return run?.posted ?? [];
}

/**
 * Rolls the system's `combat.json` initiative for the combatants without one, or for those in
 * `ids` (FR-COMBAT-02). Each roll is a chat message from the combatant, seen only by GMs and
 * assistants when it is hidden. Free-form combatants roll without data, so a formula that reads
 * actor data skips them; the GM types theirs.
 */
export async function rollInitiative(
  db: DbOrTx,
  runner: CombatRunner,
  ids: readonly string[] | undefined,
  options: RollOptions,
): Promise<ChatMessageRow[]> {
  const encounter = requireEncounter(db, runner.tableId);
  const system = systemOf(db, runner.tableId, options);
  const formula = system?.plugin.combat?.initiative;
  if (!system || !formula) {
    throw unprocessable('no_initiative', 'The table’s system has no initiative formula.');
  }
  const { table, plugin } = system;
  let code: LoadedCode | undefined;
  try {
    code = await options.code?.(table.systemId);
  } catch (error) {
    // Formulas still roll, without the shared functions.
    options.logger.warn({ err: error, plugin: table.systemId }, 'plugin code unavailable');
  }
  const rules = createRules(plugin, { settings: table.settings, functions: code?.functions ?? {} });
  const targets = combatantsOf(db, encounter.id).filter((c) =>
    ids ? ids.includes(c.id) : c.initiative === null,
  );
  const now = options.now();
  const posted: ChatMessageRow[] = [];
  const skipped: string[] = [];
  for (const combatant of targets) {
    const actor = actorOf(db, combatant, options);
    const known = actor !== undefined && Object.hasOwn(plugin.actorTypes, actor.type);
    let result;
    try {
      result = rules.rollFormula(formula, {
        ...(known ? { type: actor.type } : {}),
        data: actor?.system ?? {},
        rng: options.rng,
      });
    } catch (error) {
      if (!(error instanceof FormulaError || error instanceof EngineError)) throw error;
      skipped.push(combatant.name);
      continue;
    }
    const rolled = result;
    posted.push(
      db.transaction((tx) => {
        tx.update(combatants)
          .set({ initiative: rolled.total })
          .where(eq(combatants.id, combatant.id))
          .run();
        return createChatMessage(
          tx,
          {
            tableId: runner.tableId,
            senderId: runner.userId,
            speaker: {
              name: combatant.name,
              actorId: actor?.id ?? null,
              imageUrl: actor?.imageUrl ?? null,
            },
            audience: combatant.hidden ? 'gm' : 'public',
            recipients: [],
            kind: 'roll',
            text: formula,
            rolls: [rolled],
          },
          now,
        );
      }),
    );
  }
  if (posted.length === 0 && skipped.length > 0) {
    throw unprocessable(
      'initiative_failed',
      `The initiative formula cannot roll for ${skipped.join(', ')}; type their initiative.`,
    );
  }
  touch(db, encounter, now);
  return posted;
}

/**
 * Runs the system's `onTurnStart` hook for the combatant whose turn it now is (ADR-050), as the
 * runner speaking as that combatant's actor. What it posts reaches only GMs and assistants
 * when the combatant is hidden. A failing hook is logged; the turn stays moved.
 */
export async function startTurn(
  db: DbOrTx,
  runner: CombatRunner,
  options: RollOptions,
): Promise<ChatMessageRow[]> {
  const encounter = findEncounter(db, runner.tableId);
  const current = encounter?.currentId
    ? db.select().from(combatants).where(eq(combatants.id, encounter.currentId)).get()
    : undefined;
  if (!encounter || !current) return [];
  const plugin = systemOf(db, runner.tableId, options)?.plugin;
  const info = infoOf(db, current, plugin, options);
  const run = await runHook(
    db,
    runner,
    {
      actorId: info.actor?.id ?? null,
      audience: current.hidden ? 'gm' : 'public',
      recipientIds: [],
    },
    { name: 'onTurnStart', input: { combatant: info, round: encounter.round } },
    options,
  );
  return run?.posted ?? [];
}
