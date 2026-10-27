import path from 'node:path';

import { z } from 'zod';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** An empty variable (`PORT=`) counts as unset, so defaults still apply. */
const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

const envSchema = z.object({
  DATA_DIR: unsetIfEmpty(z.string().default('./data')),
  PORT: unsetIfEmpty(z.coerce.number().int().min(1).max(65_535).default(3000)),
  /** Session lifetime in seconds. Default: 7 days. */
  SESSION_TTL: unsetIfEmpty(
    z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24 * 7),
  ),
  /** Externally visible base URL, used for invite links and cookie security. */
  PUBLIC_URL: unsetIfEmpty(z.url({ protocol: /^https?$/ }).optional()),
  LOG_LEVEL: unsetIfEmpty(z.enum(LOG_LEVELS).default('info')),
  /** Days a deleted actor, item or journal entry can be restored (FR-ENT-04, Q6). Default: 30. */
  SOFT_DELETE_RETENTION_DAYS: unsetIfEmpty(z.coerce.number().int().min(1).max(3650).default(30)),
  /** Where scheduled backups go (FR-ADMIN-05, ADR-055). Unset: no scheduled backups. */
  BACKUP_DIR: unsetIfEmpty(z.string().optional()),
  /** Hours between scheduled backups. Default: 24. */
  BACKUP_INTERVAL_HOURS: unsetIfEmpty(z.coerce.number().int().min(1).max(8760).default(24)),
  /** How many scheduled backups to keep; older ones are removed. Default: 7. */
  BACKUP_KEEP: unsetIfEmpty(z.coerce.number().int().min(1).max(1000).default(7)),
  /** The built web app (`apps/web/build/client`). Default: that folder, if it was built. */
  WEB_DIR: unsetIfEmpty(z.string().optional()),
  /**
   * Set when running behind a reverse proxy (specs §4.2) so client IPs come from
   * X-Forwarded-For: `true`, or the number of proxy hops to trust. Default: false.
   */
  TRUST_PROXY: unsetIfEmpty(
    z
      .union([
        z.enum(['true', 'false']).transform((v) => v === 'true'),
        z.coerce.number().int().min(1),
      ])
      .default(false),
  ),
});

export interface Config {
  /** Absolute path of the data directory (database, plugins, logs). */
  dataDir: string;
  port: number;
  sessionTtlSeconds: number;
  publicUrl: URL;
  logLevel: LogLevel;
  trustProxy: boolean | number;
  /** How long soft-deleted entities stay restorable, in milliseconds. */
  softDeleteRetentionMs: number;
  /** Absolute path of the built web app to serve, if set. */
  webDir: string | undefined;
  /** Scheduled backups, when `BACKUP_DIR` is set. */
  backup: BackupSchedule | undefined;
}

export interface BackupSchedule {
  /** Absolute path of the folder backups are written into. */
  dir: string;
  intervalMs: number;
  /** How many of the newest backups stay. */
  keep: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Parses and validates server configuration from environment variables (specs T-0101). */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  const parsed = result.data;
  return {
    dataDir: path.resolve(parsed.DATA_DIR),
    port: parsed.PORT,
    sessionTtlSeconds: parsed.SESSION_TTL,
    publicUrl: new URL(parsed.PUBLIC_URL ?? `http://localhost:${String(parsed.PORT)}`),
    logLevel: parsed.LOG_LEVEL,
    trustProxy: parsed.TRUST_PROXY,
    softDeleteRetentionMs: parsed.SOFT_DELETE_RETENTION_DAYS * DAY_MS,
    webDir: parsed.WEB_DIR === undefined ? undefined : path.resolve(parsed.WEB_DIR),
    backup:
      parsed.BACKUP_DIR === undefined
        ? undefined
        : {
            dir: path.resolve(parsed.BACKUP_DIR),
            intervalMs: parsed.BACKUP_INTERVAL_HOURS * HOUR_MS,
            keep: parsed.BACKUP_KEEP,
          },
  };
}
