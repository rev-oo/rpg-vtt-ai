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

export function toTableView(db: DbOrTx, table: GameTable, role: TableRole): TableView {
  const plugin = db
    .select({ name: plugins.name, enabled: plugins.enabled, status: plugins.status })
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
    settings: table.settings,
    playersMayCreateAnyActorType: table.playersMayCreateAnyActorType,
    systemAvailable: plugin ? isAvailable(plugin) : false,
    createdAt: table.createdAt.toISOString(),
    role,
  };
}
