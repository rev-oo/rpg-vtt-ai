import { ConfigError, loadConfig, type Config } from './config/index.js';
import { openDatabase, runMigrations } from './db/client.js';
import { buildApp } from './http/app.js';
import { createLogger } from './logger/index.js';

function readConfig(): Config {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      // The logger is not configured yet; report straight to stderr.
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const logger = createLogger(config.logLevel);
const db = openDatabase({ dataDir: config.dataDir });
runMigrations(db);
const app = await buildApp({ logger, db, config });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down');
    void app.close().then(() => {
      db.$client.close();
      process.exit(0);
    });
  });
}

await app.listen({ port: config.port, host: '0.0.0.0' });
