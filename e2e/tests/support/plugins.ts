import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect } from '@playwright/test';
import Database from 'better-sqlite3';

import type { SignedIn } from './api.js';
import { databaseFile } from './instance.js';

// The built plugin CLI, linked as a dependency of this package.
const cli = fileURLToPath(
  new URL('../../node_modules/@vtt/plugin-cli/dist/src/bin.js', import.meta.url),
);

/** Packs a plugin folder with `vtt-plugin pack`, as an author would (T-0410). */
export function packPlugin(dir: string, out: string): string {
  const result = spawnSync(process.execPath, [cli, 'pack', dir, '--out', out], {
    encoding: 'utf8',
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return out;
}

/** Installs a `.vttplugin` archive through the admin API (ADR-026). */
export async function installPlugin(admin: SignedIn, file: string): Promise<void> {
  const response = await admin.context.request.post('/api/v1/plugins/install?replace=true', {
    data: await readFile(file),
    headers: { 'content-type': 'application/zip', 'x-csrf-token': admin.csrf },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/**
 * Sets an actor's stored plugin data. Only for actors whose sheet was never opened: once it
 * was, its live document is the source of truth (ADR-029).
 */
export function setActorData(actorId: string, system: Record<string, unknown>): void {
  const db = new Database(databaseFile());
  try {
    db.prepare('update actors set system = ? where id = ?').run(JSON.stringify(system), actorId);
  } finally {
    db.close();
  }
}
