import { describe, expect, it } from 'vitest';

import {
  sceneResponseSchema,
  tokenListResponseSchema,
  type ActorView,
  type SceneView,
  type TokenView,
} from '@vtt/shared/api';

import type { Client } from './support/app.js';
import { openSocket } from './support/socket.js';
import { setupTable, type TableSetup } from './support/table.js';

// T-1403 (FR-MAP-03, ADR-068): tokens on a scene. GMs place, hide and remove them; owners of
// an actor move its tokens; hidden tokens and the tokens of other scenes never reach players.

async function scene(t: TableSetup, name: string, active = true): Promise<SceneView> {
  const res = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/scenes`, {
    name,
    columns: 10,
    rows: 8,
  });
  expect(res.statusCode, res.body).toBe(201);
  const created = sceneResponseSchema.parse(res.json()).scene;
  if (active) {
    await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/scenes/active`, {
      sceneId: created.id,
    });
  }
  return created;
}

async function actor(t: TableSetup, client: Client, body: Record<string, unknown>) {
  const res = await t.call(client, 'POST', `/tables/${t.table.id}/actors`, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ actor: ActorView }>().actor;
}

async function place(
  t: TableSetup,
  sceneId: string,
  body: Record<string, unknown>,
): Promise<TokenView> {
  const res = await t.call(t.gm.client, 'POST', `/scenes/${sceneId}/tokens`, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ token: TokenView }>().token;
}

async function tokens(t: TableSetup, client: Client, sceneId: string) {
  const res = await t.call(client, 'GET', `/scenes/${sceneId}/tokens`);
  expect(res.statusCode, res.body).toBe(200);
  return tokenListResponseSchema.parse(res.json()).tokens;
}

const move = (t: TableSetup, client: Client, id: string, column: number, row: number) =>
  t.call(client, 'PATCH', `/tokens/${id}`, { column, row });

