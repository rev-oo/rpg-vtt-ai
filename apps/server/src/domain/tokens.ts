import { and, count, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { canMoveToken, canSeeToken, isGmLike, type Subject } from '@vtt/shared';
import {
  MAX_TOKENS_PER_SCENE,
  snapsToCells,
  type tokenCreateBody,
  type tokenUpdateBody,
  type TokenView,
} from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { findActor, type Actor } from '../db/repositories/index.js';
import { actors, tokens } from '../db/schema.js';
import { conflict, forbidden, notFound, unprocessable } from '../errors.js';

import { requireTableImage } from './assets.js';
import { generateId } from './auth/tokens.js';
import type { Scene } from './scenes.js';

// Tokens on a scene (FR-MAP-03, ADR-068). Players see the tokens of the active scene that
// are not hidden, and move the tokens of actors they own; GMs and assistants do everything.

export type Token = typeof tokens.$inferSelect;

/** A token with its actor, if it stands for one. */
interface Placed {
  token: Token;
  actor: Actor | undefined;
}

const facts = ({ token, actor }: Placed, scene: Scene) => ({
  hidden: token.hidden,
  sceneActive: scene.active,
  actorOwnership: actor?.ownership ?? null,
});

export function toTokenView(placed: Placed, scene: Scene, subject: Subject): TokenView {
  const { token, actor } = placed;
  return {
    id: token.id,
    sceneId: token.sceneId,
    actorId: token.actorId,
    name: actor?.name ?? token.name,
    imageUrl: actor ? actor.imageUrl : token.imageUrl,
    column: token.column,
    row: token.row,
    hidden: token.hidden,
    movable: canMoveToken(subject, facts(placed, scene)),
  };
}

/** Whether a member may see a token; hidden ones and those of other scenes stay with the GM. */
export const visibleTo = (subject: Subject, token: Token, scene: Scene): boolean =>
  canSeeToken(subject.role, { hidden: token.hidden, sceneActive: scene.active });

/** The scene's tokens the member may see. Tokens of actors in the trash are left out. */
export function listTokens(db: DbOrTx, scene: Scene, subject: Subject): TokenView[] {
  return db
    .select({ token: tokens, actor: actors })
    .from(tokens)
    .leftJoin(actors, eq(actors.id, tokens.actorId))
    .where(and(eq(tokens.sceneId, scene.id), isNull(actors.softDeletedAt)))
    .all()
    .map(({ token, actor }) => ({ token, actor: actor ?? undefined }))
    .filter(({ token }) => visibleTo(subject, token, scene))
    .map((placed) => toTokenView(placed, scene, subject));
}

export function findToken(db: DbOrTx, id: string): Token | undefined {
  return db.select().from(tokens).where(eq(tokens.id, id)).get();
}

/** The token with its actor; a token the member may not see is 404, as if it did not exist. */
export function placedToken(db: DbOrTx, token: Token, scene: Scene, subject: Subject): Placed {
  if (!visibleTo(subject, token, scene)) throw notFound('Token not found.');
  const actor = token.actorId ? findActor(db, token.actorId) : undefined;
  if (token.actorId && !actor) throw notFound('Token not found.');
  return { token, actor };
}

/**
 * On a whole cell of the scene. A gridless scene's tokens stand anywhere, its background
 * included, which may reach past its cells; the body's limits bound them.
 */
function requireOnScene(scene: Scene, column: number, row: number): void {
  if (!snapsToCells(scene.gridType)) return;
  if (column > scene.columns - 1 || row > scene.rows - 1) {
    throw unprocessable('token_off_scene', 'The token must stand on a cell of the scene.');
  }
  if (!(Number.isInteger(column) && Number.isInteger(row))) {
    throw unprocessable('token_off_grid', 'The token must stand on a whole cell of the grid.');
  }
}

/** Places a token; an actor's token needs a live actor of the same table. */
export function createToken(
  db: DbOrTx,
  scene: Scene,
  input: z.output<typeof tokenCreateBody>,
  now: Date,
): Placed {
  requireOnScene(scene, input.column, input.row);
  const actor = 'actorId' in input ? findActor(db, input.actorId) : undefined;
  if ('actorId' in input && actor?.tableId !== scene.tableId) {
    throw unprocessable('unknown_actor', 'The actor is not one of this table.');
  }
  if ('imageUrl' in input) requireTableImage(db, scene.tableId, input.imageUrl);
  return db.transaction((tx) => {
    const held =
      tx.select({ n: count() }).from(tokens).where(eq(tokens.sceneId, scene.id)).get()?.n ?? 0;
    if (held >= MAX_TOKENS_PER_SCENE) {
      throw conflict(
        'too_many_tokens',
        `A scene holds at most ${String(MAX_TOKENS_PER_SCENE)} tokens.`,
      );
    }
    const token = tx
      .insert(tokens)
      .values({
        id: generateId(),
        sceneId: scene.id,
        actorId: actor?.id ?? null,
        name: 'name' in input ? input.name : '',
        imageUrl: 'imageUrl' in input ? input.imageUrl : null,
        column: input.column,
        row: input.row,
        hidden: input.hidden,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return { token, actor };
  });
}

/**
 * Moves or changes a token. Owners of its actor may only move it; hiding, naming and the
 * image are for GMs and assistants, and an actor's token takes those from its actor.
 */
export function updateToken(
  db: DbOrTx,
  placed: Placed,
  scene: Scene,
  subject: Subject,
  input: z.output<typeof tokenUpdateBody>,
  now: Date,
): Placed {
  const { token, actor } = placed;
  if (!canMoveToken(subject, facts(placed, scene))) {
    throw forbidden('You cannot move this token.');
  }
  const { column, row, ...rest } = input;
  if (Object.keys(rest).length > 0 && !isGmLike(subject.role)) {
    throw forbidden('Only GMs and assistants change a token beyond moving it.');
  }
  if (token.actorId && (rest.name !== undefined || rest.imageUrl !== undefined)) {
    throw unprocessable('token_of_actor', "An actor's token takes its name and image from it.");
  }
  requireOnScene(scene, column ?? token.column, row ?? token.row);
  requireTableImage(db, scene.tableId, rest.imageUrl);
  const updated = db
    .update(tokens)
    .set({ ...input, updatedAt: now })
    .where(eq(tokens.id, token.id))
    .returning()
    .get();
  return { token: updated, actor };
}

export function deleteToken(db: DbOrTx, token: Token): void {
  db.delete(tokens).where(eq(tokens.id, token.id)).run();
}
