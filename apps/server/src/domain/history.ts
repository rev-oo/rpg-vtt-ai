import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import * as Y from 'yjs';

import { copyInto } from '@vtt/plugin-engine';
import type { ActorLayer } from '@vtt/shared';

import type { DbOrTx } from '../db/client.js';
import { actorSnapshots } from '../db/schema.js';

import { generateId } from './auth/tokens.js';

/** Sheet history (FR-SHEET-11, ADR-053): how often a document is copied, and how many stay. */
export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
export const MAX_SNAPSHOTS = 50;

export type SnapshotRow = typeof actorSnapshots.$inferSelect;

/** The `data` map a snapshot's state holds. */
const SNAPSHOT_MAP = 'data';

/** A copy of a document's data map in a fresh document, as a Yjs update. */
function encodeSnapshot(data: Y.Map<unknown>): Buffer {
  const doc = new Y.Doc();
  doc.transact(() => {
    copyInto(doc.getMap(SNAPSHOT_MAP), data);
  });
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return state;
}

/** Reads a snapshot's data map; destroy the returned document after use. */
export function decodeSnapshot(state: Uint8Array): { doc: Y.Doc; data: Y.Map<unknown> } {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return { doc, data: doc.getMap(SNAPSHOT_MAP) };
}

function latestSnapshot(db: DbOrTx, actorId: string, layer: ActorLayer) {
  return db
    .select()
    .from(actorSnapshots)
    .where(and(eq(actorSnapshots.actorId, actorId), eq(actorSnapshots.layer, layer)))
    .orderBy(desc(actorSnapshots.seq))
    .limit(1)
    .get();
}

/**
 * Takes a snapshot of an actor document when it is stored (ADR-053): unless one was taken
 * less than 5 minutes ago or nothing changed since the last one. `force` skips the wait, to
 * keep what a restore replaces. The newest 50 per document are kept.
 */
export function recordSnapshot(
  db: DbOrTx,
  { actorId, layer }: { actorId: string; layer: ActorLayer },
  data: Y.Map<unknown>,
  now: Date,
  { force = false }: { force?: boolean } = {},
): void {
  const latest = latestSnapshot(db, actorId, layer);
  if (latest && !force && now.getTime() - latest.createdAt.getTime() < SNAPSHOT_INTERVAL_MS) {
    return;
  }
  const json = JSON.stringify(data.toJSON());
  if (latest) {
    const previous = decodeSnapshot(latest.state);
    const same = JSON.stringify(previous.data.toJSON()) === json;
    previous.doc.destroy();
    if (same) return;
  }
  db.insert(actorSnapshots)
    .values({ id: generateId(), actorId, layer, state: encodeSnapshot(data), createdAt: now })
    .run();

  const kept = db
    .select({ seq: actorSnapshots.seq })
    .from(actorSnapshots)
    .where(and(eq(actorSnapshots.actorId, actorId), eq(actorSnapshots.layer, layer)))
    .orderBy(desc(actorSnapshots.seq))
    .limit(1)
    .offset(MAX_SNAPSHOTS - 1)
    .get();
  if (kept) {
    db.delete(actorSnapshots)
      .where(
        and(
          eq(actorSnapshots.actorId, actorId),
          eq(actorSnapshots.layer, layer),
          lt(actorSnapshots.seq, kept.seq),
        ),
      )
      .run();
  }
}

/** An actor's snapshots of the given layers, newest first. */
export function listSnapshots(
  db: DbOrTx,
  actorId: string,
  layers: readonly ActorLayer[],
): SnapshotRow[] {
  if (layers.length === 0) return [];
  return db
    .select()
    .from(actorSnapshots)
    .where(and(eq(actorSnapshots.actorId, actorId), inArray(actorSnapshots.layer, [...layers])))
    .orderBy(desc(actorSnapshots.seq))
    .all();
}

export function findSnapshot(db: DbOrTx, actorId: string, id: string): SnapshotRow | undefined {
  return db
    .select()
    .from(actorSnapshots)
    .where(and(eq(actorSnapshots.actorId, actorId), eq(actorSnapshots.id, id)))
    .get();
}