describe('tokens (T-1403)', () => {
  it("places actors' tokens and standing-alone ones, with the actor's name and image", async () => {
    const t = await setupTable();
    const cave = await scene(t, 'Cave');
    const ayla = await actor(t, t.bob.client, {
      type: 'character',
      name: 'Ayla',
      imageUrl: 'https://example.com/ayla.png',
    });
    const mine = await place(t, cave.id, { actorId: ayla.id, column: 2, row: 3 });
    expect(mine).toMatchObject({
      actorId: ayla.id,
      name: 'Ayla',
      imageUrl: 'https://example.com/ayla.png',
      column: 2,
      row: 3,
      hidden: false,
      movable: true,
    });
    await place(t, cave.id, { name: 'Boulder', column: 0, row: 0 });

    // The token follows its actor's name.
    await t.call(t.bob.client, 'PATCH', `/actors/${ayla.id}`, { name: 'Ayla the Bold' });
    const seen = await tokens(t, t.bob.client, cave.id);
    expect(seen.map((token) => [token.name, token.movable])).toEqual([
      ['Ayla the Bold', true],
      ['Boulder', false],
    ]);

    // Cells must be on the scene; actors must be of the table.
    const off = await t.call(t.gm.client, 'POST', `/scenes/${cave.id}/tokens`, {
      name: 'Far',
      column: 10,
      row: 0,
    });
    expect(off.json()).toMatchObject({ error: { code: 'token_off_scene' } });
    const stranger = await t.call(t.gm.client, 'POST', `/scenes/${cave.id}/tokens`, {
      actorId: '00000000-0000-4000-8000-000000000000',
      column: 1,
      row: 1,
    });
    expect(stranger.json()).toMatchObject({ error: { code: 'unknown_actor' } });
  });

  it('lets owners move their tokens and nothing else', async () => {
    const t = await setupTable();
    const cave = await scene(t, 'Cave');
    const ayla = await actor(t, t.bob.client, { type: 'character', name: 'Ayla' });
    const token = await place(t, cave.id, { actorId: ayla.id, column: 0, row: 0 });
    const boulder = await place(t, cave.id, { name: 'Boulder', column: 5, row: 5 });

    const moved = await move(t, t.bob.client, token.id, 4, 2);
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toMatchObject({ token: { column: 4, row: 2 } });
    // Bob may only move it, and only on the scene.
    expect(
      (await t.call(t.bob.client, 'PATCH', `/tokens/${token.id}`, { hidden: true })).statusCode,
    ).toBe(403);
    expect((await move(t, t.bob.client, token.id, 4, 8)).statusCode).toBe(422);
    // Not other players' tokens, nor tokens standing alone, nor as a spectator.
    expect((await move(t, t.carol.client, token.id, 1, 1)).statusCode).toBe(403);
    expect((await move(t, t.bob.client, boulder.id, 1, 1)).statusCode).toBe(403);
    expect((await move(t, t.dave.client, token.id, 1, 1)).statusCode).toBe(403);
    expect((await t.call(t.bob.client, 'DELETE', `/tokens/${token.id}`)).statusCode).toBe(403);
    expect(
      (
        await t.call(t.bob.client, 'POST', `/scenes/${cave.id}/tokens`, {
          name: 'X',
          column: 0,
          row: 0,
        })
      ).statusCode,
    ).toBe(403);
    // The GM moves any, and removes them.
    expect((await move(t, t.gm.client, boulder.id, 1, 1)).statusCode).toBe(200);
    expect((await t.call(t.gm.client, 'DELETE', `/tokens/${boulder.id}`)).statusCode).toBe(204);
    expect((await tokens(t, t.gm.client, cave.id)).map((x) => x.name)).toEqual(['Ayla']);
    // Outsiders cannot tell the token exists.
    expect((await move(t, t.eve.client, token.id, 1, 1)).statusCode).toBe(404);
  });

  it('keeps hidden tokens and inactive scenes from players', async () => {
    const t = await setupTable();
    const cave = await scene(t, 'Cave');
    const lair = await scene(t, 'Lair', false);
    const ayla = await actor(t, t.bob.client, { type: 'character', name: 'Ayla' });
    const ambush = await place(t, cave.id, { name: 'Assassin', column: 1, row: 1, hidden: true });
    const own = await place(t, cave.id, { actorId: ayla.id, column: 2, row: 2, hidden: true });
    await place(t, lair.id, { name: 'Dragon', column: 1, row: 1 });

    expect(await tokens(t, t.bob.client, cave.id)).toEqual([]);
    expect((await t.call(t.bob.client, 'GET', `/scenes/${lair.id}/tokens`)).statusCode).toBe(404);
    expect((await move(t, t.bob.client, ambush.id, 3, 3)).statusCode).toBe(404);
    // A hidden token of Bob's own actor stays put too.
    expect((await move(t, t.bob.client, own.id, 3, 3)).statusCode).toBe(404);
    expect((await tokens(t, t.gm.client, cave.id)).map((x) => [x.name, x.hidden])).toEqual([
      ['Assassin', true],
      ['Ayla', true],
    ]);

    await t.call(t.gm.client, 'PATCH', `/tokens/${own.id}`, { hidden: false });
    expect((await tokens(t, t.bob.client, cave.id)).map((x) => x.name)).toEqual(['Ayla']);
    // Tokens of an actor in the trash leave the scene until it comes back.
    await t.call(t.bob.client, 'DELETE', `/actors/${ayla.id}`);
    expect(await tokens(t, t.bob.client, cave.id)).toEqual([]);
  });

  it('never sends hidden tokens or their moves to players on the wire', async () => {
    const t = await setupTable();
    const cave = await scene(t, 'Cave');
    const socket = await openSocket(t.app, t.bob.client);
    await socket.request({ type: 'subscribe', tableId: t.table.id });
    const gmSocket = await openSocket(t.app, t.gm.client);
    await gmSocket.request({ type: 'subscribe', tableId: t.table.id });
    const outsider = await openSocket(t.app, t.eve.client);
    const updates = async (s: typeof socket) => {
      await s.flush();
      return s.ofType('token.updated').length;
    };

    const hidden = await place(t, cave.id, { name: 'Assassin', column: 1, row: 1, hidden: true });
    await move(t, t.gm.client, hidden.id, 2, 2);
    expect(await updates(socket)).toBe(0);
    expect(await updates(gmSocket)).toBe(2);

    const shown = await place(t, cave.id, { name: 'Guard', column: 3, row: 3 });
    await move(t, t.gm.client, shown.id, 4, 4);
    // Changing the assassin while it stays hidden still tells players nothing.
    await t.call(t.gm.client, 'PATCH', `/tokens/${hidden.id}`, { hidden: true, column: 5 });
    expect(await updates(socket)).toBe(2);
    expect(socket.ofType('token.updated').every((e) => e.payload.sceneId === cave.id)).toBe(true);

    const fetched = await t.call(t.bob.client, 'GET', `/scenes/${cave.id}/tokens`);
    const wire = JSON.stringify(socket.received) + fetched.body;
    expect(wire).toContain('Guard');
    expect(wire).not.toContain('Assassin');
    expect(wire).not.toContain(hidden.id);

    await t.call(t.gm.client, 'PATCH', `/tokens/${hidden.id}`, { hidden: false });
    expect(await updates(socket)).toBe(3);
    expect((await tokens(t, t.bob.client, cave.id)).map((x) => x.name)).toEqual([
      'Assassin',
      'Guard',
    ]);
    await outsider.flush();
    expect(outsider.ofType('token.updated')).toEqual([]);
    for (const s of [socket, gmSocket, outsider]) s.ws.close();
  });

  it('refuses changes on an archived table, and goes with its scene', async () => {
    const t = await setupTable();
    const cave = await scene(t, 'Cave');
    const token = await place(t, cave.id, { name: 'Guard', column: 0, row: 0 });
    await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/archive`);
    expect((await move(t, t.gm.client, token.id, 1, 1)).statusCode).toBe(409);
    await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/unarchive`);
    expect((await t.call(t.gm.client, 'DELETE', `/scenes/${cave.id}`)).statusCode).toBe(204);
    expect((await move(t, t.gm.client, token.id, 1, 1)).statusCode).toBe(404);
  });

  it('stands tokens anywhere on a gridless scene, and on whole cells once it has a grid', async () => {
    const t = await setupTable();
    const field = await scene(t, 'Field');
    const rock = await place(t, field.id, { name: 'Rock', column: 2, row: 3 });

    // A gridded scene takes whole cells only.
    expect((await move(t, t.gm.client, rock.id, 2.5, 3)).json()).toMatchObject({
      error: { code: 'token_off_grid' },
    });
    const hidden = await t.call(t.gm.client, 'PATCH', `/scenes/${field.id}`, {
      gridType: 'hidden',
    });
    expect(hidden.statusCode, hidden.body).toBe(200);
    expect((await move(t, t.gm.client, rock.id, 2.5, 3)).statusCode).toBe(422);

    await t.call(t.gm.client, 'PATCH', `/scenes/${field.id}`, { gridType: 'none' });
    // Past the cells too, on a background that may reach beyond them.
    expect((await move(t, t.gm.client, rock.id, 30.5, 0)).statusCode).toBe(200);
    expect((await move(t, t.gm.client, rock.id, 2.5, 6.75)).statusCode).toBe(200);
    const boulder = await place(t, field.id, { name: 'Boulder', column: 40.25, row: 1 });
    expect(await tokens(t, t.bob.client, field.id)).toMatchObject([
      { column: 2.5, row: 6.75 },
      { column: 40.25, row: 1 },
    ]);

    // Given a grid again, the scene moves its tokens to the nearest cells.
    await t.call(t.gm.client, 'PATCH', `/scenes/${field.id}`, { gridType: 'square' });
    expect(await tokens(t, t.bob.client, field.id)).toMatchObject([
      { column: 3, row: 7 },
      { id: boulder.id, column: 9, row: 1 },
    ]);
  });
});
