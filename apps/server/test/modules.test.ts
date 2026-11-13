import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AdminPlugin, PluginSettingsResponse, TableModule, TableView } from '@vtt/shared/api';

import {
  authHeaders,
  createTable,
  createUserClient,
  type Client,
  type TestApp,
} from './support/app.js';
import { startWithSystems, systemsDir, tableWithPlayer } from './support/systems.js';

// Module plugins and plugin settings by scope (T-1601, ADR-075).

const MODULE = 'glow';

/** Writes a small module: settings of every scope, a text and client code. */
async function writeModule(dataDir: string): Promise<void> {
  const dir = path.join(dataDir, 'plugins', MODULE);
  await mkdir(path.join(dir, 'lang'), { recursive: true });
  await mkdir(path.join(dir, 'code'), { recursive: true });
  const json = (file: string, data: unknown) =>
    writeFile(path.join(dir, file), JSON.stringify(data));
  await json('plugin.json', {
    id: MODULE,
    name: 'Glow',
    version: '1.0.0',
    kind: 'module',
    coreApi: '^1.0.0',
    hasCode: true,
    locales: ['en'],
  });
  await json('settings.json', {
    bright: { type: 'boolean', default: true, label: 'setting.bright' },
    colour: { type: 'string', default: 'red', label: 'Colour', scope: 'user' },
    quality: {
      type: 'string',
      default: 'high',
      enum: ['low', 'high'],
      label: 'Quality',
      scope: 'instance',
    },
  });
  await json('lang/en.json', { 'setting.bright': 'Bright' });
  await json('theme.json', { light: { canvas: '#f4ecd8' }, background: 'images/paper.webp' });
  await mkdir(path.join(dir, 'styles'), { recursive: true });
  await mkdir(path.join(dir, 'images'), { recursive: true });
  await writeFile(path.join(dir, 'images', 'paper.webp'), 'RIFF');
  await writeFile(
    path.join(dir, 'styles', 'table.css'),
    '[data-vtt-part="chat"] { color: brown }\n.loose { color: red }',
  );
  await writeFile(path.join(dir, 'code', 'client.js'), 'export default {};');
}

let dataDir: string;
let t: TestApp;
let gm: Client;
let table: { id: string };
let player: Client;
let outsider: Client;

type Method = 'GET' | 'POST' | 'PATCH';
const call = (client: Client, method: Method, url: string, payload?: object) =>
  t.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: authHeaders(client),
    ...(payload && { payload }),
  });

