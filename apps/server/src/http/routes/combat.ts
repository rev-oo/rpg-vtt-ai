import { z } from 'zod';

import { canRunCombat } from '@vtt/shared';
import {
  combatantCreateBody,
  combatantUpdateBody,
  turnBody,
  type EncounterResponse,
} from '@vtt/shared/api';

import {
  addCombatant,
  createEncounter,
  endEncounter,
  findEncounter,
  moveTurn,
  removeCombatant,
  startEncounter,
  toEncounterView,
  updateCombatant,
  type Encounter,
} from '../../domain/combat.js';
import { requireWritableSystem } from '../../domain/entities.js';
import type { AppContext } from '../app.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });
const combatantParams = z.object({ id: z.uuid(), combatantId: z.string().min(1).max(64) });

/**
 * The table's encounter (FR-COMBAT-01, 03, 04; ADR-049). Every member reads it as they may see
 * it; GMs and assistants run it. Each change tells the table with `combat.updated`, and
 * members refetch, so what they receive is always filtered here.
 */
export function combatRoutes({ app, db, events, now }: AppContext): void {
  const base = '/api/v1/tables/:id/encounter';

  /** The GM's request: checks the role and that the table can be changed. */
  const running = (request: Parameters<typeof requireMember>[1]) => {
    const { id } = parseInput(idParams, request.params);
    const access = requireMember(db, request, id, canRunCombat);
    requireWritableSystem(db, access.table);
    return { id, ...access };
  };

  const changed = (
    tableId: string,
    encounter: Encounter | undefined,
    subject: Parameters<typeof toEncounterView>[2],
  ): EncounterResponse => {
    events.publish(tableId, { type: 'combat.updated', tableId, payload: {} }, () => true);
    return { encounter: encounter ? toEncounterView(db, encounter, subject) : null };
  };

  app.get(base, (request): EncounterResponse => {
    const { id } = parseInput(idParams, request.params);
    const { membership } = requireMember(db, request, id);
    const encounter = findEncounter(db, id);
    return { encounter: encounter ? toEncounterView(db, encounter, membership) : null };
  });

  app.post(base, (request, reply) => {
    const { id, membership } = running(request);
    const encounter = createEncounter(db, id, now());
    return reply.code(201).send(changed(id, encounter, membership));
  });

  app.delete(base, (request, reply) => {
    const { id } = running(request);
    endEncounter(db, id);
    events.publish(id, { type: 'combat.updated', tableId: id, payload: {} }, () => true);
    return reply.code(204).send();
  });

  app.post(`${base}/combatants`, (request, reply) => {
    const { id, membership } = running(request);
    const body = parseInput(combatantCreateBody, request.body);
    return reply.code(201).send(changed(id, addCombatant(db, id, body, now()), membership));
  });

  app.patch(`${base}/combatants/:combatantId`, (request) => {
    const { combatantId } = parseInput(combatantParams, request.params);
    const { id, membership } = running(request);
    const body = parseInput(combatantUpdateBody, request.body);
    return changed(id, updateCombatant(db, id, combatantId, body, now()), membership);
  });

  app.delete(`${base}/combatants/:combatantId`, (request) => {
    const { combatantId } = parseInput(combatantParams, request.params);
    const { id, membership } = running(request);
    return changed(id, removeCombatant(db, id, combatantId, now()), membership);
  });

  app.post(`${base}/start`, (request) => {
    const { id, membership } = running(request);
    return changed(id, startEncounter(db, id, now()), membership);
  });

  app.post(`${base}/turn`, (request) => {
    const { id, membership } = running(request);
    const { direction } = parseInput(turnBody, request.body);
    return changed(id, moveTurn(db, id, direction, now()), membership);
  });
}
