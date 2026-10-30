import { z } from 'zod';

import { canManageScenes } from '@vtt/shared';
import {
  activeSceneBody,
  sceneCreateBody,
  sceneOrderBody,
  sceneUpdateBody,
  type SceneListResponse,
  type SceneResponse,
} from '@vtt/shared/api';

import { requireUnarchived } from '../../domain/entities.js';
import {
  createScene,
  deleteScene,
  findScene,
  listScenes,
  orderScenes,
  setActiveScene,
  toSceneView,
  updateScene,
  visibleScene,
} from '../../domain/scenes.js';
import { notFound } from '../../errors.js';
import type { AppContext } from '../app.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });

/**
 * A table's scenes (FR-MAP-01, ADR-066). GMs and assistants prepare them and choose the one
 * players see; every member reads what they may see. Each change tells the table with
 * `scene.updated`, and members refetch.
 */
export function sceneRoutes({ app, db, events, now }: AppContext): void {
  const changed = (tableId: string) => {
    events.publish(tableId, { type: 'scene.updated', tableId, payload: {} }, () => true);
  };

  /** A GM's change to a table: checks the role and that the table is not archived. */
  const managing = (request: Parameters<typeof requireMember>[1], tableId: string) => {
    const access = requireMember(db, request, tableId, canManageScenes);
    requireUnarchived(access.table);
    return access;
  };

  /** A scene of a table the caller belongs to; 404 for anything else. */
  const sceneFor = (request: Parameters<typeof requireMember>[1]) => {
    const { id } = parseInput(idParams, request.params);
    const scene = findScene(db, id);
    if (!scene) throw notFound('Scene not found.');
    return { scene, ...requireMember(db, request, scene.tableId) };
  };

  app.get('/api/v1/tables/:id/scenes', (request): SceneListResponse => {
    const { id } = parseInput(idParams, request.params);
    const { membership } = requireMember(db, request, id);
    return { scenes: listScenes(db, id, membership.role).map(toSceneView) };
  });

  app.post('/api/v1/tables/:id/scenes', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    managing(request, id);
    const body = parseInput(sceneCreateBody, request.body);
    const scene = createScene(db, id, body, now());
    changed(id);
    return reply.code(201).send({ scene: toSceneView(scene) } satisfies SceneResponse);
  });

  app.post('/api/v1/tables/:id/scenes/order', (request): SceneListResponse => {
    const { id } = parseInput(idParams, request.params);
    const { membership } = managing(request, id);
    const { sceneIds } = parseInput(sceneOrderBody, request.body);
    orderScenes(db, id, sceneIds);
    changed(id);
    return { scenes: listScenes(db, id, membership.role).map(toSceneView) };
  });

  app.post('/api/v1/tables/:id/scenes/active', (request): SceneListResponse => {
    const { id } = parseInput(idParams, request.params);
    const { membership } = managing(request, id);
    const { sceneId } = parseInput(activeSceneBody, request.body);
    setActiveScene(db, id, sceneId, now());
    changed(id);
    return { scenes: listScenes(db, id, membership.role).map(toSceneView) };
  });

  app.get('/api/v1/scenes/:id', (request): SceneResponse => {
    const { scene, membership } = sceneFor(request);
    return { scene: toSceneView(visibleScene(scene, membership.role)) };
  });

  app.patch('/api/v1/scenes/:id', (request): SceneResponse => {
    const { scene } = sceneFor(request);
    managing(request, scene.tableId);
    const body = parseInput(sceneUpdateBody, request.body);
    const updated = updateScene(db, scene, body, now());
    changed(scene.tableId);
    return { scene: toSceneView(updated) };
  });

  app.delete('/api/v1/scenes/:id', (request, reply) => {
    const { scene } = sceneFor(request);
    managing(request, scene.tableId);
    deleteScene(db, scene);
    changed(scene.tableId);
    return reply.code(204).send();
  });
}
