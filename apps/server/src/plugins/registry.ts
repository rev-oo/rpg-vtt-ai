import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import {
  PLUGIN_ID,
  validatePlugin,
  type PluginDefinition,
  type PluginIssue,
} from '@vtt/plugin-schema';
import type { PluginStatus } from '@vtt/shared/api';

import type { Db } from '../db/client.js';
import { plugins } from '../db/schema.js';

import { readPluginFolder } from './folder.js';

export interface RegistryOptions {
  db: Db;
  /** `DATA_DIR/plugins`. */
  dir: string;
  logger: FastifyBaseLogger;
  now: () => Date;
  /** The core API version plugins are checked against; this core's by default. */
  coreVersion?: string;
}

interface Scanned {
  id: string;
  status: PluginStatus;
  issues: PluginIssue[];
  codeEntries: string[];
  manifest: ReturnType<typeof validatePlugin>['manifest'];
  definition: PluginDefinition | undefined;
}

function statusOf(issues: readonly PluginIssue[]): PluginStatus {
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length === 0) return 'ready';
  return errors.every((issue) => issue.code === 'incompatible_core_api')
    ? 'incompatible'
    : 'invalid';
}

/**
 * The installed plugins (FR-PLUGIN-01, 03). `scan()` reads every folder in `DATA_DIR/plugins`,
 * validates it (ADR-019) and writes one `plugins` row per folder; a row whose folder is gone
 * becomes `missing`. Only admins change `enabled` (FR-PLUGIN-07), except that a plugin which
 * gains code is disabled until an admin enables it again (FR-PLUGIN-06).
 */
export class PluginRegistry {
  readonly #options: RegistryOptions;
  readonly #definitions = new Map<string, PluginDefinition>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: RegistryOptions) {
    this.#options = options;
  }

  /** The folder plugins are scanned from (`DATA_DIR/plugins`). */
  get dir(): string {
    return this.#options.dir;
  }

  /** The parsed files of a ready plugin, as of the last scan. */
  definition(id: string): PluginDefinition | undefined {
    return this.#definitions.get(id);
  }

  /** Rescans the folder. Scans run one at a time; a second call waits for the first. */
  scan(): Promise<void> {
    const run = this.#queue.then(() => this.#scan());
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #scan(): Promise<void> {
    const { db, logger, now } = this.#options;
    const scanned = await this.#readAll();
    const at = now();

    db.transaction((tx) => {
      const existing = new Map(
        tx
          .select()
          .from(plugins)
          .all()
          .map((row) => [row.id, row]),
      );
      for (const plugin of scanned) {
        const row = existing.get(plugin.id);
        const { manifest, definition } = plugin;
        const hasCode = plugin.codeEntries.length > 0;
        const values = {
          name: manifest?.name ?? row?.name ?? plugin.id,
          version: manifest?.version ?? row?.version ?? '0.0.0',
          description: manifest ? (manifest.description ?? null) : (row?.description ?? null),
          coreApi: manifest?.coreApi ?? row?.coreApi ?? '',
          hasCode,
          codeEntries: plugin.codeEntries,
          status: plugin.status,
          issues: plugin.issues,
          scannedAt: at,
          updatedAt: at,
          // A broken plugin keeps the types it last had, so its tables still list entities.
          ...(definition && {
            actorTypes: Object.fromEntries(
              Object.entries(definition.actorTypes).map(([type, { controlledBy }]) => [
                type,
                { controlledBy },
              ]),
            ),
            itemTypes: Object.keys(definition.itemTypes),
          }),
          ...(row && hasCode && !row.hasCode && { enabled: false }),
        };
        if (row) tx.update(plugins).set(values).where(eq(plugins.id, plugin.id)).run();
        else
          tx.insert(plugins)
            .values({ id: plugin.id, enabled: false, ...values })
            .run();
      }
      const found = new Set(scanned.map((plugin) => plugin.id));
      for (const id of existing.keys()) {
        if (found.has(id)) continue;
        tx.update(plugins)
          .set({ status: 'missing', issues: [], scannedAt: at, updatedAt: at })
          .where(eq(plugins.id, id))
          .run();
      }
    });

    this.#definitions.clear();
    for (const plugin of scanned) {
      if (plugin.status === 'ready' && plugin.definition) {
        this.#definitions.set(plugin.id, plugin.definition);
      }
      const errors = plugin.issues.filter((issue) => issue.severity === 'error').length;
      logger.info({ plugin: plugin.id, status: plugin.status, errors }, 'plugin scanned');
    }
  }

  async #readAll(): Promise<Scanned[]> {
    const { dir, logger, coreVersion } = this.#options;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const scanned: Scanned[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      if (!PLUGIN_ID.test(entry.name)) {
        logger.warn({ folder: entry.name }, 'ignored plugin folder: the name is not a plugin id');
        continue;
      }
      const folder = await readPluginFolder(path.join(dir, entry.name));
      const result = validatePlugin(folder.files, {
        folder: entry.name,
        ...(coreVersion !== undefined && { coreVersion }),
      });
      const issues = [...folder.issues, ...result.issues];
      const status = statusOf(issues);
      scanned.push({
        id: entry.name,
        status,
        issues,
        codeEntries: [...folder.files.keys()].filter((file) => file.startsWith('code/')).sort(),
        manifest: result.manifest,
        definition: status === 'ready' ? result.plugin : undefined,
      });
    }
    return scanned;
  }
}
