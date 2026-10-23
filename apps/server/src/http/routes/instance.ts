import { sql } from 'drizzle-orm';

import { updateInstanceSettingsBody, type HealthResponse } from '@vtt/shared/api';

import { writeInstanceSettings } from '../../domain/instance.js';
import { listPlugins } from '../../domain/plugins.js';
import type { AppContext } from '../app.js';
import { requireAdmin } from '../auth.js';
import { parseInput } from '../validation.js';

/** Instance settings (FR-ADMIN-01) and the health endpoint (FR-ADMIN-03). */
export function instanceRoutes({ app, db, instance }: AppContext): void {
  /** Public: the login and join pages show the site name and whether sign-up is open. */
  app.get('/api/v1/instance', () => {
    const { siteName, registration } = instance();
    return { instance: { siteName, registration } };
  });

  app.get('/api/v1/admin/settings', (request) => {
    requireAdmin(request);
    return { settings: instance() };
  });

  app.patch('/api/v1/admin/settings', (request) => {
    requireAdmin(request);
    writeInstanceSettings(db, parseInput(updateInstanceSettingsBody, request.body));
    return { settings: instance() };
  });

  /**
   * Healthy while the database answers. Plugins that fail to load are reported but do not
   * make the instance unhealthy: tables of other systems keep working (ADR-040).
   */
  app.get('/api/health', (request, reply) => {
    let database: HealthResponse['database'] = 'ok';
    let enabled: { status: string }[] = [];
    try {
      db.get(sql`select 1`);
      enabled = listPlugins(db).filter((plugin) => plugin.enabled);
    } catch (error) {
      request.log.error({ err: error }, 'health check: database unavailable');
      database = 'error';
    }
    const ready = enabled.filter((plugin) => plugin.status === 'ready').length;
    const body: HealthResponse = {
      status: database === 'ok' ? 'ok' : 'unhealthy',
      database,
      plugins: { enabled: enabled.length, ready, failed: enabled.length - ready },
    };
    return reply.code(database === 'ok' ? 200 : 503).send(body);
  });
}
