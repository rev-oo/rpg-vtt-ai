import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AdminPlugin } from '@vtt/shared/api';

import { plugins } from '../src/db/schema.js';

import {
  authHeaders,
  createTestApp,
  createUserClient,
  setupAdmin,
  type Client,
  type TestApp,
} from './support/app.js';
import { copyReferencePlugin } from './support/reference.js';
import { setupTable } from './support/table.js';

let dataDir: string;
let pluginsDir: string;
let t: TestApp;
let admin: Client;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'vtt-plugins-'));
  pluginsDir = path.join(dataDir, 'plugins');
  t = await createTestApp({ env: { DATA_DIR: dataDir } });
  admin = await setupAdmin(t.app);
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

/** Copies a reference plugin into `DATA_DIR/plugins`, optionally under another folder name. */
async function install(id: string, folder = id): Promise<string> {
  const target = path.join(pluginsDir, folder);
  await copyReferencePlugin(id, target);
  return target;
}

async function editJson(file: string, change: (data: Record<string, unknown>) => void) {
  const data = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  change(data);
  await writeFile(file, JSON.stringify(data));
}

async function call(method: 'GET' | 'POST', url: string, payload?: object, client = admin) {
  return t.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: authHeaders(client),
    ...(payload && { payload }),
  });
}

async function rescan(): Promise<Record<string, AdminPlugin>> {
  const res = await call('POST', '/plugins/rescan');
  expect(res.statusCode).toBe(200);
  const list = res.json<{ plugins: AdminPlugin[] }>().plugins;
  return Object.fromEntries(list.map((plugin) => [plugin.id, plugin]));
}

const systemIds = async () =>
  (await call('GET', '/systems')).json<{ systems: { id: string }[] }>().systems.map((s) => s.id);

