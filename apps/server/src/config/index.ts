import path from 'node:path';

import { z } from 'zod';

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
});

export interface Config {
  /** Absolute path of the data directory (database, plugins, logs). */
  dataDir: string;
  port: number;
  sessionTtlSeconds: number;
  publicUrl: URL;
  logLevel: LogLevel;
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
  };
}
