import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { MAX_ARCHIVE_BYTES } from '@vtt/plugin-io';
import { PLUGIN_ID } from '@vtt/plugin-schema';
import {
  enablePluginBody,
  installPluginQuery,
  updatePluginSettingsBody,
  type PluginSettingsResponse,
} from '@vtt/shared/api';

import { plugins, userPluginSettings } from '../../db/schema.js';
import { checkSettingValues, settingsResponse } from '../../domain/plugin-settings.js';
import {
  findPlugin,
  isAvailable,
  listPlugins,
  toAdminPlugin,
  type PluginRow,
} from '../../domain/plugins.js';
import { badRequest, conflict, notFound, unprocessable } from '../../errors.js';
import type { AppContext } from '../app.js';
import { requireAdmin, requireSession } from '../auth.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.string().regex(PLUGIN_ID) });

/**
 * The plugin admin API: list, rescan, install, enable, disable (FR-ADMIN-02, FR-PLUGIN-01, 07);
 * plugin settings of the instance and user scopes, and the modules tables may use (ADR-075).
 */
export function pluginRoutes({ app, db, plugins: registry, now }: AppContext): void {
  const view = (plugin: PluginRow) => toAdminPlugin(plugin, registry.definition(plugin.id));
  const list = () => ({ plugins: listPlugins(db).map(view) });

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
    return reply.code(replaced ? 200 : 201).send({ plugin: view(plugin) });
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
    return { plugin: view(setEnabled(id, true)) };
  });

  app.post('/api/v1/plugins/:id/disable', (request) => {
    requireAdmin(request);
    const { id } = parseInput(idParams, request.params);
    if (!findPlugin(db, id)) throw notFound('Plugin not found.');
    return { plugin: view(setEnabled(id, false)) };
  });

  /** A scanned plugin's definition, which its settings are checked against. */
  const definitionOf = (id: string) => {
    const plugin = findPlugin(db, id);
    const definition = plugin ? registry.definition(id) : undefined;
    if (!plugin || !definition) throw notFound('Plugin not found.');
    return { plugin, definition };
  };

  // Instance settings (ADR-075): admins set them for every table, enabled or not.
  app.get('/api/v1/plugins/:id/settings', (request): PluginSettingsResponse => {
    requireAdmin(request);
    const { id } = parseInput(idParams, request.params);
    const { plugin, definition } = definitionOf(id);
    return settingsResponse(definition, 'instance', plugin.settings);
  });

  app.patch('/api/v1/plugins/:id/settings', (request): PluginSettingsResponse => {
    requireAdmin(request);
    const { id } = parseInput(idParams, request.params);
    const { values } = parseInput(updatePluginSettingsBody, request.body);
    const { definition } = definitionOf(id);
    checkSettingValues(definition, 'instance', values, 'values');
    const updated = db
      .update(plugins)
      .set({ settings: values, updatedAt: now() })
      .where(eq(plugins.id, id))
      .returning()
      .get();
    return settingsResponse(definition, 'instance', updated.settings);
  });

  /** An enabled, ready plugin's definition, for what every user may see of it. */
  const availableDefinition = (id: string) => {
    const plugin = findPlugin(db, id);
    const definition = plugin && isAvailable(plugin) ? registry.definition(id) : undefined;
    if (!definition) throw notFound('Plugin not found.');
    return definition;
  };
  const userValues = (userId: string, pluginId: string) =>
    db
      .select({ values: userPluginSettings.values })
      .from(userPluginSettings)
      .where(and(eq(userPluginSettings.userId, userId), eq(userPluginSettings.pluginId, pluginId)))
      .get()?.values ?? {};

  // User settings (ADR-075): each user's own, for every table that uses the plugin.
  app.get('/api/v1/me/plugins/:id/settings', (request): PluginSettingsResponse => {
    const session = requireSession(request);
    const { id } = parseInput(idParams, request.params);
    const definition = availableDefinition(id);
    return settingsResponse(definition, 'user', userValues(session.user.id, id));
  });

  app.patch('/api/v1/me/plugins/:id/settings', (request): PluginSettingsResponse => {
    const session = requireSession(request);
    const { id } = parseInput(idParams, request.params);
    const { values } = parseInput(updatePluginSettingsBody, request.body);
    const definition = availableDefinition(id);
    checkSettingValues(definition, 'user', values, 'values');
    db.insert(userPluginSettings)
      .values({ userId: session.user.id, pluginId: id, values })
      .onConflictDoUpdate({
        target: [userPluginSettings.userId, userPluginSettings.pluginId],
        set: { values },
      })
      .run();
    return settingsResponse(definition, 'user', values);
  });

  // The modules GMs may add to a table (ADR-075): enabled and ready, any signed-in user.
  app.get('/api/v1/modules', (request) => {
    requireSession(request);
    const modules = listPlugins(db)
      .filter((plugin) => plugin.kind === 'module' && isAvailable(plugin))
      .map(({ id, name, version, description }) => ({ id, name, version, description }));
    return { modules };
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
