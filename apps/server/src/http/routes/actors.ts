import { z } from 'zod';

import { canCreateActor, canSetOwnership, type Ownership } from '@vtt/shared';
import {
  createActorBody,
  entityListQuery,
  MAX_ENTITY_NAME,
  updateActorBody,
} from '@vtt/shared/api';

import {
  createActor,
  createItem,
  findActor,
  listActors,
  listItems,
  restoreActor,
  softDeleteActor,
  updateActor,
  type Retention,
} from '../../db/repositories/index.js';
import {
  actorAccess,
  actorTypeControl,
  systemTypes,
  toActorView,
  toItemView,
} from '../../domain/entities.js';
import { conflict, forbidden, gone, notFound } from '../../errors.js';
import type { AppContext } from '../app.js';
import { requireActor } from '../entities.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });

/** A player's own actor: hidden from other players, owned by its creator (FR-ENT-02). */
const ownedBy = (userId: string): Ownership => ({ default: 'none', users: { [userId]: 'owner' } });

/** `Copy of X`, kept within the name limit. */
const copyName = (name: string) => `${name} (copy)`.slice(0, MAX_ENTITY_NAME);

/** Actor CRUD, trash and duplication (FR-ENT-01..04). Live sheet data is collab (M5). */
export function actorRoutes({ app, db, config, now }: AppContext): void {
  const retention = (): Retention => ({ now: now(), retentionMs: config.softDeleteRetentionMs });

  app.get('/api/v1/tables/:id/actors', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { membership } = requireMember(db, request, id);
    const query = parseInput(entityListQuery, request.query);
    const subject = { userId: membership.userId, role: membership.role };

    const actors = listActors(db, id, query, retention()).flatMap((actor) => {
      const access = actorAccess(subject, actor);
      // The trash lists what the caller could restore.
      if (!access || (query.trash === 'restorable' && access !== 'owner')) return [];
      return [toActorView(actor, access)];
    });
    return { actors };
  });

  app.post('/api/v1/tables/:id/actors', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { table, membership } = requireMember(db, request, id);
    const body = parseInput(createActorBody, request.body);

    const controlledBy = actorTypeControl(systemTypes(db, table), body.type);
    if (!canCreateActor(membership.role, controlledBy, table.playersMayCreateAnyActorType)) {
      throw forbidden('You cannot create actors of this type.');
    }
    const gmLike = canSetOwnership(membership.role);
    if (body.ownership && !gmLike) throw forbidden('Only the GM can set ownership.');

    const actor = createActor(
      db,
      {
        tableId: id,
        type: body.type,
        name: body.name,
        imageUrl: body.imageUrl,
        ownership: body.ownership ?? (gmLike ? undefined : ownedBy(membership.userId)),
        dataVersion: table.systemVersion,
        createdBy: membership.userId,
      },
      now(),
    );
    return reply.code(201).send({ actor: toActorView(actor, 'owner') });
  });

  app.get('/api/v1/actors/:id', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { actor, access } = requireActor(db, request, id);
    return { actor: toActorView(actor, access) };
  });

  app.patch('/api/v1/actors/:id', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { actor, membership, subject } = requireActor(db, request, id, { edit: true });
    const body = parseInput(updateActorBody, request.body);
    if (body.ownership && !canSetOwnership(membership.role)) {
      throw forbidden('Only the GM can change ownership.');
    }

    const updated = updateActor(db, actor.id, body, now());
    if (!updated) throw notFound('Actor not found.');
    // Only GMs change ownership, and they are implicit owners (FR-ENT-03), so the editor keeps access.
    return { actor: toActorView(updated, actorAccess(subject, updated) ?? 'owner') };
  });

  app.delete('/api/v1/actors/:id', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    requireActor(db, request, id, { edit: true });
    softDeleteActor(db, id, now());
    return reply.code(204).send();
  });

  app.post('/api/v1/actors/:id/restore', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { access } = requireActor(db, request, id, { includeDeleted: true, edit: true });
    const result = restoreActor(db, id, retention());
    if (result === 'not_deleted') throw conflict('not_deleted', 'The actor is not deleted.');
    if (result === 'expired') {
      throw gone('restore_expired', 'The actor was deleted too long ago to restore.');
    }
    const restored = findActor(db, id);
    if (!restored) throw notFound('Actor not found.');
    return { actor: toActorView(restored, access) };
  });

  app.post('/api/v1/actors/:id/duplicate', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { actor, table, membership } = requireActor(db, request, id);
    const controlledBy = actorTypeControl(systemTypes(db, table), actor.type);
    if (!canCreateActor(membership.role, controlledBy, table.playersMayCreateAnyActorType)) {
      throw forbidden('You cannot create actors of this type.');
    }

    const at = now();
    const copy = db.transaction((tx) => {
      const created = createActor(
        tx,
        {
          tableId: actor.tableId,
          type: actor.type,
          name: copyName(actor.name),
          imageUrl: actor.imageUrl,
          // GMs keep the original's ownership; anyone else owns the copy alone.
          ownership: canSetOwnership(membership.role)
            ? actor.ownership
            : ownedBy(membership.userId),
          system: actor.system,
          dataVersion: actor.dataVersion,
          createdBy: membership.userId,
        },
        at,
      );
      for (const item of listItems(tx, actor.tableId, { actorId: actor.id }, retention())) {
        createItem(
          tx,
          {
            tableId: item.tableId,
            actorId: created.id,
            sourceId: item.sourceId,
            type: item.type,
            name: item.name,
            imageUrl: item.imageUrl,
            system: item.system,
            dataVersion: item.dataVersion,
          },
          at,
        );
      }
      return created;
    });
    return reply.code(201).send({ actor: toActorView(copy, 'owner') });
  });

  app.get('/api/v1/actors/:id/items', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { actor, access } = requireActor(db, request, id);
    const query = parseInput(entityListQuery, request.query);
    if (query.trash === 'restorable' && access !== 'owner') return { items: [] };
    const items = listItems(db, actor.tableId, { ...query, actorId: actor.id }, retention());
    return { items: items.map((item) => toItemView(item, access)) };
  });
}