describe('plugin scanner and registry (T-0403)', () => {
  it('lists nothing before any plugin folder exists', async () => {
    expect((await call('GET', '/plugins')).json()).toEqual({ plugins: [] });
    expect(await rescan()).toEqual({});
  });

  it('picks up a folder added while running, without a restart (FR-PLUGIN-01)', async () => {
    await install('tiny-d20');
    expect(Object.keys(await rescan())).toEqual(['tiny-d20']);

    await install('tiny-pool');
    const found = await rescan();
    expect(Object.keys(found).sort()).toEqual(['tiny-d20', 'tiny-pool']);
    expect(found['tiny-pool']).toMatchObject({
      name: 'Tiny Pool',
      version: '0.1.0',
      coreApi: '^0.1.0',
      status: 'ready',
      enabled: false,
      available: false,
      hasCode: false,
      codeEntries: [],
      issues: [],
    });
    expect((await call('GET', '/plugins')).json<{ plugins: AdminPlugin[] }>().plugins).toHaveLength(
      2,
    );
  });

  it('stores the declared actor and item types for the entity API (ADR-015)', async () => {
    await install('tiny-d20');
    await rescan();
    const row = t.db.select().from(plugins).where(eq(plugins.id, 'tiny-d20')).get();
    expect(row?.actorTypes).toEqual({
      character: { controlledBy: 'player' },
      npc: { controlledBy: 'gm' },
    });
    expect(row?.itemTypes).toEqual(['weapon']);
    expect(row?.scannedAt).toBeInstanceOf(Date);
  });

  it('enables and disables plugins, which controls the system picker (FR-PLUGIN-07)', async () => {
    await install('tiny-d20');
    await rescan();
    expect(await systemIds()).toEqual([]);

    const enabled = await call('POST', '/plugins/tiny-d20/enable', {});
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json<{ plugin: AdminPlugin }>().plugin).toMatchObject({
      enabled: true,
      available: true,
    });
    expect(await systemIds()).toEqual(['tiny-d20']);

    // A rescan keeps the admin's choice.
    expect((await rescan())['tiny-d20']?.enabled).toBe(true);

    const disabled = await call('POST', '/plugins/tiny-d20/disable');
    expect(disabled.json<{ plugin: AdminPlugin }>().plugin.enabled).toBe(false);
    expect(await systemIds()).toEqual([]);
  });

  it('reports invalid plugins with their issues and refuses to enable them', async () => {
    const folder = await install('tiny-pool', 'pool-copy');
    await editJson(path.join(folder, 'rolls.json'), (rolls) => {
      rolls.pool = { formula: '(@derived.pool)d6cs>=' };
    });
    const plugin = (await rescan())['pool-copy'];
    expect(plugin?.status).toBe('invalid');
    expect(plugin?.name).toBe('Tiny Pool');
    expect(plugin?.issues.map((issue) => `${issue.code} ${issue.file}`)).toEqual([
      'folder_mismatch plugin.json',
      'invalid_formula rolls.json',
    ]);

    const res = await call('POST', '/plugins/pool-copy/enable', {});
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'plugin_not_ready' } });
  });

  it('lists a plugin for another core API as incompatible (FR-PLUGIN-03)', async () => {
    const folder = await install('tiny-pool');
    await editJson(path.join(folder, 'plugin.json'), (manifest) => {
      manifest.coreApi = '^9.0.0';
    });
    const plugin = (await rescan())['tiny-pool'];
    expect(plugin).toMatchObject({ status: 'incompatible', available: false });
    expect(plugin?.issues[0]).toMatchObject({
      code: 'incompatible_core_api',
      params: { coreApi: '^9.0.0', core: '0.1.0' },
    });
  });

  it('marks a removed folder as missing and keeps its row for its tables', async () => {
    await install('tiny-d20');
    await rescan();
    await call('POST', '/plugins/tiny-d20/enable', {});
    await rm(path.join(pluginsDir, 'tiny-d20'), { recursive: true });

    const plugin = (await rescan())['tiny-d20'];
    expect(plugin).toMatchObject({
      status: 'missing',
      enabled: true,
      available: false,
      issues: [],
    });
    expect(await systemIds()).toEqual([]);
  });

  it('keeps the last good types while a plugin is broken', async () => {
    const folder = await install('tiny-d20');
    await rescan();
    await rm(path.join(folder, 'types/items/weapon.json'));
    await writeFile(path.join(folder, 'types/actors/npc.json'), '{');
    expect((await rescan())['tiny-d20']?.status).toBe('invalid');
    const row = t.db.select().from(plugins).where(eq(plugins.id, 'tiny-d20')).get();
    expect(row?.itemTypes).toEqual(['weapon']);
  });

  it('needs an acknowledgement to enable a plugin with code (FR-PLUGIN-06)', async () => {
    const folder = await install('tiny-pool');
    await mkdir(path.join(folder, 'code'));
    await writeFile(path.join(folder, 'code/client.js'), 'export {};');
    await editJson(path.join(folder, 'plugin.json'), (manifest) => {
      manifest.hasCode = true;
    });
    const plugin = (await rescan())['tiny-pool'];
    expect(plugin).toMatchObject({
      status: 'ready',
      hasCode: true,
      codeEntries: ['code/client.js'],
    });

    const refused = await call('POST', '/plugins/tiny-pool/enable', {});
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ error: { code: 'code_not_acknowledged' } });
    const accepted = await call('POST', '/plugins/tiny-pool/enable', { acknowledgeCode: true });
    expect(accepted.json<{ plugin: AdminPlugin }>().plugin.enabled).toBe(true);
  });

  it('disables an enabled plugin that gains code until an admin enables it again', async () => {
    const folder = await install('tiny-pool');
    await rescan();
    await call('POST', '/plugins/tiny-pool/enable', {});
    await mkdir(path.join(folder, 'code'));
    await writeFile(path.join(folder, 'code/server.js'), 'export {};');
    await editJson(path.join(folder, 'plugin.json'), (manifest) => {
      manifest.hasCode = true;
    });
    expect((await rescan())['tiny-pool']).toMatchObject({ hasCode: true, enabled: false });
  });

  it('ignores folders whose name is not a plugin id, and loose files', async () => {
    await install('tiny-pool', '.backup');
    await install('tiny-pool', 'Tiny Pool');
    await writeFile(path.join(pluginsDir, 'notes.json'), '{}');
    expect(await rescan()).toEqual({});
  });

  it('does not follow symbolic links out of the plugin folder', async () => {
    const folder = await install('tiny-d20');
    const outside = path.join(dataDir, 'outside.json');
    await writeFile(
      outside,
      JSON.stringify({ label: 'Gem', sheet: 'weapon', schema: { type: 'object', properties: {} } }),
    );
    await symlink(outside, path.join(folder, 'types/items/gem.json'));
    expect((await rescan())['tiny-d20']?.status).toBe('ready');
    const row = t.db.select().from(plugins).where(eq(plugins.id, 'tiny-d20')).get();
    expect(row?.itemTypes).toEqual(['weapon']);
  });

  it('reports JSON files that are too large without reading them', async () => {
    const folder = await install('tiny-pool');
    await writeFile(path.join(folder, 'lang/en.json'), `{"x": "${'a'.repeat(1024 * 1024)}"}`);
    const plugin = (await rescan())['tiny-pool'];
    expect(plugin?.status).toBe('invalid');
    expect(plugin?.issues).toContainEqual(
      expect.objectContaining({ code: 'file_too_large', file: 'lang/en.json' }),
    );
  });

  it('runs concurrent rescans one after the other', async () => {
    await install('tiny-d20');
    const results = await Promise.all([
      call('POST', '/plugins/rescan'),
      call('POST', '/plugins/rescan'),
    ]);
    expect(results.map((res) => res.statusCode)).toEqual([200, 200]);
    expect(t.db.select().from(plugins).all()).toHaveLength(1);
  });

  it('is for admins only, and checks plugin ids', async () => {
    const { client: player } = await createUserClient(t.app, admin, 'player');
    for (const [method, url] of [
      ['GET', '/plugins'],
      ['POST', '/plugins/rescan'],
      ['POST', '/plugins/tiny-d20/enable'],
      ['POST', '/plugins/tiny-d20/disable'],
    ] as const) {
      expect((await call(method, url, {}, player)).statusCode).toBe(403);
    }
    expect((await call('POST', '/plugins/nope/enable', {})).statusCode).toBe(404);
    expect((await call('POST', '/plugins/nope/disable')).statusCode).toBe(404);
    expect((await call('POST', '/plugins/Bad_Id/enable', {})).statusCode).toBe(400);
  });
});

