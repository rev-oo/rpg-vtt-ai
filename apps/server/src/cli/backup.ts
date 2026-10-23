// `pnpm backup <folder>`: writes a consistent copy of DATA_DIR into a new dated folder, while
// the server keeps running (FR-ADMIN-05). See docs/backup.md.
import path from 'node:path';

import { loadConfig } from '../config/index.js';
import { backupDataDir } from '../db/backup.js';
import { createLogger } from '../logger/index.js';

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);
const destination = process.argv[2];
if (!destination) {
  logger.error('usage: backup <destination folder>');
  process.exit(2);
}
// Relative to where `pnpm backup` was typed, not to apps/server.
const base = process.env.INIT_CWD ?? process.cwd();
const result = backupDataDir(config.dataDir, path.resolve(base, destination));
logger.info(result, 'backup written');
