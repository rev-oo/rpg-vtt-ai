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

// T-1404 (FR-MAP-04, ADR-070): fog of war. GMs reveal and hide areas; players get only the
// revealed areas and the tokens in them, save the tokens of actors they own.

async function foggedScene(t: TableSetup): Promise<SceneView> {
  const res = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/scenes`, {
    name: 'Crypt',
    columns: 10,
    rows: 8,
    fog: true,
  });
  expect(res.statusCode, res.body).toBe(201);
  const scene = sceneResponseSchema.parse(res.json()).scene;
  await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/scenes/active`, { sceneId: scene.id });
  return scene;
}

async function place(t: TableSetup, sceneId: string, body: Record<string, unknown>) {
  const res = await t.call(t.gm.client, 'POST', `/scenes/${sceneId}/tokens`, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ token: TokenView }>().token;
}

async function names(t: TableSetup, client: Client, sceneId: string) {
  const res = await t.call(client, 'GET', `/scenes/${sceneId}/tokens`);
  expect(res.statusCode, res.body).toBe(200);
  return tokenListResponseSchema.parse(res.json()).tokens.map((token) => token.name);
}

const fog = (t: TableSetup, client: Client, sceneId: string, body: Record<string, unknown>) =>
  t.call(client, 'POST', `/scenes/${sceneId}/fog`, body);

describe('fog of war (T-1404)', () => {
  it('reveals and hides areas, for GMs and assistants only', async () => {
    const t = await setupTable();
    const crypt = await foggedScene(t);
    expect(crypt).toMatchObject({ fog: true, revealed: [] });

    const area = { x: 0, y: 0, width: 4, height: 3 };
    expect((await fog(t, t.bob.client, crypt.id, { action: 'reveal', area })).statusCode).toBe(403);
    const res = await fog(t, t.gm.client, crypt.id, { action: 'reveal', area });
    expect(res.statusCode, res.body).toBe(200);
    expect(sceneResponseSchema.parse(res.json()).scene.revealed).toEqual([area]);

    const hidden = await fog(t, t.gm.client, crypt.id, {
      action: 'hide',
      area: { x: 0, y: 0, width: 2, height: 3 },
    });
    expect(sceneResponseSchema.parse(hidden.json()).scene.revealed).toEqual([
      { x: 2, y: 0, width: 2, height: 3 },
    ]);
    // Players read the revealed areas with the scene.
    const seen = await t.call(t.bob.client, 'GET', `/scenes/${crypt.id}`);
    expect(sceneResponseSchema.parse(seen.json()).scene.revealed).toHaveLength(1);

    const all = await fog(t, t.gm.client, crypt.id, { action: 'revealAll' });
    expect(sceneResponseSchema.parse(all.json()).scene.revealed).toEqual([
      { x: 0, y: 0, width: 200, height: 200 },
    ]);
    const none = await fog(t, t.gm.client, crypt.id, { action: 'hideAll' });
    expect(sceneResponseSchema.parse(none.json()).scene.revealed).toEqual([]);

    const bad = await fog(t, t.gm.client, crypt.id, {
      action: 'reveal',
      area: { x: -1, y: 0, width: 0, height: 1 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('keeps tokens in the fog, and their moves, from players on the wire', async () => {
    const t = await setupTable();
    const crypt = await foggedScene(t);
    const socket = await openSocket(t.app, t.bob.client);
    await socket.request({ type: 'subscribe', tableId: t.table.id });
    const updates = async () => {
      await socket.flush();
      return socket.ofType('token.updated').length;
    };

    const ghoul = await place(t, crypt.id, { name: 'Ghoul', column: 6, row: 5 });
    await t.call(t.gm.client, 'PATCH', `/tokens/${ghoul.id}`, { column: 7, row: 5 });
    expect(await updates()).toBe(0);
    expect(await names(t, t.bob.client, crypt.id)).toEqual([]);
    expect(await names(t, t.gm.client, crypt.id)).toEqual(['Ghoul']);
    expect(
      (await t.call(t.bob.client, 'PATCH', `/tokens/${ghoul.id}`, { column: 1 })).statusCode,
    ).toBe(404);

    const wire = JSON.stringify(socket.received);
    expect(wire).not.toContain('Ghoul');
    expect(wire).not.toContain(ghoul.id);

    // Revealing its cell has players refetch, and now they get it.
    await fog(t, t.gm.client, crypt.id, {
      action: 'reveal',
      area: { x: 7, y: 5, width: 1, height: 1 },
    });
    expect(await updates()).toBe(1);
    expect(await names(t, t.bob.client, crypt.id)).toEqual(['Ghoul']);

    // Moving out of the light tells players once, so they let go of it, then nothing more.
    await t.call(t.gm.client, 'PATCH', `/tokens/${ghoul.id}`, { column: 8 });
    expect(await updates()).toBe(2);
    expect(await names(t, t.bob.client, crypt.id)).toEqual([]);
    await t.call(t.gm.client, 'PATCH', `/tokens/${ghoul.id}`, { column: 9 });
    expect(await updates()).toBe(2);

    // Turning the fog off shows every token that is not hidden.
    await t.call(t.gm.client, 'PATCH', `/scenes/${crypt.id}`, { fog: false });
    expect(await updates()).toBe(3);
    expect(await names(t, t.bob.client, crypt.id)).toEqual(['Ghoul']);
    socket.ws.close();
  });

  it("shows players their own actors' tokens in the fog, and lets them move them", async () => {
    const t = await setupTable();
    const crypt = await foggedScene(t);
    const res = await t.call(t.bob.client, 'POST', `/tables/${t.table.id}/actors`, {
      type: 'character',
      name: 'Ayla',
    });
    const ayla = res.json<{ actor: ActorView }>().actor;
    const own = await place(t, crypt.id, { actorId: ayla.id, column: 3, row: 3 });
    await place(t, crypt.id, { name: 'Ghoul', column: 3, row: 4 });

    expect(await names(t, t.bob.client, crypt.id)).toEqual(['Ayla']);
    expect(await names(t, t.carol.client, crypt.id)).toEqual([]);
    const moved = await t.call(t.bob.client, 'PATCH', `/tokens/${own.id}`, { column: 4 });
    expect(moved.statusCode, moved.body).toBe(200);
  });
});