describe('tables of an unavailable system are read-only (FR-PLUGIN-07)', () => {
  it('refuses entity changes and rolls, but still allows reading and chat', async () => {
    const s = await setupTable();
    const base = `/tables/${s.table.id}`;
    const actor = await s.call(s.gm.client, 'POST', `${base}/actors`, { type: 'npc', name: 'Orc' });
    expect(actor.statusCode).toBe(201);
    const actorId = actor.json<{ actor: { id: string } }>().actor.id;
    const item = await s.call(s.gm.client, 'POST', `${base}/items`, {
      type: 'weapon',
      name: 'Axe',
    });
    const itemId = item.json<{ item: { id: string } }>().item.id;

    for (const change of [{ enabled: false }, { enabled: true, status: 'missing' as const }]) {
      s.db.update(plugins).set(change).where(eq(plugins.id, 'test-system')).run();
      const refused = [
        await s.call(s.gm.client, 'POST', `${base}/actors`, { type: 'npc', name: 'Orc 2' }),
        await s.call(s.gm.client, 'PATCH', `/actors/${actorId}`, { name: 'Ogre' }),
        await s.call(s.gm.client, 'POST', `/actors/${actorId}/duplicate`),
        await s.call(s.gm.client, 'DELETE', `/actors/${actorId}`),
        await s.call(s.gm.client, 'POST', `${base}/items`, { type: 'weapon', name: 'Sword' }),
        await s.call(s.gm.client, 'PATCH', `/items/${itemId}`, { name: 'Big axe' }),
        await s.call(s.gm.client, 'POST', `${base}/rolls`, { formula: '1d20' }),
      ];
      expect(refused.map((res) => res.statusCode)).toEqual(Array<number>(refused.length).fill(409));
      expect(refused[0]?.json()).toMatchObject({ error: { code: 'table_read_only' } });

      expect((await s.call(s.gm.client, 'GET', `${base}/actors`)).statusCode).toBe(200);
      expect((await s.call(s.gm.client, 'GET', `${base}/types`)).statusCode).toBe(200);
      const chat = await s.call(s.gm.client, 'POST', `${base}/messages`, {
        text: 'hi',
      });
      expect(chat.statusCode).toBe(201);
    }
    await s.app.close();
  });
});
