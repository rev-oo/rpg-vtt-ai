import { z } from 'zod';

import { imageUrlSchema } from './assets.js';
import { MAX_ENTITY_NAME } from './constants.js';

// Scenes (FR-MAP-01, ADR-066): a table's maps, prepared by GMs and assistants, one of them
// shown to players.

/** A scene's grid: square cells, or hexagons. */
export const GRID_TYPES = ['square', 'hex'] as const;
export type GridType = (typeof GRID_TYPES)[number];

export const MAX_SCENES = 100;
/** A scene's size in grid cells, each side. */
export const MIN_SCENE_CELLS = 1;
export const MAX_SCENE_CELLS = 200;
/** A grid cell's size in pixels, as the background image is drawn. */
export const MIN_GRID_SIZE = 16;
export const MAX_GRID_SIZE = 400;

export const sceneSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  name: z.string(),
  /** An image URL; uploaded images are assets of the same table (ADR-065). */
  backgroundUrl: z.string().nullable(),
  /** The size in grid cells. */
  columns: z.number().int(),
  rows: z.number().int(),
  gridType: z.enum(GRID_TYPES),
  /** A cell's size in pixels of the background. */
  gridSize: z.number().int(),
  /** The scene players see; a table has at most one. */
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SceneView = z.infer<typeof sceneSchema>;

const cells = z.number().int().min(MIN_SCENE_CELLS).max(MAX_SCENE_CELLS);
const sceneFields = {
  name: z.string().trim().min(1).max(MAX_ENTITY_NAME),
  backgroundUrl: imageUrlSchema.nullable(),
  columns: cells,
  rows: cells,
  gridType: z.enum(GRID_TYPES),
  gridSize: z.number().int().min(MIN_GRID_SIZE).max(MAX_GRID_SIZE),
};

/** `POST /tables/:id/scenes`; a new scene goes last and is not active. */
export const sceneCreateBody = z.object({
  name: sceneFields.name,
  backgroundUrl: sceneFields.backgroundUrl.default(null),
  columns: sceneFields.columns.default(30),
  rows: sceneFields.rows.default(20),
  gridType: sceneFields.gridType.default('square'),
  gridSize: sceneFields.gridSize.default(70),
});
export type SceneCreateInput = z.input<typeof sceneCreateBody>;

/** `PATCH /scenes/:id`. */
export const sceneUpdateBody = z.object(sceneFields).partial();
export type SceneUpdateInput = z.input<typeof sceneUpdateBody>;

/** `POST /tables/:id/scenes/order`: every scene of the table, in the new order. */
export const sceneOrderBody = z.object({
  sceneIds: z.array(z.uuid()).min(1).max(MAX_SCENES),
});

/** `POST /tables/:id/scenes/active`: the scene players see, or none. */
export const activeSceneBody = z.object({ sceneId: z.uuid().nullable() });

export const sceneResponseSchema = z.object({ scene: sceneSchema });
export type SceneResponse = z.infer<typeof sceneResponseSchema>;
/** GMs and assistants get every scene in order; others only the active one, if any. */
export const sceneListResponseSchema = z.object({ scenes: z.array(sceneSchema) });
export type SceneListResponse = z.infer<typeof sceneListResponseSchema>;
