import { z } from 'zod';

import { canRunCombat, type TableRole } from '@vtt/shared';
import {
  combatantCreateBody,
  combatantUpdateBody,
  initiativeBody,
  turnBody,
  type EncounterResponse,
} from '@vtt/shared/api';

import type { ChatMessageRow } from '../../db/repositories/index.js';
import {
  addCombatant,
  arrangeEncounter,
  createEncounter,
  endEncounter,
  findEncounter,
  moveTurn,
  removeCombatant,
  rollInitiative,
  startEncounter,
  startTurn,
  toEncounterView,
  updateCombatant,
} from '../../domain/combat.js';
import { requireWritableSystem } from '../../domain/entities.js';
import { publishChatMessage } from '../../realtime/notify.js';
import type { AppContext } from '../app.js';
import { requireMember } from '../membership.js';
import { rollOptions } from '../roll-options.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });
const combatantParams = z.object({ id: z.uuid(), combatantId: z.string().min(1).max(64) });

/**
 * The table's encounter (FR-COMBAT-01, 03, 04; ADR-049). Every member reads it as they may see
 * it; GMs and assistants run it. Each change tells the table with `combat.updated`, and
 * members refetch, so what they receive is always filtered here.
 */
export function combatRoutes(context: AppContext): void {
  const { app, db, events, now } = context;
  const options = rollOptions(context);
  const base = '/api/v1/tables/:id/encounter';

  /** The GM's request: checks the role and that the table can be changed. */
  const running = (request: Parameters<typeof requireMember>[1]) => {
    const { id } = parseInput(idParams, request.params);
    const access = requireMember(db, request, id, canRunCombat);
    requireWritableSystem(db, access.table);
    const { userId, role } = access.membership;
    return { id, ...access, runner: { tableId: id, userId, role } };
  };

  /**
   * After a change: the turn order is worked out again, then the table hears of the messages
   * posted and of the change (ADR-050). `turn` also runs the new turn's `onTurnStart` hook.
   */
  const changed = async (
    runner: { tableId: string; userId: string; role: TableRole },
    { posted = [], turn = false }: { posted?: ChatMessageRow[]; turn?: boolean } = {},
  ): Promise<EncounterResponse> => {
    const { tableId } = runner;
    const messages = [...posted, ...(await arrangeEncounter(db, runner, options))];
    if (turn) messages.push(...(await startTurn(db, runner, options)));
    for (const row of messages) publishChatMessage(events, row);
    events.publish(tableId, { type: 'combat.updated', tableId, payload: {} }, () => true);
    const encounter = findEncounter(db, tableId);
    return { encounter: encounter ? toEncounterView(db, encounter, runner) : null };
  };

  app.get(base, (request): EncounterResponse => {
    const { id } = parseInput(idParams, request.params);
    const { membership } = requireMember(db, request, id);
    const encounter = findEncounter(db, id);
    return { encounter: encounter ? toEncounterView(db, encounter, membership) : null };
  });

  app.post(base, async (request, reply) => {
    const { id, runner } = running(request);
    createEncounter(db, id, now());
    return reply.code(201).send(await changed(runner));
  });

  app.delete(base, (request, reply) => {
    const { id } = running(request);
    endEncounter(db, id);
    events.publish(id, { type: 'combat.updated', tableId: id, payload: {} }, () => true);
    return reply.code(204).send();
  });

  app.post(`${base}/combatants`, async (request, reply) => {
    const { id, runner } = running(request);
    const body = parseInput(combatantCreateBody, request.body);
    addCombatant(db, id, body, now());
    return reply.code(201).send(await changed(runner));
  });

  app.patch(`${base}/combatants/:combatantId`, async (request) => {
    const { combatantId } = parseInput(combatantParams, request.params);
    const { id, runner } = running(request);
    const body = parseInput(combatantUpdateBody, request.body);
    updateCombatant(db, id, combatantId, body, now());
    return changed(runner);
  });

  app.delete(`${base}/combatants/:combatantId`, async (request) => {
    const { combatantId } = parseInput(combatantParams, request.params);
    const { id, runner } = running(request);
    removeCombatant(db, id, combatantId, now());
    return changed(runner);
  });

  /** Rolls initiative (FR-COMBAT-02); each roll is a chat message. */
  app.post(`${base}/initiative`, async (request) => {
    const { runner } = running(request);
    const { combatantIds } = parseInput(initiativeBody, request.body ?? {});
    const posted = await rollInitiative(db, runner, combatantIds, options);
    return changed(runner, { posted });
  });

  /** Round 1 in the order worked out now, and its first turn's `onTurnStart`. */
  app.post(`${base}/start`, async (request) => {
    const { id, runner } = running(request);
    for (const row of await arrangeEncounter(db, runner, options)) publishChatMessage(events, row);
    startEncounter(db, id, now());
    return changed(runner, { turn: true });
  });

  /** `onTurnStart` runs when the turn moves on, not when the GM steps back. */
  app.post(`${base}/turn`, async (request) => {
    const { id, runner } = running(request);
    const { direction } = parseInput(turnBody, request.body);
    moveTurn(db, id, direction, now());
    return changed(runner, { turn: direction === 'next' });
  });
}
