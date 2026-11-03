import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import * as Y from 'yjs';

import {
  copyInto,
  dataIssues,
  documentLayout,
  ensureContainers,
  MigrationStepFailure,
  runMigrationSteps,
  splitLayers,
  writeLayer,
  type LayerData,
} from '@vtt/plugin-engine';
import { isBehind, pendingMigrations, type PluginDefinition } from '@vtt/plugin-schema';
import { documentName, type DocumentRef } from '@vtt/shared';
import {
  MAX_FAILURE_ISSUES,
  MAX_REPORTED_FAILURES,
  type MigrationFailure,
  type MigrationReport,
} from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import type { Actor, Item } from '../db/repositories/index.js';
import { actors, items, ydocs } from '../db/schema.js';
import type { LoadedCode } from '../plugins/code-runtime.js';

import { DATA_MAP, entityData, loadDocument, type DefinitionOf } from './documents.js';
import { recordSnapshot } from './history.js';

// Plugin data migrations (FR-PLUGIN-12, ADR-072): when a GM upgrades a table, each actor and
// item whose data is from an older version is brought up to the table's, one at a time.

export interface MigrationOptions {
  definition: DefinitionOf;
  /** The system's shared and server code, for its `migrate` hook. */
  code: (systemId: string) => Promise<LoadedCode | undefined>;
  /** An open document, so a sheet being edited is migrated as it is. */
  live: (name: string) => Y.Doc | undefined;
  /** Called after each entity is migrated, so lists and open sheets hear of it. */
  changed: (entity: MigratedEntity) => void;
  now: () => Date;
  logger: FastifyBaseLogger;
}

/** An actor or an item, with which it is. */
export type MigratedEntity = { kind: 'actor'; row: Actor } | { kind: 'item'; row: Item };

/** The type an entity's system still declares for it. */
function declaredType(plugin: PluginDefinition, kind: 'actor' | 'item', type: string) {
  const types = kind === 'actor' ? plugin.actorTypes : plugin.itemTypes;
  return Object.hasOwn(types, type) ? types[type] : undefined;
}

/**
 * The table's actors and items, trash included, whose data is behind `version` and whose type
 * the system still declares: what an upgrade migrates. Data from a newer version is left alone,
 * since migrations only run forwards.
 */
function outdated(db: DbOrTx, tableId: string, version: string, plugin: PluginDefinition) {
  const behind = (row: { type: string; dataVersion: string }, kind: 'actor' | 'item') =>
    isBehind(row.dataVersion, version) && declaredType(plugin, kind, row.type) !== undefined;
  const entities: MigratedEntity[] = [
    ...db
      .select()
      .from(actors)
      .where(eq(actors.tableId, tableId))
      .all()
      .filter((row) => behind(row, 'actor'))
      .map((row): MigratedEntity => ({ kind: 'actor', row })),
    ...db
      .select()
      .from(items)
      .where(eq(items.tableId, tableId))
      .all()
      .filter((row) => behind(row, 'item'))
      .map((row): MigratedEntity => ({ kind: 'item', row })),
  ];
  return entities;
}

