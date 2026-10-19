import { and, eq } from 'drizzle-orm';

import type { TableRole } from '@vtt/shared';

import type { DbOrTx } from '../db/client.js';
import { gameTables, members, plugins } from '../db/schema.js';

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

/** The table fields members may see, plus the caller's own role. */
export interface TableView {
  id: string;
  name: string;
  description: string;
  systemId: string;
  /** The plugin's display name, or its id if the plugin is no longer installed. */
  systemName: string;
  systemVersion: string;
  settings: Record<string, unknown>;
  createdAt: string;
  role: TableRole;
}

export function toTableView(db: DbOrTx, table: GameTable, role: TableRole): TableView {
  const plugin = db
    .select({ name: plugins.name })
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
    createdAt: table.createdAt.toISOString(),
    role,
  };
}
