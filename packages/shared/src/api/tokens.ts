import { z } from 'zod';

import { imageUrlSchema } from './assets.js';
import { MAX_ENTITY_NAME } from './constants.js';
import { MAX_SCENE_CELLS } from './scenes.js';

// Tokens (FR-MAP-03, ADR-068): pieces on a scene's grid, each an actor's or standing alone.

export const MAX_TOKENS_PER_SCENE = 500;

const cell = z
  .number()
  .int()
  .min(0)
  .max(MAX_SCENE_CELLS - 1);

export const tokenSchema = z.object({
  id: z.string(),
  sceneId: z.string(),
  /** The actor it stands for, whose name and image it shows; `null` when it stands alone. */
  actorId: z.string().nullable(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  /** The grid cell it stands on. */
  column: z.number().int(),
  row: z.number().int(),
  /** Only GMs and assistants see hidden tokens. */
  hidden: z.boolean(),
  /** Whether the caller may move it. */
  movable: z.boolean(),
});
export type TokenView = z.infer<typeof tokenSchema>;

/** `POST /scenes/:id/tokens`: an actor's token, or a named one standing alone. */
export const tokenCreateBody = z.union([
  z.object({
    actorId: z.uuid(),
    column: cell,
    row: cell,
    hidden: z.boolean().default(false),
  }),
  z.object({
    name: z.string().trim().min(1).max(MAX_ENTITY_NAME),
    imageUrl: imageUrlSchema.nullable().default(null),
    column: cell,
    row: cell,
    hidden: z.boolean().default(false),
  }),
]);
export type TokenCreateInput = z.input<typeof tokenCreateBody>;

/** `PATCH /tokens/:id`: owners move; everything else is for GMs and assistants. */
export const tokenUpdateBody = z
  .object({
    column: cell,
    row: cell,
    hidden: z.boolean(),
    name: z.string().trim().min(1).max(MAX_ENTITY_NAME),
    imageUrl: imageUrlSchema.nullable(),
  })
  .partial();
export type TokenUpdateInput = z.input<typeof tokenUpdateBody>;

export const tokenResponseSchema = z.object({ token: tokenSchema });
export const tokenListResponseSchema = z.object({ tokens: z.array(tokenSchema) });
export type TokenListResponse = z.infer<typeof tokenListResponseSchema>;
