import { and, asc, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { scopedSettingValues } from '@vtt/plugin-engine';
import { canArchiveTable, canManageTable, canUpgradeTableSystem } from '@vtt/shared';
import {
  createTableBody,
  updateTableBody,
  type TableModule,
  type TableTypes,
  type UpgradeSystemResponse,
} from '@vtt/shared/api';

import { findActor } from '../../db/repositories/index.js';
import { gameTables, members, plugins, userPluginSettings } from '../../db/schema.js';
import { generateId } from '../../domain/auth/tokens.js';
import { requireUnarchived, requireWritableTable, systemTypes } from '../../domain/entities.js';
import { countOutdated, migrateTable } from '../../domain/migrations.js';
import { checkSettingValues } from '../../domain/plugin-settings.js';
import { findPlugin, isAvailable } from '../../domain/plugins.js';
import { toTableView } from '../../domain/tables.js';
import { badRequest, conflict, unprocessable } from '../../errors.js';
import { publishActorChanged, publishItemChanged } from '../../realtime/notify.js';
import type { AppContext } from '../app.js';
import { requireSession } from '../auth.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

export const tableIdParams = z.object({ id: z.uuid() });

/**
 * Table creation, listing and settings (FR-TABLE-01, 02, 07). Settings are the house rules of
 * the table's system (`settings.json`, FR-ADMIN-04) and must fit them.
 */
export function tableRoutes(context: AppContext): void {
  const { app, db, events, now, plugins: registry, collab } = context;
  /** Refuses house rules the system does not define or whose values do not fit (§8.12). */
  const checkSettings = (systemId: string, settings: Record<string, unknown>) => {
    checkSettingValues(registry.definition(systemId), 'table', settings, 'settings');
  };

  /** The modules a table may use: enabled and ready ones, each once (ADR-075). */
  const checkModules = (ids: readonly string[]): string[] => {
    const unique = [...new Set(ids)];
    for (const id of unique) {
      const plugin = findPlugin(db, id);
      if (plugin?.kind !== 'module' || !isAvailable(plugin)) {
        throw unprocessable('module_unavailable', `The module "${id}" is not enabled.`);
      }
    }
    return unique;
  };

  app.get('/api/v1/tables', (request) => {
    const session = requireSession(request);
    const rows = db
      .select({ table: gameTables, role: members.role, askRollOptions: members.askRollOptions })
      .from(members)
      .innerJoin(gameTables, eq(gameTables.id, members.tableId))
      .where(eq(members.userId, session.user.id))
      .orderBy(asc(gameTables.name), asc(gameTables.createdAt))
      .all();
    return { tables: rows.map(({ table, ...member }) => toTableView(db, table, member)) };
  });

  app.post('/api/v1/tables', (request, reply) => {
    const session = requireSession(request);
    const body = parseInput(createTableBody, request.body);
    checkSettings(body.systemId, body.settings);

    const table = db.transaction((tx) => {
      const plugin = tx.select().from(plugins).where(eq(plugins.id, body.systemId)).get();
      if (plugin?.kind !== 'system' || !isAvailable(plugin)) {
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

    return reply.code(201).send({ table: toTableView(db, table, { role: 'gm' }) });
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

  /**
   * The table's available modules as its members load them (ADR-075): the validated
   * definition, file URLs and every setting's value for the viewer.
   */
  app.get('/api/v1/tables/:id/modules', (request) => {
    const { id } = parseInput(tableIdParams, request.params);
    const { table, membership } = requireMember(db, request, id);
    const modules = table.modules.flatMap((moduleId): TableModule[] => {
      const plugin = findPlugin(db, moduleId);
      const definition =
        plugin?.kind === 'module' && isAvailable(plugin)
          ? registry.definition(moduleId)
          : undefined;
      if (!plugin || !definition) return [];
      const user = db
        .select({ values: userPluginSettings.values })
        .from(userPluginSettings)
        .where(
          and(
            eq(userPluginSettings.userId, membership.userId),
            eq(userPluginSettings.pluginId, moduleId),
          ),
        )
        .get();
      const base = `/plugins/${encodeURIComponent(moduleId)}/`;
      return [
        {
          id: moduleId,
          name: plugin.name,
          version: plugin.version,
          definition: { ...definition, packs: undefined, migrations: undefined },
          // The theme first, so the module's own stylesheets can build on its tokens.
          styles: [
            ...(definition.theme ? [`${base}theme.css`] : []),
            ...definition.styles.map((file) => base + file),
          ],
          client: plugin.codeEntries.includes('code/client.js') ? `${base}code/client.js` : null,
          settings: scopedSettingValues(definition.settings, {
            instance: plugin.settings,
            table: table.moduleSettings[moduleId],
            user: user?.values,
          }),
        },
      ];
    });
    return { modules };
  });

  app.get('/api/v1/tables/:id', (request) => {
    const { id } = parseInput(tableIdParams, request.params);
    const { table, membership } = requireMember(db, request, id);
    const outdated = canUpgradeTableSystem(membership.role)
      ? countOutdated(db, table, (systemId) => registry.definition(systemId))
      : 0;
    return { table: toTableView(db, table, membership, outdated) };
  });

  app.patch('/api/v1/tables/:id', (request) => {
    const { id } = parseInput(tableIdParams, request.params);
    const { table, membership } = requireMember(db, request, id, canManageTable);
    const body = parseInput(updateTableBody, request.body);
    requireUnarchived(table);
    if (body.settings) {
      // House rules need the system that defines them (FR-PLUGIN-07).
      requireWritableTable(db, table);
      checkSettings(table.systemId, body.settings);
    }
    const modules = body.modules ? checkModules(body.modules) : table.modules;
    // Settings of modules the table no longer uses are dropped.
    const moduleSettings = Object.fromEntries(
      Object.entries(body.moduleSettings ?? table.moduleSettings).filter(([module]) =>
        modules.includes(module),
      ),
    );
    for (const [module, values] of Object.entries(body.moduleSettings ?? {})) {
      if (!modules.includes(module)) {
        throw badRequest('validation_failed', 'The request is invalid.', [
          {
            path: `moduleSettings.${module}`,
            reason: 'unknown',
            message: 'The table does not use this module.',
          },
        ]);
      }
      checkSettingValues(registry.definition(module), 'table', values, `moduleSettings.${module}`);
    }
    const updated = db
      .update(gameTables)
      .set({ ...body, modules, moduleSettings })
      .where(eq(gameTables.id, id))
      .returning()
      .get();
    // Open sheets compute derived values from the settings (§8.12).
    events.publish(id, { type: 'table.updated', tableId: id, payload: {} }, () => true);
    return { table: toTableView(db, updated, membership) };
  });

  /**
   * Archives or unarchives the table (FR-TABLE-06, ADR-054). Open documents turn read-only, or
   * writable again, on the recheck after the request; clients refetch on `table.updated`.
   */
  const setArchived = (archived: boolean) => (request: FastifyRequest) => {
    const { id } = parseInput(tableIdParams, request.params);
    const { table, membership } = requireMember(db, request, id, canArchiveTable);
    const archivedAt = archived ? (table.archivedAt ?? now()) : null;
    const updated = db
      .update(gameTables)
      .set({ archivedAt })
      .where(eq(gameTables.id, id))
      .returning()
      .get();
    events.publish(id, { type: 'table.updated', tableId: id, payload: {} }, () => true);
    return { table: toTableView(db, updated, membership) };
  };
  app.post('/api/v1/tables/:id/archive', setArchived(true));
  app.post('/api/v1/tables/:id/unarchive', setArchived(false));

  /**
   * Moves the table to its system's installed version (§9.7, ADR-058). Existing entities keep
   * the version they were made with, and their sheets say so; new ones get the new version.
   */
  app.post('/api/v1/tables/:id/upgrade-system', async (request) => {
    const { id } = parseInput(tableIdParams, request.params);
    const { table, membership } = requireMember(db, request, id, canUpgradeTableSystem);
    requireWritableTable(db, table);
    const plugin = db
      .select({ version: plugins.version })
      .from(plugins)
      .where(eq(plugins.id, table.systemId))
      .get();
    if (!plugin) throw conflict('table_read_only', "The table's system is not installed.");
    const updated = db
      .update(gameTables)
      .set({ systemVersion: plugin.version })
      .where(eq(gameTables.id, id))
      .returning()
      .get();
    // The data follows: each actor and item behind the new version is migrated (ADR-072).
    const definition = (systemId: string) => registry.definition(systemId);
    const migration = await migrateTable(db, updated, plugin.version, {
      definition,
      code: (systemId) => registry.code(systemId),
      live: (name) => collab.hocuspocus.documents.get(name),
      changed: (entity) => {
        // Nobody sees entities in the trash change.
        if (entity.row.softDeletedAt) return;
        if (entity.kind === 'actor') {
          publishActorChanged(events, 'updated', entity.row);
          return;
        }
        const owner = entity.row.actorId ? findActor(db, entity.row.actorId) : undefined;
        publishItemChanged(events, 'updated', entity.row, owner);
      },
      now,
      logger: request.log,
    });
    events.publish(id, { type: 'table.updated', tableId: id, payload: {} }, () => true);
    const outdated = countOutdated(db, updated, definition);
    const response: UpgradeSystemResponse = {
      table: toTableView(db, updated, membership, outdated),
      migration,
    };
    return response;
  });
}
