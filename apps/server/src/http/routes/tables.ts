import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { canManageTable } from '@vtt/shared';

import { gameTables, members, plugins } from '../../db/schema.js';
import { generateId } from '../../domain/auth/tokens.js';
import { toTableView } from '../../domain/tables.js';
import { unprocessable } from '../../errors.js';
import type { AppContext } from '../app.js';
import { requireSession } from '../auth.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

export const tableIdParams = z.object({ id: z.uuid() });

const tableName = z.string().trim().min(1).max(100);
const tableDescription = z.string().trim().max(2000);
const tableSettings = z.record(z.string(), z.unknown());

const createTableBody = z.object({
  name: tableName,
  description: tableDescription.default(''),
  systemId: z.string().min(1).max(100),
  settings: tableSettings.default({}),
});

// Strict: the system plugin and version are fixed at creation (FR-TABLE-02).
const updateTableBody = z
  .strictObject({ name: tableName, description: tableDescription, settings: tableSettings })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field.');

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
      if (!plugin?.enabled) {
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
