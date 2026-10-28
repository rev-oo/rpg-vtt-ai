import { z } from 'zod';

import { canCopyCompendiumToTable } from '@vtt/shared';
import {
  compendiumCopyBody,
  compendiumQuery,
  type CompendiumCopyResponse,
  type CompendiumPage,
} from '@vtt/shared/api';

import {
  compendiumItems,
  compendiumPacks,
  copyFromCompendium,
  entryData,
  filterCompendium,
  refsInTable,
  type CopyTarget,
} from '../../domain/compendium.js';
import {
  dataFilter,
  requireWritableTable,
  toActorView,
  toItemView,
} from '../../domain/entities.js';
import { forbidden, notFound, unprocessable } from '../../errors.js';
import { publishActorChanged, publishItemChanged } from '../../realtime/notify.js';
import type { AppContext } from '../app.js';
import { requireActor } from '../entities.js';
import { requireMember } from '../membership.js';
import { listPage, nameKey } from '../pages.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });

/**
 * The compendium browser (FR-PLUGIN-09, ADR-060): every member browses the system's pack
 * entries; GMs and assistants copy them into the table, and owners copy items onto actors.
 */
export function compendiumRoutes({ app, db, events, now, plugins }: AppContext): void {
  const systemOf = (table: { systemId: string }) => {
    const plugin = plugins.definition(table.systemId);
    if (!plugin) throw unprocessable('system_unavailable', 'The table’s system is unavailable.');
    return plugin;
  };

  app.get('/api/v1/tables/:id/compendium', (request): CompendiumPage => {
    const { id } = parseInput(idParams, request.params);
    const { table, membership } = requireMember(db, request, id);
    const query = parseInput(compendiumQuery, request.query);
    const plugin = systemOf(table);
    const all = compendiumItems(plugin, nameKey);
    const visible = dataFilter(plugin, membership.role);
    const { views, nextCursor } = listPage(
      {
        fetch: (window) => filterCompendium(all, query, nameKey, window),
        keyOf: ({ entry, ref }) => nameKey(entry.name, ref),
        view: (item) => item,
      },
      query,
    );
    const inTable = refsInTable(
      db,
      table.id,
      views.map(({ ref }) => ref),
    );
    return {
      packs: compendiumPacks(plugin),
      entries: views.map(({ ref, pack, entry }) => ({
        ref,
        pack,
        kind: entry.kind,
        type: entry.type,
        name: entry.name,
        system: visible(entry.kind, entry.type, entryData(plugin, entry)),
        inTable: inTable.has(ref),
      })),
      nextCursor,
    };
  });

  app.post('/api/v1/tables/:id/compendium/copy', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { table, membership } = requireMember(db, request, id);
    const body = parseInput(compendiumCopyBody, request.body);
    requireWritableTable(db, table);
    const plugin = systemOf(table);

    let target: CopyTarget;
    if (body.actorId === undefined) {
      if (!canCopyCompendiumToTable(membership.role)) throw forbidden();
      target = { kind: 'table', createdBy: membership.userId };
    } else {
      const { actor } = requireActor(db, request, body.actorId, { edit: true });
      if (actor.tableId !== table.id) throw notFound('Actor not found.');
      target = { kind: 'actor', actor };
    }

    const created = copyFromCompendium(db, table, plugin, body.refs, target, now());
    const owner = target.kind === 'actor' ? target.actor : undefined;
    for (const actor of created.actors) publishActorChanged(events, 'created', actor);
    for (const item of created.items) publishItemChanged(events, 'created', item, owner);
    const visible = dataFilter(plugin, membership.role);
    const response: CompendiumCopyResponse = {
      actors: created.actors.map((actor) => toActorView(actor, 'owner', visible)),
      items: created.items.map((item) => toItemView(item, 'owner', visible)),
    };
    return reply.code(201).send(response);
  });
}
