import { z } from 'zod';

import { canImportPacks } from '@vtt/shared';
import type { PackImportResponse } from '@vtt/shared/api';

import { requireWritableTable } from '../../domain/entities.js';
import { importPack, listPacks } from '../../domain/packs.js';
import { unprocessable } from '../../errors.js';
import { publishActorChanged, publishItemChanged } from '../../realtime/notify.js';
import type { AppContext } from '../app.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });
const packParams = z.object({ id: z.uuid(), name: z.string().min(1).max(64) });

/**
 * The table's system's compendium packs (FR-PLUGIN-09, ADR-051): GMs and assistants list them
 * and import one into the table's actors and library items.
 */
export function packRoutes({ app, db, events, now, plugins }: AppContext): void {
  const systemOf = (request: Parameters<typeof requireMember>[1], id: string) => {
    const access = requireMember(db, request, id, canImportPacks);
    requireWritableTable(db, access.table);
    const plugin = plugins.definition(access.table.systemId);
    if (!plugin) throw unprocessable('system_unavailable', 'The table’s system is unavailable.');
    return { ...access, plugin };
  };

  app.get('/api/v1/tables/:id/packs', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { table, plugin } = systemOf(request, id);
    return { packs: listPacks(db, table, plugin) };
  });

  app.post('/api/v1/tables/:id/packs/:name/import', (request): PackImportResponse => {
    const { id, name } = parseInput(packParams, request.params);
    const { table, plugin, membership } = systemOf(request, id);
    const created = importPack(db, table, plugin, name, membership.userId, now());
    for (const actor of created.actors) publishActorChanged(events, 'created', actor);
    for (const item of created.items) publishItemChanged(events, 'created', item, undefined);
    return { created: created.actors.length + created.items.length, skipped: created.skipped };
  });
}
