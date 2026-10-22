import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { MAX_ARCHIVE_BYTES } from '@vtt/plugin-io';
import { PLUGIN_ID } from '@vtt/plugin-schema';
import { enablePluginBody, installPluginQuery } from '@vtt/shared/api';

import { plugins } from '../../db/schema.js';
import { findPlugin, listPlugins, toAdminPlugin, type PluginRow } from '../../domain/plugins.js';
import { badRequest, conflict, notFound, unprocessable } from '../../errors.js';
import type { AppContext } from '../app.js';
import { requireAdmin } from '../auth.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.string().regex(PLUGIN_ID) });

/**
 * The plugin admin API: list, rescan, install, enable, disable (FR-ADMIN-02, FR-PLUGIN-01, 07).
 */
export function pluginRoutes({ app, db, plugins: registry, now }: AppContext): void {
  const list = () => ({ plugins: listPlugins(db).map(toAdminPlugin) });

  app.get('/api/v1/plugins', (request) => {
    requireAdmin(request);
    return list();
  });

  app.post('/api/v1/plugins/rescan', async (request) => {
    requireAdmin(request);
    await registry.scan();
    return list();
  });

  // Archives arrive as the raw body (ADR-026); only this route reads them.
  app.addContentTypeParser(
    'application/zip',
    { parseAs: 'buffer', bodyLimit: MAX_ARCHIVE_BYTES },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.post('/api/v1/plugins/install', { bodyLimit: MAX_ARCHIVE_BYTES }, async (request, reply) => {
    requireAdmin(request);
    const { replace } = parseInput(installPluginQuery, request.query);
    if (!Buffer.isBuffer(request.body)) {
      throw badRequest('archive_required', 'Send a .vttplugin archive as application/zip.');
    }
    const { id, replaced } = await registry.install(request.body, { replace });
    const plugin = findPlugin(db, id);
    if (!plugin) throw notFound('Plugin not found.');
    return reply.code(replaced ? 200 : 201).send({ plugin: toAdminPlugin(plugin) });
  });

  app.post('/api/v1/plugins/:id/enable', (request) => {
    requireAdmin(request);
    const { id } = parseInput(idParams, request.params);
    const body = parseInput(enablePluginBody, request.body ?? {});
    const plugin = findPlugin(db, id);
    if (!plugin) throw notFound('Plugin not found.');
    if (plugin.status !== 'ready') {
      throw conflict(
        'plugin_not_ready',
        `The plugin is ${plugin.status}; fix it and rescan first.`,
      );
    }
    // Plugin code runs in-process and is trusted (FR-PLUGIN-06, 08).
    if (plugin.hasCode && body.acknowledgeCode !== true) {
      throw unprocessable(
        'code_not_acknowledged',
        'This plugin includes code that runs on the server; set acknowledgeCode to enable it.',
      );
    }
    return { plugin: toAdminPlugin(setEnabled(id, true)) };
  });

  app.post('/api/v1/plugins/:id/disable', (request) => {
    requireAdmin(request);
    const { id } = parseInput(idParams, request.params);
    if (!findPlugin(db, id)) throw notFound('Plugin not found.');
    return { plugin: toAdminPlugin(setEnabled(id, false)) };
  });

  /** Callers check that the plugin exists. */
  function setEnabled(id: string, enabled: boolean): PluginRow {
    return db
      .update(plugins)
      .set({ enabled, updatedAt: now() })
      .where(eq(plugins.id, id))
      .returning()
      .get();
  }
}
