import { describe, expect, it } from 'vitest';

import {
  MAX_SCENES,
  sceneListResponseSchema,
  sceneResponseSchema,
  type SceneView,
} from '@vtt/shared/api';

import { scenes as scenesTable } from '../src/db/schema.js';

import { authHeaders, type Client } from './support/app.js';
import { openSocket } from './support/socket.js';
import { setupTable, type TableSetup } from './support/table.js';

// T-1401 (FR-MAP-01, ADR-066): a table's scenes, prepared by GMs and assistants; players and
// spectators see only the active one.

const list = async (t: TableSetup, client: Client): Promise<string[]> => {
  const res = await t.call(client, 'GET', `/tables/${t.table.id}/scenes`);
  expect(res.statusCode, res.body).toBe(200);
  return sceneListResponseSchema.parse(res.json()).scenes.map((scene) => scene.name);
};

async function create(
  t: TableSetup,
  body: Record<string, unknown>,
  client: Client = t.gm.client,
): Promise<SceneView> {
  const res = await t.call(client, 'POST', `/tables/${t.table.id}/scenes`, body);
  expect(res.statusCode, res.body).toBe(201);
  return sceneResponseSchema.parse(res.json()).scene;
}

const activate = (t: TableSetup, sceneId: string | null, client: Client = t.gm.client) =>
  t.call(client, 'POST', `/tables/${t.table.id}/scenes/active`, { sceneId });

