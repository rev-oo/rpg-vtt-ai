import { asc, eq } from 'drizzle-orm';

import { canViewActor, isGmLike, type Subject } from '@vtt/shared';
import type {
  CombatantCreateInput,
  CombatantUpdateInput,
  CombatantView,
  EncounterView,
} from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { findActor } from '../db/repositories/index.js';
import { combatants, encounters } from '../db/schema.js';
import { conflict, notFound, unprocessable } from '../errors.js';

import { generateId } from './auth/tokens.js';

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

/** Turn order: highest initiative first, those without one last, ties in adding order. */
export function turnOrder(list: readonly Combatant[]): Combatant[] {
  return [...list].sort((a, b) => {
    if (a.initiative !== b.initiative) {
      if (a.initiative === null) return 1;
      if (b.initiative === null) return -1;
      return b.initiative - a.initiative;
    }
    return a.sort - b.sort;
  });
}

function combatantsOf(db: DbOrTx, encounterId: string): Combatant[] {
  return turnOrder(
    db
      .select()
      .from(combatants)
      .where(eq(combatants.encounterId, encounterId))
      .orderBy(asc(combatants.sort))
      .all(),
  );
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
