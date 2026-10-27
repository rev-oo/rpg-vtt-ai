import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { SystemDefinitionResponse } from '@vtt/shared/api';

import { plugins } from '../../db/schema.js';
import { findPlugin, isAvailable } from '../../domain/plugins.js';
import { notFound } from '../../errors.js';
import type { AppContext } from '../app.js';
import { requireSession } from '../auth.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.string().max(64) });

/**
 * Available (enabled and ready) system plugins, for the create-table picker (FR-TABLE-01). Any signed-in user may
 * create a table, so this is not admin-only like `GET /plugins` (§10.1).
 */
export function systemRoutes({ app, db, plugins: registry }: AppContext): void {
  app.get('/api/v1/systems', (request) => {
    requireSession(request);
    const systems = db
      .select({ id: plugins.id, name: plugins.name, version: plugins.version })
      .from(plugins)
      .where(and(eq(plugins.enabled, true), eq(plugins.status, 'ready')))
      .orderBy(asc(plugins.name), asc(plugins.id))
      .all();
    return { systems };
  });

  /**
   * One available system for the web app's plugin host (T-0409, ADR-025): its validated
   * definition and the URLs of its scoped stylesheets and client code, served by
   * `/plugins/<id>/*` (ADR-022). Unavailable systems answer 404, so tables using them are
   * shown read-only.
   */
  app.get('/api/v1/systems/:id', (request): SystemDefinitionResponse => {
    requireSession(request);
    const { id } = parseInput(idParams, request.params);
    const plugin = findPlugin(db, id);
    const definition = plugin && isAvailable(plugin) ? registry.definition(id) : undefined;
    if (!plugin || !definition) throw notFound('System not found.');
    const base = `/plugins/${encodeURIComponent(id)}/`;
    return {
      system: {
        id,
        name: plugin.name,
        version: plugin.version,
        definition: { ...definition },
        styles: definition.styles.map((file) => base + file),
        client: plugin.codeEntries.includes('code/client.js') ? `${base}code/client.js` : null,
        shared: plugin.codeEntries.includes('code/shared.js') ? `${base}code/shared.js` : null,
      },
    };
  });
}
