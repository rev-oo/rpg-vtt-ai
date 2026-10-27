import { z } from 'zod';

import { ACTOR_LAYERS } from '../permissions/entities.js';

// Sheet history (FR-SHEET-11, ADR-053): snapshots of an actor's documents, which owners and
// GMs restore.

/** A snapshot as listed: secret ones only for GMs and assistants. */
export const actorSnapshotSchema = z.object({
  id: z.string(),
  layer: z.enum(ACTOR_LAYERS),
  createdAt: z.string(),
});
export type ActorSnapshot = z.infer<typeof actorSnapshotSchema>;

/** `GET /actors/:id/history`, newest first. */
export const actorHistoryResponseSchema = z.object({ snapshots: z.array(actorSnapshotSchema) });
export type ActorHistoryResponse = z.infer<typeof actorHistoryResponseSchema>;
