import { and, eq } from 'drizzle-orm';

import type { TableRole } from '@vtt/shared';
import type { TableView } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { gameTables, members, plugins } from '../db/schema.js';

import { isAvailable } from './plugins.js';

export type GameTable = typeof gameTables.$inferSelect;
export type Member = typeof members.$inferSelect;

export function findMembership(db: DbOrTx, tableId: string, userId: string): Member | undefined {
  return db
    .select()
    .from(members)
    .where(and(eq(members.tableId, tableId), eq(members.userId, userId)))
    .get();
}

export function findTable(db: DbOrTx, tableId: string): GameTable | undefined {
  return db.select().from(gameTables).where(eq(gameTables.id, tableId)).get();
}

export function toTableView(
  db: DbOrTx,
  table: GameTable,
  role: TableRole,
  /** Entities an upgrade would migrate (ADR-072), when the caller counted them. */
  outdatedEntities = 0,
): TableView {
  const plugin = db
    .select({
      name: plugins.name,
      version: plugins.version,
      enabled: plugins.enabled,
      status: plugins.status,
    })
    .from(plugins)
    .where(eq(plugins.id, table.systemId))
    .get();
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    systemId: table.systemId,
    systemName: plugin?.name ?? table.systemId,
    systemVersion: table.systemVersion,
    installedVersion: plugin?.version ?? null,
    outdatedEntities,
    settings: table.settings,
    modules: table.modules,
    moduleSettings: table.moduleSettings,
    playersMayCreateAnyActorType: table.playersMayCreateAnyActorType,
    systemAvailable: plugin ? isAvailable(plugin) : false,
    createdAt: table.createdAt.toISOString(),
    archivedAt: table.archivedAt?.toISOString() ?? null,
    role,
  };
}
