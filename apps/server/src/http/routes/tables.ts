import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { canManageTable } from '@vtt/shared';
import { createTableBody, updateTableBody, type TableTypes } from '@vtt/shared/api';

import { gameTables, members, plugins } from '../../db/schema.js';
import { generateId } from '../../domain/auth/tokens.js';
import { systemTypes } from '../../domain/entities.js';
import { isAvailable } from '../../domain/plugins.js';
import { toTableView } from '../../domain/tables.js';
import { unprocessable } from '../../errors.js';
import type { AppContext } from '../app.js';
import { requireSession } from '../auth.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

export const tableIdParams = z.object({ id: z.uuid() });

/** Table creation, listing and settings (FR-TABLE-01, 02, 07). */
export function tableRoutes({ app, db }: AppContext): void {
  app.get('/api/v1/tables', (request) => {
    const session = requireSession(request);
    const rows = db
      .select({ table: gameTables, role: members.role })
      .from(members)
      .innerJoin(gameTables, eq(gameTables.id, members.tableId))
      .where(eq(members.userId, session.user.id))
      .orderBy(asc(gameTables.name), asc(gameTables.createdAt))
      .all();
    return { tables: rows.map(({ table, role }) => toTableView(db, table, role)) };
  });

  app.post('/api/v1/tables', (request, reply) => {
    const session = requireSession(request);
    const body = parseInput(createTableBody, request.body);

    const table = db.transaction((tx) => {
      const plugin = tx.select().from(plugins).where(eq(plugins.id, body.systemId)).get();
      if (!plugin || !isAvailable(plugin)) {
        throw unprocessable(
          'system_unavailable',
          'The selected system plugin is not installed or not enabled.',
        );
      }
      const created = tx
        .insert(gameTables)
        .values({
          id: generateId(),
          name: body.name,
          description: body.description,
          systemId: plugin.id,
          systemVersion: plugin.version,
          settings: body.settings,
          createdBy: session.user.id,
        })
        .returning()
        .get();
      // The creator is the table's GM (FR-TABLE-01).
      tx.insert(members).values({ tableId: created.id, userId: session.user.id, role: 'gm' }).run();
      return created;
    });

    return reply.code(201).send({ table: toTableView(db, table, 'gm') });
  });

  app.get('/api/v1/tables/:id/types', (request) => {
    const { id } = parseInput(tableIdParams, request.params);
    const { table } = requireMember(db, request, id);
    const types = systemTypes(db, table);
    const result: TableTypes = {
      actorTypes: Object.entries(types.actorTypes).map(([type, { controlledBy }]) => ({
        type,
        controlledBy,
      })),
      itemTypes: [...types.itemTypes],
    };
    return result;
  });

  app.get('/api/v1/tables/:id', (request) => {
    const { id } = parseInput(tableIdParams, request.params);
    const { table, membership } = requireMember(db, request, id);
    return { table: toTableView(db, table, membership.role) };
  });

  app.patch('/api/v1/tables/:id', (request) => {
    const { id } = parseInput(tableIdParams, request.params);
    const { membership } = requireMember(db, request, id, canManageTable);
    const body = parseInput(updateTableBody, request.body);
    const updated = db.update(gameTables).set(body).where(eq(gameTables.id, id)).returning().get();
    return { table: toTableView(db, updated, membership.role) };
  });
}
