// @ts-check
// Starts the built API server on a fresh data directory with one enabled system plugin. The
// plugin folder is copied in and the server's startup scan fills its row; only `enabled` is
// seeded, since enabling needs an admin (FR-PLUGIN-07).
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../../apps/server');
const dataDir = path.resolve(here, '../.data');
const env = { ...process.env, DATA_DIR: dataDir, PORT: process.env.E2E_API_PORT ?? '3100' };

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

const migrate = spawnSync('node', ['dist/src/cli/migrate.js'], {
  cwd: serverDir,
  env,
  stdio: 'inherit',
});
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

cpSync(path.resolve(here, '../fixtures/plugins'), path.join(dataDir, 'plugins'), {
  recursive: true,
});
const db = new Database(path.join(dataDir, 'vtt.sqlite'));
db.prepare(
  `insert into plugins (id, name, version, enabled, updated_at) values (?, ?, ?, 1, ?)`,
).run('e2e-system', 'E2E System', '1.0.0', Date.now());
db.close();

const server = spawn('node', ['dist/src/main.js'], { cwd: serverDir, env, stdio: 'inherit' });
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code) => process.exit(code ?? 0));
