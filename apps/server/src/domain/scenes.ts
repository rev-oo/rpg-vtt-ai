import { and, asc, count, eq, max, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { canManageScenes, type TableRole } from '@vtt/shared';
import {
  MAX_SCENES,
  snapsToCells,
  type sceneCreateBody,
  type sceneUpdateBody,
  type SceneView,
} from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { scenes, tokens } from '../db/schema.js';
import { conflict, notFound, unprocessable } from '../errors.js';

import { requireTableImage } from './assets.js';
import { generateId } from './auth/tokens.js';

// A table's scenes (FR-MAP-01, ADR-066): rows changed by GMs and assistants. Players and
// spectators see only the active scene.

export type Scene = typeof scenes.$inferSelect;

export function toSceneView(scene: Scene): SceneView {
  return {
    id: scene.id,
    tableId: scene.tableId,
    name: scene.name,
    backgroundUrl: scene.backgroundUrl,
    columns: scene.columns,
    rows: scene.rows,
    gridType: scene.gridType,
    gridSize: scene.gridSize,
    active: scene.active,
    createdAt: scene.createdAt.toISOString(),
    updatedAt: scene.updatedAt.toISOString(),
  };
}

/** The scenes a member sees: all of them in order for GMs and assistants, else the active one. */
export function listScenes(db: DbOrTx, tableId: string, role: TableRole): Scene[] {
  const all = canManageScenes(role);
  return db
    .select()
    .from(scenes)
    .where(and(eq(scenes.tableId, tableId), all ? undefined : eq(scenes.active, true)))
    .orderBy(asc(scenes.sort))
    .all();
}

export function findScene(db: DbOrTx, id: string): Scene | undefined {
  return db.select().from(scenes).where(eq(scenes.id, id)).get();
}

/** A scene the member may see; others are 404, so hidden scenes cannot be probed. */
export function visibleScene(scene: Scene | undefined, role: TableRole): Scene {
  if (!scene || !(scene.active || canManageScenes(role))) throw notFound('Scene not found.');
  return scene;
}

/** Adds a scene at the end of the list, inactive. */
export function createScene(
  db: DbOrTx,
  tableId: string,
  input: z.output<typeof sceneCreateBody>,
  now: Date,
): Scene {
  requireTableImage(db, tableId, input.backgroundUrl);
  return db.transaction((tx) => {
    const held =
      tx.select({ n: count() }).from(scenes).where(eq(scenes.tableId, tableId)).get()?.n ?? 0;
    if (held >= MAX_SCENES) {
      throw conflict('too_many_scenes', `A table holds at most ${String(MAX_SCENES)} scenes.`);
    }
    const last = tx
      .select({ sort: max(scenes.sort) })
      .from(scenes)
      .where(eq(scenes.tableId, tableId))
      .get();
    return tx
      .insert(scenes)
      .values({
        id: generateId(),
        tableId,
        ...input,
        sort: (last?.sort ?? -1) + 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  });
}

/**
 * Changes a scene. A gridless scene given a grid moves its tokens to the nearest cells of
 * the scene, since tokens on a grid stand on whole cells (ADR-068).
 */
export function updateScene(
  db: DbOrTx,
  scene: Scene,
  input: z.output<typeof sceneUpdateBody>,
  now: Date,
): Scene {
  requireTableImage(db, scene.tableId, input.backgroundUrl);
  return db.transaction((tx) => {
    if (!snapsToCells(scene.gridType) && input.gridType && snapsToCells(input.gridType)) {
      // Tokens on the background past the cells move to the nearest cell inside them.
      const last = (cells: number) => cells - 1;
      const columns = last(input.columns ?? scene.columns);
      const rows = last(input.rows ?? scene.rows);
      tx.update(tokens)
        .set({
          column: sql`min(round(${tokens.column}), ${columns})`,
          row: sql`min(round(${tokens.row}), ${rows})`,
          updatedAt: now,
        })
        .where(eq(tokens.sceneId, scene.id))
        .run();
    }
    return tx
      .update(scenes)
      .set({ ...input, updatedAt: now })
      .where(eq(scenes.id, scene.id))
      .returning()
      .get();
  });
}

export function deleteScene(db: DbOrTx, scene: Scene): void {
  db.delete(scenes).where(eq(scenes.id, scene.id)).run();
}

/** Puts the table's scenes in the given order, which must name each of them once. */
export function orderScenes(db: DbOrTx, tableId: string, sceneIds: readonly string[]): void {
  db.transaction((tx) => {
    const ids = tx
      .select({ id: scenes.id })
      .from(scenes)
      .where(eq(scenes.tableId, tableId))
      .all()
      .map((row) => row.id);
    const given = new Set(sceneIds);
    if (
      given.size !== sceneIds.length ||
      ids.length !== given.size ||
      ids.some((id) => !given.has(id))
    ) {
      throw unprocessable(
        'scene_order_mismatch',
        "The order must list each of the table's scenes once.",
      );
    }
    sceneIds.forEach((id, sort) => {
      tx.update(scenes).set({ sort }).where(eq(scenes.id, id)).run();
    });
  });
}

/** Shows a scene to players, or none; the previous one stops being active. */
export function setActiveScene(
  db: DbOrTx,
  tableId: string,
  sceneId: string | null,
  now: Date,
): void {
  db.transaction((tx) => {
    if (sceneId !== null && findScene(tx, sceneId)?.tableId !== tableId) {
      throw notFound('Scene not found.');
    }
    tx.update(scenes)
      .set({ active: false, updatedAt: now })
      .where(and(eq(scenes.tableId, tableId), eq(scenes.active, true)))
      .run();
    if (sceneId !== null) {
      tx.update(scenes).set({ active: true, updatedAt: now }).where(eq(scenes.id, sceneId)).run();
    }
  });
}
