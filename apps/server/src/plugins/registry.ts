import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { and, eq, ne } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { ArchiveError, pluginFolderOf, readPluginArchive, readPluginFolder } from '@vtt/plugin-io';
import {
  PLUGIN_ID,
  validatePlugin,
  type PluginDefinition,
  type PluginIssue,
} from '@vtt/plugin-schema';
import type { PluginStatus } from '@vtt/shared/api';

import type { Db } from '../db/client.js';
import { gameTables, plugins } from '../db/schema.js';
import { conflict, unprocessable } from '../errors.js';

import { PluginCodeRuntime, type LoadedCode } from './code-runtime.js';

export interface RegistryOptions {
  db: Db;
  /** `DATA_DIR/plugins`. */
  dir: string;
  logger: FastifyBaseLogger;
  now: () => Date;
  /** The core API version plugins are checked against; this core's by default. */
  coreVersion?: string;
  /** Where installs unpack before they move into `dir`; on the same disk. */
  stagingDir?: string;
}

export interface InstallResult {
  id: string;
  /** Whether a plugin with the same id was there before. */
  replaced: boolean;
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
  readonly #codeEntries = new Map<string, string[]>();
  readonly #code: PluginCodeRuntime;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: RegistryOptions) {
    this.#options = options;
    this.#code = new PluginCodeRuntime({ dir: options.dir, logger: options.logger });
  }

  /** The folder plugins are scanned from (`DATA_DIR/plugins`). */
  get dir(): string {
    return this.#options.dir;
  }

  /** The parsed files of a ready plugin, as of the last scan. */
  definition(id: string): PluginDefinition | undefined {
    return this.#definitions.get(id);
  }

  /**
   * The shared and server code of a ready plugin, loaded into its worker on first use
   * (ADR-047); `undefined` when it has none. Rejects when the code fails to load.
   */
  code(id: string): Promise<LoadedCode | undefined> {
    const entries = this.#codeEntries.get(id);
    return entries ? this.#code.load(id, entries) : Promise.resolve(undefined);
  }

  /** Stops every plugin worker, as the server shuts down. */
  close(): Promise<void> {
    return this.#code.reset();
  }

  /** Rescans the folder. Scans run one at a time; a second call waits for the first. */
  scan(): Promise<void> {
    const run = this.#queue.then(() => this.#scan());
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Installs a `.vttplugin` archive (ADR-026): it must be valid, with no errors, and may only
   * replace an installed plugin of the same id when `replace` is set. The archive is unpacked
   * next to the plugin folder and moved in, then the folder is rescanned. A replaced plugin
   * with code is disabled until an admin enables it again, since its code changed
   * (FR-PLUGIN-06).
   */
  install(zip: Buffer, { replace = false }: { replace?: boolean } = {}): Promise<InstallResult> {
    const run = this.#queue.then(() => this.#install(zip, replace));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #install(zip: Buffer, replace: boolean): Promise<InstallResult> {
    const { dir, db, logger, coreVersion } = this.#options;
    let contents;
    try {
      contents = readPluginArchive(zip);
    } catch (error) {
      if (!(error instanceof ArchiveError)) throw error;
      throw unprocessable('invalid_archive', error.message, { reason: error.reason });
    }
    // It goes into a folder named after its own id, so there is no folder name to check.
    const folder = pluginFolderOf(contents);
    const result = validatePlugin(folder.files, coreVersion === undefined ? {} : { coreVersion });
    const id = result.manifest?.id;
    const issues = [...folder.issues, ...result.issues];
    if (id === undefined || !PLUGIN_ID.test(id) || issues.some((i) => i.severity === 'error')) {
      throw unprocessable('invalid_plugin', 'The plugin in the archive has errors.', { issues });
    }

    const target = path.join(dir, id);
    const replaced = await exists(target);
    if (replaced && !replace) {
      throw conflict('plugin_exists', `A plugin with the id ${id} is installed already.`);
    }
    const staging = this.#options.stagingDir ?? path.join(path.dirname(dir), 'cache', 'install');
    const unpacked = path.join(staging, randomUUID());
    const previous = path.join(staging, randomUUID());
    try {
      for (const [file, data] of contents) {
        const full = path.join(unpacked, ...file.split('/'));
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, data);
      }
      await mkdir(dir, { recursive: true });
      if (replaced) await rename(target, previous);
      await rename(unpacked, target);
    } finally {
      await rm(unpacked, { recursive: true, force: true });
      await rm(previous, { recursive: true, force: true });
    }
    logger.info({ plugin: id, replaced }, 'plugin installed');

    await this.#scan();
    if (replaced && [...contents.keys()].some((file) => file.startsWith('code/'))) {
      db.update(plugins).set({ enabled: false }).where(eq(plugins.id, id)).run();
    }
    return { id, replaced };
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
        // Tables follow their system's installed version; entities keep the version they
        // were made with, so sheets can tell them apart (§9.7, ADR-058).
        if (manifest) {
          tx.update(gameTables)
            .set({ systemVersion: manifest.version })
            .where(
              and(
                eq(gameTables.systemId, plugin.id),
                ne(gameTables.systemVersion, manifest.version),
              ),
            )
            .run();
        }
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
    this.#codeEntries.clear();
    // Code may have changed with the files: workers start again on next use.
    await this.#code.reset();
    for (const plugin of scanned) {
      if (plugin.status === 'ready' && plugin.definition) {
        this.#definitions.set(plugin.id, plugin.definition);
        this.#codeEntries.set(plugin.id, plugin.codeEntries);
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

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
