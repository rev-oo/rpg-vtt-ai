import { and, eq } from 'drizzle-orm';

import type { TableRole } from '@vtt/shared';

import type { DbOrTx } from '../db/client.js';
import { gameTables, members } from '../db/schema.js';

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
  systemVersion: string;
  settings: Record<string, unknown>;
  createdAt: string;
  role: TableRole;
}

export function toTableView(table: GameTable, role: TableRole): TableView {
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    systemId: table.systemId,
    systemVersion: table.systemVersion,
    settings: table.settings,
    createdAt: table.createdAt.toISOString(),
    role,
  };
}
