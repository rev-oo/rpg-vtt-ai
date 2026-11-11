import { eq } from 'drizzle-orm';

import { activeStatuses } from '@vtt/plugin-engine';
import { isGmLike, type Subject } from '@vtt/shared';

import type { DbOrTx } from '../db/client.js';
import { findActor } from '../db/repositories/index.js';
import { scenes, tokens } from '../db/schema.js';
import { combatantsOf, findEncounter } from '../domain/combat.js';
import type { DefinitionOf } from '../domain/documents.js';
import { findTable } from '../domain/tables.js';
import { visibleTo } from '../domain/tokens.js';

import type { EventHub } from './hub.js';

/**
 * After an actor's sheet is stored, tells those who see its tokens or its combatants that its
 * statuses changed (T-1618), so they refetch them: `token.updated` for each scene with one of
 * its tokens, and `combat.updated` when it is in the table's encounter. A change to secret
 * statuses alone reaches only GMs and assistants (NFR-08); nothing is sent when no status
 * changed.
 */
export function publishStatusChanges(
  db: DbOrTx,
  hub: EventHub,
  definition: DefinitionOf,
  actorId: string,
  before: Readonly<Record<string, unknown>>,
): void {
  const actor = findActor(db, actorId);
  const table = actor && findTable(db, actor.tableId);
  const plugin = table && definition(table.systemId);
  if (!actor || !plugin || !Object.hasOwn(plugin.actorTypes, actor.type)) return;
  const type = plugin.actorTypes[actor.type];
  if (!type?.statuses) return;
  const on = (data: Readonly<Record<string, unknown>>, secrets: boolean) =>
    activeStatuses(type, data, { secrets })
      .map((status) => status.field)
      .join('\n');
  if (on(before, true) === on(actor.system, true)) return;
  const seen = on(before, false) !== on(actor.system, false);
  const reaches = (subject: Subject) => seen || isGmLike(subject.role);

  const placed = db
    .select({ token: tokens, scene: scenes })
    .from(tokens)
    .innerJoin(scenes, eq(scenes.id, tokens.sceneId))
    .where(eq(tokens.actorId, actor.id))
    .all();
  for (const sceneId of new Set(placed.map(({ scene }) => scene.id))) {
    const here = placed.filter(({ scene }) => scene.id === sceneId);
    hub.publish(
      actor.tableId,
      { type: 'token.updated', tableId: actor.tableId, payload: { sceneId } },
      (subject) =>
        reaches(subject) &&
        here.some(({ token, scene }) => visibleTo(subject, { token, actor }, scene)),
    );
  }

  const encounter = findEncounter(db, actor.tableId);
  const fighting = encounter
    ? combatantsOf(db, encounter.id).filter((combatant) => combatant.actorId === actor.id)
    : [];
  if (fighting.length === 0) return;
  hub.publish(
    actor.tableId,
    { type: 'combat.updated', tableId: actor.tableId, payload: {} },
    (subject) =>
      reaches(subject) && fighting.some((combatant) => !combatant.hidden || isGmLike(subject.role)),
  );
}
