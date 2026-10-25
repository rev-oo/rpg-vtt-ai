import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigError, loadConfig, type Config } from './config/index.js';
import { openDatabase, runMigrations } from './db/client.js';
import { buildApp } from './http/app.js';
import { isWebApp } from './http/web-app.js';
import { createLogger } from './logger/index.js';
import { PluginRegistry } from './plugins/registry.js';

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
// Plugins found at startup are available without a rescan (FR-PLUGIN-01).
const plugins = new PluginRegistry({
  db,
  dir: path.join(config.dataDir, 'plugins'),
  logger,
  now: () => new Date(),
});
await plugins.scan();

// The web app built next to this package in the repository, unless WEB_DIR names another.
const builtWebApp = fileURLToPath(new URL('../../../web/build/client', import.meta.url));
const webDir = config.webDir ?? (isWebApp(builtWebApp) ? builtWebApp : undefined);
if (webDir !== undefined && !isWebApp(webDir)) {
  logger.fatal({ webDir }, 'WEB_DIR has no built web app (index.html)');
  process.exit(1);
}
if (webDir === undefined) logger.info('No built web app found; serving the API only');
const app = await buildApp({
  logger,
  db,
  config,
  plugins,
  ...(webDir !== undefined && { webDir }),
});

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