/** How many of a table's actors and items an upgrade would migrate (ADR-072). */
export function countOutdated(
  db: DbOrTx,
  table: { id: string; systemId: string; systemVersion: string },
  definition: DefinitionOf,
): number {
  const plugin = definition(table.systemId);
  return plugin ? outdated(db, table.id, table.systemVersion, plugin).length : 0;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The `migrate` hook's code, when the system has one; it may fail to load. */
type Hook = { code: LoadedCode } | { failed: true } | undefined;

async function migrateHook(systemId: string, { code, logger }: MigrationOptions): Promise<Hook> {
  try {
    const loaded = await code(systemId);
    return loaded?.hooks.includes('migrate') ? { code: loaded } : undefined;
  } catch (error) {
    logger.warn({ err: error, plugin: systemId }, 'plugin code unavailable for migrations');
    return { failed: true };
  }
}

/** The hook has no `ctx` (ADR-072), so nothing it could ask the server for is answered. */
const noHost = () => Promise.reject(new Error('The migrate hook has no ctx.'));

/** What the steps and the hook make of one entity's data, or why they could not. */
async function migratedData(
  entity: MigratedEntity,
  data: LayerData,
  { plugin, to, hook }: { plugin: PluginDefinition; to: string; hook: Hook },
  logger: FastifyBaseLogger,
): Promise<{ data: LayerData } | Omit<MigrationFailure, 'kind' | 'id' | 'name'>> {
  const { kind, row } = entity;
  const migrations = plugin.migrations ?? {};
  let current = data;
  for (const version of pendingMigrations(migrations, row.dataVersion, to)) {
    try {
      current = runMigrationSteps(current, migrations[version]?.steps ?? [], {
        kind,
        type: row.type,
      });
    } catch (error) {
      if (!(error instanceof MigrationStepFailure)) throw error;
      return { reason: 'step', version, step: error.step };
    }
  }
  if (hook && 'failed' in hook) return { reason: 'code' };
  if (hook) {
    try {
      const input = { kind, type: row.type, from: row.dataVersion, to, data: current };
      const value = await hook.code.handle('hook', 'migrate', input, noHost);
      if (!isRecord(value)) return { reason: 'hook' };
      current = value;
    } catch (error) {
      logger.warn({ err: error, [kind]: row.id }, 'migrate hook failed');
      return { reason: 'hook' };
    }
  }
  return { data: current };
}

/**
 * Writes an entity's migrated data: each document's stored state, its projection and its
 * `dataVersion`, in one transaction, after keeping an actor's documents in its sheet history
 * so a GM can go back (ADR-053). Returns the documents to bring open sheets up to date with.
 */
function writeEntity(
  db: DbOrTx,
  entity: MigratedEntity,
  {
    schema,
    data,
    to,
  }: { schema: Parameters<typeof documentLayout>[0]; data: LayerData; to: string },
  { definition, live, now }: Pick<MigrationOptions, 'definition' | 'live' | 'now'>,
): { name: string; doc: Y.Doc }[] {
  const { kind, row } = entity;
  const layout = documentLayout(schema);
  const layers = splitLayers(layout, data);
  const at = now();
  const written: { name: string; doc: Y.Doc }[] = [];
  db.transaction((tx) => {
    for (const layer of layout.secret ? (['main', 'secret'] as const) : (['main'] as const)) {
      const ref: DocumentRef = { kind, id: row.id, layer };
      const name = documentName(ref);
      const fields = (layer === 'secret' ? layout.secret : layout.main) ?? {};
      // The document as it is now: an open one with what has not been stored yet.
      const doc = new Y.Doc();
      const open = live(name);
      if (open) Y.applyUpdate(doc, Y.encodeStateAsUpdate(open));
      else loadDocument(tx, ref, doc, definition);
      const map = doc.getMap<unknown>(DATA_MAP);
      if (kind === 'actor')
        recordSnapshot(tx, { actorId: row.id, layer }, map, at, { force: true });
      const next = new Y.Doc();
      writeLayer(next.getMap(DATA_MAP), fields, layers[layer] ?? {});
      doc.transact(() => {
        copyInto(map, next.getMap(DATA_MAP));
        ensureContainers(map, fields);
      });
      next.destroy();
      const state = Buffer.from(Y.encodeStateAsUpdate(doc));
      tx.insert(ydocs)
        .values({
          name,
          actorId: kind === 'actor' ? row.id : null,
          itemId: kind === 'item' ? row.id : null,
          journalEntryId: null,
          state,
          updatedAt: at,
        })
        .onConflictDoUpdate({ target: ydocs.name, set: { state, updatedAt: at } })
        .run();
      written.push({ name, doc });
    }
    const values = { system: data, dataVersion: to, updatedAt: at };
    if (kind === 'actor') tx.update(actors).set(values).where(eq(actors.id, row.id)).run();
    else tx.update(items).set(values).where(eq(items.id, row.id)).run();
  });
  return written;
}

/**
 * Brings the table's actors and items up to `to`, the version it was just upgraded to
 * (FR-PLUGIN-12, ADR-072): for each, the `migrations/` steps after its `dataVersion`, then the
 * system's `migrate` hook, on both layers' data. A result that does not fit the type's schema
 * fails like a step that cannot run, and a failed entity is left as it was. Entities are done
 * one at a time, each in its own transaction, so one failure does not hold back the rest.
 */
export async function migrateTable(
  db: DbOrTx,
  table: { id: string; systemId: string },
  to: string,
  options: MigrationOptions,
): Promise<MigrationReport> {
  const plugin = options.definition(table.systemId);
  const report: MigrationReport = { migrated: 0, failedCount: 0, failed: [] };
  if (!plugin) return report;
  const entities = outdated(db, table.id, to, plugin);
  if (entities.length === 0) return report;
  const hook = await migrateHook(table.systemId, options);
  for (const entity of entities) {
    const { kind, row } = entity;
    const type = declaredType(plugin, kind, row.type);
    if (!type) continue;
    const data = entityData(db, kind, row, options.definition, options.live);
    const result = await migratedData(entity, data, { plugin, to, hook }, options.logger);
    let failure: Omit<MigrationFailure, 'kind' | 'id' | 'name'> | undefined =
      'data' in result ? undefined : result;
    if ('data' in result) {
      const issues = dataIssues(type.schema, result.data);
      if (issues.length > 0)
        failure = { reason: 'invalid', issues: issues.slice(0, MAX_FAILURE_ISSUES) };
      else {
        const written = writeEntity(
          db,
          entity,
          { schema: type.schema, data: result.data, to },
          options,
        );
        // Open sheets get the new data at once; they store it as any change.
        for (const { name, doc } of written) {
          const open = options.live(name);
          if (open)
            open.transact(() => {
              copyInto(open.getMap(DATA_MAP), doc.getMap(DATA_MAP));
            });
          doc.destroy();
        }
        report.migrated += 1;
        options.changed(entity);
      }
    }
    if (failure) {
      report.failedCount += 1;
      if (report.failed.length < MAX_REPORTED_FAILURES) {
        report.failed.push({ kind, id: row.id, name: row.name, ...failure });
      }
      options.logger.warn({ [kind]: row.id, failure }, 'migration failed');
    }
  }
  return report;
}
