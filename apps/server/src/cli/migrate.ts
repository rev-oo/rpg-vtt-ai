// `pnpm db:migrate`: creates or upgrades DATA_DIR/vtt.sqlite without starting the server.
import { loadConfig } from '../config/index.js';
import { DATABASE_FILENAME, openDatabase, runMigrations } from '../db/client.js';
import { createLogger } from '../logger/index.js';

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);
const db = openDatabase({ dataDir: config.dataDir });
runMigrations(db);
db.$client.close();
logger.info({ database: `${config.dataDir}/${DATABASE_FILENAME}` }, 'migrations applied');
