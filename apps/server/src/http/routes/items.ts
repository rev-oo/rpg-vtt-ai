import { z } from 'zod';

import { canManageItemLibrary } from '@vtt/shared';
import { copyItemBody, createItemBody, entityListQuery, updateItemBody } from '@vtt/shared/api';

import {
  createItem,
  findItem,
  listItems,
  restoreItem,
  softDeleteItem,
  updateItem,
  type Retention,
} from '../../db/repositories/index.js';
import {
  dataFilter,
  requireItemType,
  requireRoomForItems,
  toItemView,
  writableSystemTypes,
} from '../../domain/entities.js';
import type { GameTable, Member } from '../../domain/tables.js';
import { conflict, gone, notFound, unprocessable } from '../../errors.js';
import { publishItemChanged } from '../../realtime/notify.js';
import type { AppContext } from '../app.js';
import { requireActor, requireItem } from '../entities.js';
import { requireMember } from '../membership.js';
import { listPage, nameKey } from '../pages.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });

/** The table's item library and owned items (FR-ENT-05, 06). Live item data is collab (M5). */
export function itemRoutes({ app, db, config, events, now, plugins }: AppContext): void {
  const retention = (): Retention => ({ now: now(), retentionMs: config.softDeleteRetentionMs });
  const visibleTo = (table: GameTable, membership: Member) =>
    dataFilter(plugins.definition(table.systemId), membership.role);

  app.get('/api/v1/tables/:id/items', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { table, membership } = requireMember(db, request, id);
    const query = parseInput(entityListQuery, request.query);
    const access = canManageItemLibrary(membership.role) ? 'owner' : 'observer';
    // The trash lists what the caller could restore.
    if (query.trash === 'restorable' && access !== 'owner') return { items: [], nextCursor: null };
    const visible = visibleTo(table, membership);
    const { views, nextCursor } = listPage(
      {
        fetch: (window) => listItems(db, id, { ...query, actorId: null }, retention(), window),
        keyOf: (item) => nameKey(item.name, item.id),
        view: (item) => toItemView(item, access, visible),
      },
      query,
    );
    return { items: views, nextCursor };
  });

  app.post('/api/v1/tables/:id/items', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { table, membership } = requireMember(db, request, id, canManageItemLibrary);
    const body = parseInput(createItemBody, request.body);
    requireItemType(writableSystemTypes(db, table), body.type);

    const item = createItem(db, { tableId: id, ...body, dataVersion: table.systemVersion }, now());
    publishItemChanged(events, 'created', item, undefined);
    return reply.code(201).send({ item: toItemView(item, 'owner', visibleTo(table, membership)) });
  });

  /** Copies a library item into an actor, keeping a link to its source (FR-ENT-05). */
  app.post('/api/v1/actors/:id/items', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { actor, table, membership } = requireActor(db, request, id, { edit: true });
    const { itemId } = parseInput(copyItemBody, request.body);
    const source = findItem(db, itemId);
    if (source?.tableId !== actor.tableId) throw notFound('Item not found.');
    if (source.actorId !== null) {
      throw unprocessable('not_library_item', 'Only items from the library can be copied.');
    }
    requireRoomForItems(db, actor.id, 1);

    const copy = createItem(
      db,
      {
        tableId: actor.tableId,
        actorId: actor.id,
        sourceId: source.id,
        type: source.type,
        name: source.name,
        imageUrl: source.imageUrl,
        system: source.system,
        dataVersion: source.dataVersion,
      },
      now(),
    );
    publishItemChanged(events, 'created', copy, actor);
    return reply.code(201).send({ item: toItemView(copy, 'owner', visibleTo(table, membership)) });
  });

  app.get('/api/v1/items/:id', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { item, access, table, membership } = requireItem(db, request, id);
    return { item: toItemView(item, access, visibleTo(table, membership)) };
  });

  app.patch('/api/v1/items/:id', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { access, actor, table, membership } = requireItem(db, request, id, { edit: true });
    const body = parseInput(updateItemBody, request.body);
    const updated = updateItem(db, id, body, now());
    if (!updated) throw notFound('Item not found.');
    publishItemChanged(events, 'updated', updated, actor);
    return { item: toItemView(updated, access, visibleTo(table, membership)) };
  });

  app.delete('/api/v1/items/:id', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { item, actor } = requireItem(db, request, id, { edit: true });
    softDeleteItem(db, id, now());
    publishItemChanged(events, 'deleted', item, actor);
    return reply.code(204).send();
  });

  app.post('/api/v1/items/:id/restore', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { item, access, actor, table, membership } = requireItem(db, request, id, {
      includeDeleted: true,
      edit: true,
    });
    if (actor && item.softDeletedAt) requireRoomForItems(db, actor.id, 1);
    const result = restoreItem(db, id, retention());
    if (result === 'not_deleted') throw conflict('not_deleted', 'The item is not deleted.');
    if (result === 'expired') {
      throw gone('restore_expired', 'The item was deleted too long ago to restore.');
    }
    const restored = findItem(db, id);
    if (!restored) throw notFound('Item not found.');
    publishItemChanged(events, 'restored', restored, actor);
    return { item: toItemView(restored, access, visibleTo(table, membership)) };
  });
}
