import { asc, eq } from 'drizzle-orm';

import { settingsOfScope, type PluginDefinition } from '@vtt/plugin-schema';
import type { AdminPlugin, PluginAttribution } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { plugins } from '../db/schema.js';

export type PluginRow = typeof plugins.$inferSelect;

/** Tables can use a plugin that an admin enabled and the last scan found ready. */
export const isAvailable = (plugin: Pick<PluginRow, 'enabled' | 'status'>): boolean =>
  plugin.enabled && plugin.status === 'ready';

/** The credit a plugin's manifest asks for (T-1614). */
export function attributionOf(definition: PluginDefinition | undefined): PluginAttribution | null {
  const attribution = definition?.manifest.attribution;
  return attribution ? { text: attribution.text, url: attribution.url ?? null } : null;
}

export function toAdminPlugin(
  plugin: PluginRow,
  definition: PluginDefinition | undefined,
): AdminPlugin {
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    kind: plugin.kind,
    description: plugin.description,
    attribution: attributionOf(definition),
    coreApi: plugin.coreApi,
    hasCode: plugin.hasCode,
    codeEntries: plugin.codeEntries,
    instanceSettings:
      definition !== undefined &&
      Object.keys(settingsOfScope(definition.settings, 'instance')).length > 0,
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
