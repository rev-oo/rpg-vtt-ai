import { z } from 'zod';

import { canManageScenes, canSeeToken } from '@vtt/shared';
import {
  tokenCreateBody,
  tokenUpdateBody,
  type TokenListResponse,
  type TokenView,
} from '@vtt/shared/api';

import { requireUnarchived } from '../../domain/entities.js';
import { findScene, visibleScene, type Scene } from '../../domain/scenes.js';
import {
  createToken,
  deleteToken,
  findToken,
  listTokens,
  placedToken,
  toTokenView,
  updateToken,
  type Token,
} from '../../domain/tokens.js';
import { notFound } from '../../errors.js';
import type { AppContext } from '../app.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });

/**
 * Tokens on a scene (FR-MAP-03, ADR-068). Each change sends `token.updated` with the scene,
 * only to the members who could see the token before or after it, so a hidden token's moves
 * never reach players (NFR-08); they refetch what they may see.
 */
export function tokenRoutes({ app, db, events, now }: AppContext): void {
  const changed = (scene: Scene, ...states: Token[]) => {
    events.publish(
      scene.tableId,
      { type: 'token.updated', tableId: scene.tableId, payload: { sceneId: scene.id } },
      (subject) =>
        states.some((token) =>
          canSeeToken(subject.role, { hidden: token.hidden, sceneActive: scene.active }),
        ),
    );
  };

  /** A scene the caller may see, and the caller; 404 for anything else. */
  const sceneFor = (request: Parameters<typeof requireMember>[1], sceneId: string) => {
    const scene = findScene(db, sceneId);
    if (!scene) throw notFound('Scene not found.');
    const access = requireMember(db, request, scene.tableId);
    return { scene: visibleScene(scene, access.membership.role), ...access };
  };

  /** A token the caller may see, with its scene and its actor. */
  const tokenFor = (request: Parameters<typeof requireMember>[1]) => {
    const { id } = parseInput(idParams, request.params);
    const token = findToken(db, id);
    if (!token) throw notFound('Token not found.');
    const { scene, table, membership } = sceneFor(request, token.sceneId);
    const placed = placedToken(db, token, scene, membership);
    return { placed, scene, table, membership };
  };

  app.get('/api/v1/scenes/:id/tokens', (request): TokenListResponse => {
    const { id } = parseInput(idParams, request.params);
    const { scene, membership } = sceneFor(request, id);
    return { tokens: listTokens(db, scene, membership) };
  });

  app.post('/api/v1/scenes/:id/tokens', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { scene, table } = sceneFor(request, id);
    const { membership } = requireMember(db, request, table.id, canManageScenes);
    requireUnarchived(table);
    const body = parseInput(tokenCreateBody, request.body);
    const placed = createToken(db, scene, body, now());
    changed(scene, placed.token);
    const token: TokenView = toTokenView(placed, scene, membership);
    return reply.code(201).send({ token });
  });

  app.patch('/api/v1/tokens/:id', (request): { token: TokenView } => {
    const { placed, scene, table, membership } = tokenFor(request);
    requireUnarchived(table);
    const body = parseInput(tokenUpdateBody, request.body);
    const updated = updateToken(db, placed, scene, membership, body, now());
    changed(scene, placed.token, updated.token);
    return { token: toTokenView(updated, scene, membership) };
  });

  app.delete('/api/v1/tokens/:id', (request, reply) => {
    const { placed, scene, table } = tokenFor(request);
    requireMember(db, request, table.id, canManageScenes);
    requireUnarchived(table);
    deleteToken(db, placed.token);
    changed(scene, placed.token);
    return reply.code(204).send();
  });
}