/** A 1×1 PNG, uploaded to the table. */
async function upload(t: TableSetup): Promise<string> {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/v1/tables/${t.table.id}/assets?name=cave.png`,
    payload: png,
    headers: { ...authHeaders(t.gm.client), 'content-type': 'image/png' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ asset: { url: string } }>().asset.url;
}

const sceneRow = (tableId: string, sort: number) => ({
  id: crypto.randomUUID(),
  tableId,
  name: `Scene ${String(sort)}`,
  columns: 10,
  rows: 10,
  gridType: 'square' as const,
  gridSize: 50,
  sort,
});

describe('scenes (T-1401)', () => {
  it('lets the GM create, edit, order and delete scenes', async () => {
    const t = await setupTable();
    const cave = await create(t, { name: 'Cave' });
    expect(cave).toMatchObject({
      tableId: t.table.id,
      backgroundUrl: null,
      columns: 30,
      rows: 20,
      gridType: 'square',
      gridSize: 70,
      cellDistance: 5,
      distanceUnit: 'ft',
      diagonals: 'one',
      active: false,
    });
    const town = await create(t, {
      name: 'Town',
      backgroundUrl: 'https://example.com/town.jpg',
      columns: 40,
      rows: 25,
      gridType: 'hex',
      gridSize: 50,
    });
    const keep = await create(t, { name: 'Keep', gridType: 'none' });
    expect(keep.gridType).toBe('none');
    expect(await list(t, t.gm.client)).toEqual(['Cave', 'Town', 'Keep']);

    const edited = await t.call(t.gm.client, 'PATCH', `/scenes/${cave.id}`, {
      name: 'Deep cave',
      gridSize: 100,
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(sceneResponseSchema.parse(edited.json()).scene).toMatchObject({
      name: 'Deep cave',
      gridSize: 100,
      columns: 30,
    });

    // The ruler's scale and diagonal rule (ADR-069).
    const measured = await t.call(t.gm.client, 'PATCH', `/scenes/${cave.id}`, {
      cellDistance: 1.5,
      distanceUnit: ' m ',
      diagonals: 'alternate',
    });
    expect(sceneResponseSchema.parse(measured.json()).scene).toMatchObject({
      cellDistance: 1.5,
      distanceUnit: 'm',
      diagonals: 'alternate',
    });
    const unscaled = await t.call(t.gm.client, 'PATCH', `/scenes/${cave.id}`, {
      cellDistance: 0,
    });
    expect(unscaled.statusCode).toBe(400);

    const ordered = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/scenes/order`, {
      sceneIds: [keep.id, cave.id, town.id],
    });
    expect(ordered.statusCode, ordered.body).toBe(200);
    expect(await list(t, t.gm.client)).toEqual(['Keep', 'Deep cave', 'Town']);
    // The order must name every scene once.
    const partial = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/scenes/order`, {
      sceneIds: [keep.id, cave.id],
    });
    expect(partial.statusCode).toBe(422);
    expect(partial.json()).toMatchObject({ error: { code: 'scene_order_mismatch' } });

    const deleted = await t.call(t.gm.client, 'DELETE', `/scenes/${keep.id}`);
    expect(deleted.statusCode).toBe(204);
    expect(await list(t, t.gm.client)).toEqual(['Deep cave', 'Town']);
    expect((await t.call(t.gm.client, 'GET', `/scenes/${keep.id}`)).statusCode).toBe(404);
    // New scenes still go last.
    await create(t, { name: 'Tower' });
    expect(await list(t, t.gm.client)).toEqual(['Deep cave', 'Town', 'Tower']);
  });

  it('shows players and spectators only the active scene', async () => {
    const t = await setupTable();
    const cave = await create(t, { name: 'Cave' });
    const town = await create(t, { name: 'Town' });
    expect(await list(t, t.bob.client)).toEqual([]);
    expect((await t.call(t.bob.client, 'GET', `/scenes/${cave.id}`)).statusCode).toBe(404);

    const res = await activate(t, cave.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(sceneListResponseSchema.parse(res.json()).scenes.map((s) => s.active)).toEqual([
      true,
      false,
    ]);
    expect(await list(t, t.bob.client)).toEqual(['Cave']);
    expect(await list(t, t.dave.client)).toEqual(['Cave']);
    expect((await t.call(t.dave.client, 'GET', `/scenes/${cave.id}`)).statusCode).toBe(200);
    expect((await t.call(t.dave.client, 'GET', `/scenes/${town.id}`)).statusCode).toBe(404);

    // Activating another scene replaces it; `null` shows none.
    await activate(t, town.id);
    expect(await list(t, t.bob.client)).toEqual(['Town']);
    expect(await list(t, t.gm.client)).toEqual(['Cave', 'Town']);
    await activate(t, null);
    expect(await list(t, t.carol.client)).toEqual([]);
  });

  it('keeps players, spectators and outsiders from changing scenes', async () => {
    const t = await setupTable();
    const cave = await create(t, { name: 'Cave' });
    await activate(t, cave.id);
    for (const member of [t.bob, t.dave]) {
      const made = await t.call(member.client, 'POST', `/tables/${t.table.id}/scenes`, {
        name: 'Mine',
      });
      expect(made.statusCode).toBe(403);
      expect(
        (await t.call(member.client, 'PATCH', `/scenes/${cave.id}`, { name: 'X' })).statusCode,
      ).toBe(403);
      expect((await t.call(member.client, 'DELETE', `/scenes/${cave.id}`)).statusCode).toBe(403);
      expect((await activate(t, null, member.client)).statusCode).toBe(403);
    }
    // Outsiders cannot even tell the scene or the table exists.
    expect((await t.call(t.eve.client, 'GET', `/scenes/${cave.id}`)).statusCode).toBe(404);
    expect((await t.call(t.eve.client, 'GET', `/tables/${t.table.id}/scenes`)).statusCode).toBe(
      404,
    );
    expect(
      (await t.call(t.eve.client, 'PATCH', `/scenes/${cave.id}`, { name: 'X' })).statusCode,
    ).toBe(404);
  });

  it('checks the fields, the background and the limit', async () => {
    const t = await setupTable();
    const bad = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/scenes`, {
      name: 'Bad',
      columns: 0,
      gridType: 'triangle',
      backgroundUrl: 'javascript:alert(1)',
    });
    expect(bad.statusCode).toBe(400);
    // An uploaded background must be an asset of this table.
    const foreign = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/scenes`, {
      name: 'Elsewhere',
      backgroundUrl: '/api/v1/assets/00000000-0000-4000-8000-000000000000',
    });
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json()).toMatchObject({ error: { code: 'unknown_asset' } });

    for (let i = 0; i < MAX_SCENES; i += 1) {
      t.db.insert(scenesTable).values(sceneRow(t.table.id, i)).run();
    }
    const over = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/scenes`, {
      name: 'One too many',
    });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ error: { code: 'too_many_scenes' } });
  });

  it("keeps a scene's background image from being deleted", async () => {
    const t = await setupTable();
    const url = await upload(t);
    const cave = await create(t, { name: 'Cave', backgroundUrl: url });
    expect(cave.backgroundUrl).toBe(url);
    const refused = await t.call(t.gm.client, 'DELETE', url.replace('/api/v1', ''));
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      error: { details: { uses: [{ kind: 'scene', id: cave.id, name: 'Cave' }] } },
    });
    await t.call(t.gm.client, 'PATCH', `/scenes/${cave.id}`, { backgroundUrl: null });
    expect((await t.call(t.gm.client, 'DELETE', url.replace('/api/v1', ''))).statusCode).toBe(204);
  });

  it('refuses changes on an archived table', async () => {
    const t = await setupTable();
    const cave = await create(t, { name: 'Cave' });
    expect((await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/archive`)).statusCode).toBe(
      200,
    );
    const res = await t.call(t.gm.client, 'PATCH', `/scenes/${cave.id}`, { name: 'X' });
    expect(res.statusCode).toBe(409);
    expect(await list(t, t.gm.client)).toEqual(['Cave']);
  });

  it('tells the table of each change with scene.updated', async () => {
    const t = await setupTable();
    const socket = await openSocket(t.app, t.bob.client);
    await socket.request({ type: 'subscribe', tableId: t.table.id });
    const outsider = await openSocket(t.app, t.eve.client);
    const changes = async () => {
      await socket.flush();
      return socket.ofType('scene.updated').length;
    };

    const secret = await create(t, { name: 'Secret lair' });
    expect(await changes()).toBe(1);
    const cave = await create(t, { name: 'Cave' });
    await t.call(t.gm.client, 'PATCH', `/scenes/${secret.id}`, { gridSize: 60 });
    await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/scenes/order`, {
      sceneIds: [cave.id, secret.id],
    });
    await activate(t, cave.id);
    await t.call(t.gm.client, 'DELETE', `/scenes/${secret.id}`);
    expect(await changes()).toBe(6);
    expect(socket.ofType('scene.updated').every((e) => e.tableId === t.table.id)).toBe(true);

    // The events carry nothing, and what Bob refetches leaves out the inactive scene.
    const fetched = await t.call(t.bob.client, 'GET', `/tables/${t.table.id}/scenes`);
    const wire = JSON.stringify(socket.received) + fetched.body;
    expect(wire).toContain('Cave');
    expect(wire).not.toContain('Secret lair');

    await outsider.flush();
    expect(outsider.ofType('scene.updated')).toEqual([]);
    socket.ws.close();
    outsider.ws.close();
  });
});
