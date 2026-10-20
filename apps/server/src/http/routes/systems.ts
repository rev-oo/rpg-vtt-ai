import { asc, eq } from 'drizzle-orm';

import { plugins } from '../../db/schema.js';
import type { AppContext } from '../app.js';
import { requireSession } from '../auth.js';

/**
 * Enabled system plugins, for the create-table picker (FR-TABLE-01). Any signed-in user may
 * create a table, so this is not admin-only like `GET /plugins` (§10.1).
 */
export function systemRoutes({ app, db }: AppContext): void {
  app.get('/api/v1/systems', (request) => {
    requireSession(request);
    const systems = db
      .select({ id: plugins.id, name: plugins.name, version: plugins.version })
      .from(plugins)
      .where(eq(plugins.enabled, true))
      .orderBy(asc(plugins.name), asc(plugins.id))
      .all();
    return { systems };
  });
}
