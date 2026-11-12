import { z } from 'zod';

import { canCopyCompendiumToTable } from '@vtt/shared';
import {
  compendiumCopyBody,
  compendiumQuery,
  type CompendiumCopyResponse,
  type CompendiumEntry,
  type CompendiumEntryResponse,
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

type Listed = ReturnType<typeof compendiumItems>[number];

/** A pack entry as the API shows it, with the data the caller may see. */
const toEntry = (
  { ref, pack, entry }: Listed,
  system: CompendiumEntry['system'],
  inTable: boolean,
): CompendiumEntry => ({
  ref,
  pack,
  kind: entry.kind,
  type: entry.type,
  name: entry.name,
  system,
  inTable,
});
const entryParams = z.object({ id: z.uuid(), ref: z.string().min(1).max(300) });

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
      entries: views.map((item) =>
        toEntry(
          item,
          visible(item.entry.kind, item.entry.type, entryData(plugin, item.entry)),
          inTable.has(item.ref),
        ),
      ),
      nextCursor,
    };
  });

  /** One entry, as the list gives it, for its read-only sheet (T-1620). */
  app.get('/api/v1/tables/:id/compendium/entries/:ref', (request): CompendiumEntryResponse => {
    const { id, ref } = parseInput(entryParams, request.params);
    const { table, membership } = requireMember(db, request, id);
    const plugin = systemOf(table);
    const item = compendiumItems(plugin, nameKey).find((candidate) => candidate.ref === ref);
    if (!item) throw notFound('Compendium entry not found.');
    const packOf = (name: string) => {
      const pack = compendiumPacks(plugin).find((candidate) => candidate.name === name);
      if (!pack) throw notFound('Compendium entry not found.');
      return pack;
    };
    const visible = dataFilter(plugin, membership.role);
    const { entry } = item;
    return {
      entry: toEntry(
        item,
        visible(entry.kind, entry.type, entryData(plugin, entry)),
        refsInTable(db, table.id, [ref]).has(ref),
      ),
      pack: packOf(item.pack),
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
