import { and, eq, inArray } from 'drizzle-orm';

import { packData } from '@vtt/plugin-engine';
import type { Pack, PluginDefinition } from '@vtt/plugin-schema';
import type { PackSummary } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { createActor, createItem, type Actor, type Item } from '../db/repositories/index.js';
import { actors, items } from '../db/schema.js';
import { notFound } from '../errors.js';

import type { GameTable } from './tables.js';

// Compendium packs (FR-PLUGIN-09, ADR-051): entries of the system's own types that GMs import
// into a table as its actors and library items.

/** Where an entity came from: `<plugin>:<pack>:<entry>`. */
const refOf = (plugin: PluginDefinition, pack: string, entry: string) =>
  `${plugin.manifest.id}:${pack}:${entry}`;

/** The pack refs already in the table, live or in the trash, among `refs`. */
function importedRefs(db: DbOrTx, tableId: string, refs: readonly string[]): Set<string> {
  if (refs.length === 0) return new Set();
  const found = new Set<string>();
  for (const table of [actors, items]) {
    const rows = db
      .select({ ref: table.packRef })
      .from(table)
      .where(and(eq(table.tableId, tableId), inArray(table.packRef, [...refs])))
      .all();
    for (const { ref } of rows) if (ref) found.add(ref);
  }
  return found;
}

const refsOf = (plugin: PluginDefinition, name: string, pack: Pack) =>
  pack.entries.map((entry) => refOf(plugin, name, entry.id));

/** The system's packs, with how many of their entries the table has. */
export function listPacks(db: DbOrTx, table: GameTable, plugin: PluginDefinition): PackSummary[] {
  return Object.entries(plugin.packs ?? {}).map(([name, pack]) => {
    const imported = importedRefs(db, table.id, refsOf(plugin, name, pack));
    return {
      name,
      label: pack.label,
      actors: pack.entries.filter((entry) => entry.kind === 'actor').length,
      items: pack.entries.filter((entry) => entry.kind === 'item').length,
      imported: imported.size,
    };
  });
}

/**
 * Imports a pack into the table: each entry not yet imported, even if since moved to the
 * trash, becomes an actor (GM-owned) or a library item, with the entry's data. Importing again
 * creates only what is missing, so it never duplicates.
 */
export function importPack(
  db: DbOrTx,
  table: GameTable,
  plugin: PluginDefinition,
  name: string,
  createdBy: string,
  now: Date,
): { actors: Actor[]; items: Item[]; skipped: number } {
  const pack = Object.hasOwn(plugin.packs ?? {}, name) ? plugin.packs?.[name] : undefined;
  if (!pack) throw notFound('Pack not found.');
  return db.transaction((tx) => {
    const done = importedRefs(tx, table.id, refsOf(plugin, name, pack));
    const created = { actors: [] as Actor[], items: [] as Item[], skipped: 0 };
    for (const entry of pack.entries) {
      const packRef = refOf(plugin, name, entry.id);
      if (done.has(packRef)) {
        created.skipped += 1;
        continue;
      }
      const types = entry.kind === 'actor' ? plugin.actorTypes : plugin.itemTypes;
      const base = {
        tableId: table.id,
        type: entry.type,
        name: entry.name,
        system: packData(types[entry.type]?.schema, entry.data ?? {}),
        dataVersion: table.systemVersion,
        packRef,
      };
      if (entry.kind === 'actor') created.actors.push(createActor(tx, { ...base, createdBy }, now));
      else created.items.push(createItem(tx, base, now));
    }
    return created;
  });
}
