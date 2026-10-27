import { z } from 'zod';

import { ACTOR_LAYERS, actorLayerAccess, type ActorLayer } from '@vtt/shared';
import type { ActorHistoryResponse } from '@vtt/shared/api';

import { hasSecretLayer } from '../../domain/documents.js';
import { requireWritableTable } from '../../domain/entities.js';
import { findSnapshot, listSnapshots } from '../../domain/history.js';
import { forbidden, notFound } from '../../errors.js';
import { restoreActorSnapshot } from '../../realtime/collab.js';
import type { AppContext } from '../app.js';
import { requireActor } from '../entities.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });
const snapshotParams = z.object({ id: z.uuid(), snapshotId: z.string().min(1).max(64) });

/**
 * Sheet history (FR-SHEET-11, ADR-053). Members list and restore the snapshots of the
 * documents they may edit: owners and GMs the main sheet, GMs and assistants the secret one.
 */
export function historyRoutes(context: AppContext): void {
  const { app, db, now, plugins } = context;
  const definition = (systemId: string) => plugins.definition(systemId);

  /** The layers whose history the caller may see, for an actor they can see. */
  const historyOf = (request: Parameters<typeof requireActor>[1], id: string) => {
    const found = requireActor(db, request, id);
    const layers = ACTOR_LAYERS.filter(
      (layer: ActorLayer) =>
        actorLayerAccess(found.subject, found.actor.ownership, layer) === 'write' &&
        (layer === 'main' || hasSecretLayer(db, found.actor, definition)),
    );
    if (layers.length === 0) throw forbidden('Only the actor’s owners can see its history.');
    return { ...found, layers };
  };

  app.get('/api/v1/actors/:id/history', (request): ActorHistoryResponse => {
    const { id } = parseInput(idParams, request.params);
    const { layers } = historyOf(request, id);
    return {
      snapshots: listSnapshots(db, id, layers).map((row) => ({
        id: row.id,
        layer: row.layer,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });

  app.post('/api/v1/actors/:id/history/:snapshotId/restore', async (request, reply) => {
    const { id, snapshotId } = parseInput(snapshotParams, request.params);
    const { layers, table } = historyOf(request, id);
    const snapshot = findSnapshot(db, id, snapshotId);
    // Another layer's snapshot does not exist for the caller.
    if (!snapshot || !layers.includes(snapshot.layer)) throw notFound('Snapshot not found.');
    requireWritableTable(db, table);
    await restoreActorSnapshot(context, snapshot, now());
    return reply.code(204).send();
  });
}
