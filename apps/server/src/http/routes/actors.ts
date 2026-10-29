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
import { requireTableImage } from '../../domain/assets.js';
import {
  actorAccess,
  actorTypeControl,
  dataFilter,
  toActorView,
  toItemView,
  writableSystemTypes,
} from '../../domain/entities.js';
import type { GameTable, Member } from '../../domain/tables.js';
import { conflict, forbidden, gone, notFound } from '../../errors.js';
import { publishActorChanged } from '../../realtime/notify.js';
import type { AppContext } from '../app.js';
import { requireActor } from '../entities.js';
import { requireMember } from '../membership.js';
import { listPage, nameKey } from '../pages.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });

/** A player's own actor: hidden from other players, owned by its creator (FR-ENT-02). */
const ownedBy = (userId: string): Ownership => ({ default: 'none', users: { [userId]: 'owner' } });

/** `Copy of X`, kept within the name limit. */
const copyName = (name: string) => `${name} (copy)`.slice(0, MAX_ENTITY_NAME);

/** Actor CRUD, trash and duplication (FR-ENT-01..04). Live sheet data is collab (M5). */
export function actorRoutes({ app, db, config, events, now, plugins }: AppContext): void {
  const retention = (): Retention => ({ now: now(), retentionMs: config.softDeleteRetentionMs });
  const visibleTo = (table: GameTable, membership: Member) =>
    dataFilter(plugins.definition(table.systemId), membership.role);

  app.get('/api/v1/tables/:id/actors', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { table, membership } = requireMember(db, request, id);
    const query = parseInput(entityListQuery, request.query);
    const subject = { userId: membership.userId, role: membership.role };
    const visible = visibleTo(table, membership);

    const { views, nextCursor } = listPage(
      {
        fetch: (window) => listActors(db, id, query, retention(), window),
        keyOf: (actor) => nameKey(actor.name, actor.id),
        view: (actor) => {
          const access = actorAccess(subject, actor);
          // The trash lists what the caller could restore.
          if (!access || (query.trash === 'restorable' && access !== 'owner')) return undefined;
          return toActorView(actor, access, visible);
        },
      },
      query,
    );
    return { actors: views, nextCursor };
  });

  app.post('/api/v1/tables/:id/actors', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { table, membership } = requireMember(db, request, id);
    const body = parseInput(createActorBody, request.body);

    const controlledBy = actorTypeControl(writableSystemTypes(db, table), body.type);
    if (!canCreateActor(membership.role, controlledBy, table.playersMayCreateAnyActorType)) {
      throw forbidden('You cannot create actors of this type.');
    }
    const gmLike = canSetOwnership(membership.role);
    if (body.ownership && !gmLike) throw forbidden('Only the GM can set ownership.');
    requireTableImage(db, id, body.imageUrl);

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
    publishActorChanged(events, 'created', actor);
    return reply
      .code(201)
      .send({ actor: toActorView(actor, 'owner', visibleTo(table, membership)) });
  });

  app.get('/api/v1/actors/:id', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { actor, access, table, membership } = requireActor(db, request, id);
    return { actor: toActorView(actor, access, visibleTo(table, membership)) };
  });

  app.patch('/api/v1/actors/:id', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { actor, table, membership, subject } = requireActor(db, request, id, { edit: true });
    const body = parseInput(updateActorBody, request.body);
    if (body.ownership && !canSetOwnership(membership.role)) {
      throw forbidden('Only the GM can change ownership.');
    }
    requireTableImage(db, actor.tableId, body.imageUrl);

    const updated = updateActor(db, actor.id, body, now());
    if (!updated) throw notFound('Actor not found.');
    publishActorChanged(events, 'updated', updated, actor.ownership);
    // Only GMs change ownership, and they are implicit owners (FR-ENT-03), so the editor keeps access.
    return {
      actor: toActorView(
        updated,
        actorAccess(subject, updated) ?? 'owner',
        visibleTo(table, membership),
      ),
    };
  });

  app.delete('/api/v1/actors/:id', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { actor } = requireActor(db, request, id, { edit: true });
    softDeleteActor(db, id, now());
    publishActorChanged(events, 'deleted', actor);
    return reply.code(204).send();
  });

  app.post('/api/v1/actors/:id/restore', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { access, table, membership } = requireActor(db, request, id, {
      includeDeleted: true,
      edit: true,
    });
    const result = restoreActor(db, id, retention());
    if (result === 'not_deleted') throw conflict('not_deleted', 'The actor is not deleted.');
    if (result === 'expired') {
      throw gone('restore_expired', 'The actor was deleted too long ago to restore.');
    }
    const restored = findActor(db, id);
    if (!restored) throw notFound('Actor not found.');
    publishActorChanged(events, 'restored', restored);
    return { actor: toActorView(restored, access, visibleTo(table, membership)) };
  });

  app.post('/api/v1/actors/:id/duplicate', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { actor, table, membership } = requireActor(db, request, id);
    const controlledBy = actorTypeControl(writableSystemTypes(db, table), actor.type);
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
    publishActorChanged(events, 'created', copy);
    return reply
      .code(201)
      .send({ actor: toActorView(copy, 'owner', visibleTo(table, membership)) });
  });

  app.get('/api/v1/actors/:id/items', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { actor, access, table, membership } = requireActor(db, request, id);
    const query = parseInput(entityListQuery, request.query);
    if (query.trash === 'restorable' && access !== 'owner') return { items: [], nextCursor: null };
    const visible = visibleTo(table, membership);
    const { views, nextCursor } = listPage(
      {
        fetch: (window) =>
          listItems(db, actor.tableId, { ...query, actorId: actor.id }, retention(), window),
        keyOf: (item) => nameKey(item.name, item.id),
        view: (item) => toItemView(item, access, visible),
      },
      query,
    );
    return { items: views, nextCursor };
  });
}
