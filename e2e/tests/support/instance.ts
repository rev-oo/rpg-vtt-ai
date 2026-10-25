import path from 'node:path';

import { test } from '@playwright/test';

/**
 * The data directory of the instance the current test runs against: each browser has its own
 * (playwright.config.ts). Only callable while a test or hook runs.
 */
export function dataDir(): string {
  const dir: unknown = test.info().project.metadata.dataDir;
  if (typeof dir !== 'string') throw new Error('The project names no data directory.');
  return dir;
}

export const databaseFile = (): string => path.join(dataDir(), 'vtt.sqlite');
export const pluginsDir = (): string => path.join(dataDir(), 'plugins');
