import { asc, eq } from 'drizzle-orm';

import type { AdminPlugin } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { plugins } from '../db/schema.js';

export type PluginRow = typeof plugins.$inferSelect;

/** Tables can use a plugin that an admin enabled and the last scan found ready. */
export const isAvailable = (plugin: Pick<PluginRow, 'enabled' | 'status'>): boolean =>
  plugin.enabled && plugin.status === 'ready';

export function toAdminPlugin(plugin: PluginRow): AdminPlugin {
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    coreApi: plugin.coreApi,
    hasCode: plugin.hasCode,
    codeEntries: plugin.codeEntries,
    enabled: plugin.enabled,
    status: plugin.status,
    available: isAvailable(plugin),
    issues: plugin.issues,
    scannedAt: plugin.scannedAt?.toISOString() ?? null,
  };
}

export function listPlugins(db: DbOrTx): PluginRow[] {
  return db.select().from(plugins).orderBy(asc(plugins.name), asc(plugins.id)).all();
}

export function findPlugin(db: DbOrTx, id: string): PluginRow | undefined {
  return db.select().from(plugins).where(eq(plugins.id, id)).get();
}
