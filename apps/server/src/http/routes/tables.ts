import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { settingsIssues, type SettingIssue } from '@vtt/plugin-engine';
import { canManageTable } from '@vtt/shared';
import { createTableBody, updateTableBody, type TableTypes } from '@vtt/shared/api';

import { gameTables, members, plugins } from '../../db/schema.js';
import { generateId } from '../../domain/auth/tokens.js';
import { requireWritableSystem, systemTypes } from '../../domain/entities.js';
import { isAvailable } from '../../domain/plugins.js';
import { toTableView } from '../../domain/tables.js';
import { badRequest, unprocessable } from '../../errors.js';
import type { AppContext } from '../app.js';
import { requireSession } from '../auth.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

export const tableIdParams = z.object({ id: z.uuid() });

function settingMessage({ reason }: SettingIssue): string {
  switch (reason) {
    case 'unknown':
      return 'The system has no such setting.';
    case 'type':
      return 'This value does not fit the setting.';
    case 'enum':
      return 'Must be one of the listed options.';
    case 'minimum':
      return 'Too small.';
    case 'maximum':
      return 'Too large.';
    case 'minLength':
    case 'maxLength':
      return 'Wrong length.';
  }
}

/**
 * Table creation, listing and settings (FR-TABLE-01, 02, 07). Settings are the house rules of
 * the table's system (`settings.json`, FR-ADMIN-04) and must fit them.
 */
export function tableRoutes({ app, db, events, plugins: registry }: AppContext): void {
  /** Refuses settings the system does not define or whose values do not fit (specs §8.12). */
  const checkSettings = (systemId: string, settings: Record<string, unknown>) => {
    const issues = settingsIssues(registry.definition(systemId)?.settings ?? {}, settings);
    if (issues.length > 0) {
      throw badRequest(
        'validation_failed',
        'The request is invalid.',
        issues.map((issue) => ({
          path: `settings.${issue.name}`,
          reason: issue.reason,
          message: settingMessage(issue),
        })),
      );
    }
  };

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
    checkSettings(body.systemId, body.settings);

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
    const { table, membership } = requireMember(db, request, id, canManageTable);
    const body = parseInput(updateTableBody, request.body);
    if (body.settings) {
      // House rules need the system that defines them (FR-PLUGIN-07).
      requireWritableSystem(db, table);
      checkSettings(table.systemId, body.settings);
    }
    const updated = db.update(gameTables).set(body).where(eq(gameTables.id, id)).returning().get();
    // Open sheets compute derived values from the settings (§8.12).
    events.publish(id, { type: 'table.updated', tableId: id, payload: {} }, () => true);
    return { table: toTableView(db, updated, membership.role) };
  });
}
