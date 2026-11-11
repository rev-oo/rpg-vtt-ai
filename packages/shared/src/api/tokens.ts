import { z } from 'zod';

import { imageUrlSchema } from './assets.js';
import { MAX_ENTITY_NAME } from './constants.js';
import { MAX_SCENE_CELLS } from './scenes.js';

// Tokens (FR-MAP-03, ADR-068): pieces on a scene's grid, each an actor's or standing alone.

export const MAX_TOKENS_PER_SCENE = 500;

/** In cells; a fraction of one only on a gridless scene, which the server checks. */
const cell = z
  .number()
  .min(0)
  .max(MAX_SCENE_CELLS - 1);

/**
 * A status of a token's actor that is on (T-1618), such as a condition: one of the true/false
 * fields its type lists as statuses. A secret field's reaches only GMs and assistants.
 */
export const tokenStatusSchema = z.object({
  /** The field, such as `conditions.prone`. */
  field: z.string(),
  /** A lang key of the table's system, or text. */
  label: z.string(),
  /** The icon's URL: a file of the table's system. */
  icon: z.string(),
});
export type TokenStatus = z.infer<typeof tokenStatusSchema>;

export const tokenSchema = z.object({
  id: z.string(),
  sceneId: z.string(),
  /** The actor it stands for, whose name and image it shows; `null` when it stands alone. */
  actorId: z.string().nullable(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  /**
   * The cell it stands on. On a gridless scene it stands anywhere, so these are fractions of
   * cells: its centre is half a cell right of and below this point.
   */
  column: z.number(),
  row: z.number(),
  /** Only GMs and assistants see hidden tokens. */
  hidden: z.boolean(),
  /** Whether the caller may move it. */
  movable: z.boolean(),
  /** Its actor's statuses that are on, in the order its type lists them (T-1618). */
  statuses: z.array(tokenStatusSchema),
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