beforeEach(async () => {
  dataDir = await systemsDir(['tiny-d20']);
  await writeModule(dataDir);
  ({ t, gm } = await startWithSystems(dataDir, ['tiny-d20']));
  const setup = await tableWithPlayer(t, gm, 'tiny-d20', 'player');
  table = setup.table;
  player = setup.player.client;
  outsider = (await createUserClient(t.app, gm, 'outsider')).client;
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

const enableModule = () => call(gm, 'POST', `/plugins/${MODULE}/enable`, { acknowledgeCode: true });

describe('module plugins', () => {
  it('are listed as modules, need the code acknowledged and are no system', async () => {
    const listed = (await call(gm, 'GET', '/plugins')).json<{ plugins: AdminPlugin[] }>();
    expect(listed.plugins.find((plugin) => plugin.id === MODULE)).toMatchObject({
      kind: 'module',
      status: 'ready',
      instanceSettings: true,
    });
    expect(listed.plugins.find((plugin) => plugin.id === 'tiny-d20')?.kind).toBe('system');

    expect((await call(gm, 'POST', `/plugins/${MODULE}/enable`, {})).statusCode).toBe(422);
    expect((await enableModule()).statusCode).toBe(200);

    const systems = (await call(player, 'GET', '/systems')).json<{ systems: { id: string }[] }>();
    expect(systems.systems.map((system) => system.id)).toEqual(['tiny-d20']);
    expect((await call(player, 'GET', `/systems/${MODULE}`)).statusCode).toBe(404);
    const created = await call(gm, 'POST', '/tables', { name: 'Odd', systemId: MODULE });
    expect(created.statusCode).toBe(422);

    const modules = await call(player, 'GET', '/modules');
    expect(modules.json()).toEqual({
      modules: [{ id: MODULE, name: 'Glow', version: '1.0.0', description: null }],
    });
  });

  it('are chosen per table by its GM, and load for its members only', async () => {
    const choose = (client: Client, body: object) =>
      call(client, 'PATCH', `/tables/${table.id}`, body);
    // Not enabled yet, or not a module.
    expect((await choose(gm, { modules: [MODULE] })).statusCode).toBe(422);
    await enableModule();
    expect((await choose(gm, { modules: ['tiny-d20'] })).statusCode).toBe(422);
    expect((await choose(player, { modules: [MODULE] })).statusCode).toBe(403);

    const chosen = await choose(gm, {
      modules: [MODULE, MODULE],
      moduleSettings: { [MODULE]: { bright: false } },
    });
    expect(chosen.statusCode, chosen.body).toBe(200);
    expect(chosen.json<{ table: TableView }>().table).toMatchObject({
      modules: [MODULE],
      moduleSettings: { [MODULE]: { bright: false } },
    });

    const loaded = await call(player, 'GET', `/tables/${table.id}/modules`);
    expect(loaded.statusCode).toBe(200);
    const [module] = loaded.json<{ modules: TableModule[] }>().modules;
    expect(module).toMatchObject({
      id: MODULE,
      styles: [`/plugins/${MODULE}/theme.css`, `/plugins/${MODULE}/styles/table.css`],
      client: `/plugins/${MODULE}/code/client.js`,
      settings: { bright: false, colour: 'red', quality: 'high' },
    });
    expect(module?.definition).toMatchObject({ manifest: { kind: 'module' } });

    // Tables hide from those who are not members.
    expect((await call(outsider, 'GET', `/tables/${table.id}/modules`)).statusCode).toBe(404);
    const other = await createTable(t.app, gm, { systemId: 'tiny-d20' });
    const none = await call(gm, 'GET', `/tables/${other.id}/modules`);
    expect(none.json()).toEqual({ modules: [] });

    // A module that is disabled again loads nowhere; the table keeps it.
    await call(gm, 'POST', `/plugins/${MODULE}/disable`);
    expect((await call(player, 'GET', `/tables/${table.id}/modules`)).json()).toEqual({
      modules: [],
    });
  });
});

describe('module themes and styles (T-1602, ADR-076)', () => {
  it('serves the theme as CSS and scopes stylesheets to named parts', async () => {
    await enableModule();
    const get = (url: string) => t.app.inject({ method: 'GET', url, headers: authHeaders(player) });
    const theme = await get(`/plugins/${MODULE}/theme.css`);
    expect(theme.statusCode).toBe(200);
    expect(theme.headers['content-type']).toContain('text/css');
    const root = `:root[data-vtt-modules~="${MODULE}"]`;
    expect(theme.body).toContain(`${root} {\n  --color-canvas: #f4ecd8;`);
    expect(theme.body).toContain(`url("/plugins/${MODULE}/images/paper.webp")`);

    const styles = await get(`/plugins/${MODULE}/styles/table.css`);
    expect(styles.body).toContain(`${root} [data-vtt-part="chat"] { color: brown }`);
    expect(styles.body).not.toContain('.loose');

    // Systems have no theme.
    expect((await get('/plugins/tiny-d20/theme.css')).statusCode).toBe(404);
    const plugins = (await call(gm, 'GET', '/plugins')).json<{ plugins: AdminPlugin[] }>();
    expect(plugins.plugins.find((plugin) => plugin.id === MODULE)?.issues).toEqual([
      expect.objectContaining({ code: 'css_part_required', file: 'styles/table.css' }),
    ]);
  });
});

describe('plugin settings by scope', () => {
  beforeEach(async () => {
    await enableModule();
    await call(gm, 'PATCH', `/tables/${table.id}`, { modules: [MODULE] });
  });

  const fails = (response: Awaited<ReturnType<typeof call>>, path: string) => {
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json<{ error: { details: { path: string }[] } }>().error.details).toEqual([
      expect.objectContaining({ path }),
    ]);
  };

  it('keeps instance settings, which only admins set', async () => {
    const url = `/plugins/${MODULE}/settings`;
    expect((await call(player, 'GET', url)).statusCode).toBe(403);
    expect((await call(player, 'PATCH', url, { values: { quality: 'low' } })).statusCode).toBe(403);
    fails(await call(gm, 'PATCH', url, { values: { quality: 'medium' } }), 'values.quality');
    fails(await call(gm, 'PATCH', url, { values: { bright: false } }), 'values.bright');

    const saved = await call(gm, 'PATCH', url, { values: { quality: 'low' } });
    expect(saved.statusCode).toBe(200);
    const body = saved.json<PluginSettingsResponse>();
    expect(Object.keys(body.definitions)).toEqual(['quality']);
    expect(body).toMatchObject({ values: { quality: 'low' }, defaultLocale: 'en' });
    expect((await call(gm, 'GET', url)).json()).toEqual(body);
  });

  it('keeps table settings, which only the GM sets, per table', async () => {
    const update = (client: Client, values: object) =>
      call(client, 'PATCH', `/tables/${table.id}`, { moduleSettings: { [MODULE]: values } });
    expect((await update(player, { bright: false })).statusCode).toBe(403);
    fails(await update(gm, { bright: 'yes' }), `moduleSettings.${MODULE}.bright`);
    fails(await update(gm, { colour: 'blue' }), `moduleSettings.${MODULE}.colour`);
    fails(
      await call(gm, 'PATCH', `/tables/${table.id}`, { moduleSettings: { other: {} } }),
      'moduleSettings.other',
    );
    expect((await update(gm, { bright: false })).statusCode).toBe(200);

    // Removing the module drops its settings.
    const removed = await call(gm, 'PATCH', `/tables/${table.id}`, { modules: [] });
    expect(removed.json<{ table: TableView }>().table.moduleSettings).toEqual({});
  });

  it("keeps each user's own settings, which reach that user only", async () => {
    const url = `/me/plugins/${MODULE}/settings`;
    expect((await call(player, 'GET', url)).json()).toMatchObject({ values: {} });
    fails(await call(player, 'PATCH', url, { values: { colour: 7 } }), 'values.colour');
    fails(await call(player, 'PATCH', url, { values: { quality: 'low' } }), 'values.quality');
    const saved = await call(player, 'PATCH', url, { values: { colour: 'blue' } });
    expect(saved.statusCode).toBe(200);
    expect((await call(player, 'GET', url)).json()).toMatchObject({ values: { colour: 'blue' } });

    await call(gm, 'PATCH', `/plugins/${MODULE}/settings`, { values: { quality: 'low' } });
    const settingsOf = async (client: Client) =>
      (await call(client, 'GET', `/tables/${table.id}/modules`)).json<{ modules: TableModule[] }>()
        .modules[0]?.settings;
    expect(await settingsOf(player)).toEqual({ bright: true, colour: 'blue', quality: 'low' });
    expect(await settingsOf(gm)).toEqual({ bright: true, colour: 'red', quality: 'low' });

    // Plugins that are not enabled have no user settings.
    expect((await call(player, 'GET', '/me/plugins/missing/settings')).statusCode).toBe(404);
  });
});
