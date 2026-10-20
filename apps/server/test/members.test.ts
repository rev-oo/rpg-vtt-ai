import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { TableRole } from '@vtt/shared';

import {
  createActor,
  createJournalEntry,
  findActor,
  findJournalEntry,
} from '../src/db/repositories/index.js';
import { members } from '../src/db/schema.js';

import {
  authHeaders,
  createTable,
  createTestApp,
  createUserClient,
  setupAdmin,
  type Client,
} from './support/app.js';
import { insertPlugin } from './support/fixtures.js';

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';

async function setup() {
  const t = await createTestApp();
  insertPlugin(t.db);
  const admin = await setupAdmin(t.app);
  const gm = await createUserClient(t.app, admin, 'gamemaster');
  const bob = await createUserClient(t.app, admin, 'bob');
  const carol = await createUserClient(t.app, admin, 'carol');
  const table = await createTable(t.app, gm.client);
  const join = (userId: string, role: TableRole) =>
    t.db.insert(members).values({ tableId: table.id, userId, role }).run();
  join(bob.userId, 'player');
  join(carol.userId, 'player');
  return { ...t, admin, gm, bob, carol, table, join };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

const patchMember = (
  app: App,
  client: Client,
  tableId: string,
  userId: string,
  payload: Record<string, unknown>,
) =>
  app.inject({
    method: 'PATCH',
    url: `/api/v1/tables/${tableId}/members/${userId}`,
    headers: authHeaders(client),
    payload,
  });

const removeMember = (app: App, client: Client, tableId: string, userId: string) =>
  app.inject({
    method: 'DELETE',
    url: `/api/v1/tables/${tableId}/members/${userId}`,
    headers: authHeaders(client),
  });

const roleOf = (t: Awaited<ReturnType<typeof setup>>, userId: string) =>
  t.db
    .select()
    .from(members)
    .all()
    .find((m) => m.userId === userId)?.role;

describe('member list', () => {
  it('shows every member to any member, GM first, then by role and name', async () => {
    const { app, admin, bob, table, join } = await setup();
    const zed = await createUserClient(app, admin, 'zed');
    join(zed.userId, 'assistant');
    const amy = await createUserClient(app, admin, 'amy');
    join(amy.userId, 'spectator');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tables/${table.id}/members`,
      headers: authHeaders(bob.client),
    });
    expect(res.statusCode).toBe(200);
    const list = res.json<{ members: { username: string; role: string }[] }>().members;
    expect(list.map((m) => [m.username, m.role])).toEqual([
      ['gamemaster', 'gm'],
      ['zed', 'assistant'],
      ['bob', 'player'],
      ['carol', 'player'],
      ['amy', 'spectator'],
    ]);
  });

  it('returns 404 to non-members', async () => {
    const t = await setup();
    const outsider = await createUserClient(t.app, t.admin, 'dave');
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/tables/${t.table.id}/members`,
      headers: authHeaders(outsider.client),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('role changes (FR-TABLE-04, FR-TABLE-07)', () => {
  it('lets the GM change a role', async () => {
    const t = await setup();
    const res = await patchMember(t.app, t.gm.client, t.table.id, t.bob.userId, {
      role: 'assistant',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ member: { userId: t.bob.userId, role: 'assistant' } });
    expect(roleOf(t, t.bob.userId)).toBe('assistant');
  });

  it.each(['assistant', 'player', 'spectator'] as const)(
    'returns 403 when a %s changes a role, including their own',
    async (role) => {
      const t = await setup();
      t.db.update(members).set({ role }).run();
      t.db.update(members).set({ role: 'gm' }).where(eq(members.userId, t.gm.userId)).run();

      for (const target of [t.carol.userId, t.bob.userId]) {
        const res = await patchMember(t.app, t.bob.client, t.table.id, target, { role: 'gm' });
        expect(res.statusCode).toBe(403);
      }
      expect(roleOf(t, t.bob.userId)).toBe(role);
    },
  );

  it('keeps at least one GM', async () => {
    const t = await setup();
    const demote = await patchMember(t.app, t.gm.client, t.table.id, t.gm.userId, {
      role: 'player',
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json()).toMatchObject({ error: { code: 'last_gm' } });

    await patchMember(t.app, t.gm.client, t.table.id, t.bob.userId, { role: 'gm' });
    const handOver = await patchMember(t.app, t.gm.client, t.table.id, t.gm.userId, {
      role: 'player',
    });
    expect(handOver.statusCode).toBe(200);
  });

  it('returns 404 for a user who is not a member', async () => {
    const t = await setup();
    const res = await patchMember(t.app, t.gm.client, t.table.id, t.table.id, { role: 'player' });
    expect(res.statusCode).toBe(404);
  });
});

describe('default character (FR-TABLE-05)', () => {
  it('lets a member set and clear their own default character', async () => {
    const t = await setup();
    const set = await patchMember(t.app, t.bob.client, t.table.id, t.bob.userId, {
      defaultCharacterId: CHARACTER_ID,
    });
    expect(set.json()).toMatchObject({ member: { defaultCharacterId: CHARACTER_ID } });

    const cleared = await patchMember(t.app, t.bob.client, t.table.id, t.bob.userId, {
      defaultCharacterId: null,
    });
    expect(cleared.json()).toMatchObject({ member: { defaultCharacterId: null } });
  });

  it("does not let anyone, even the GM, set another member's default", async () => {
    const t = await setup();
    const res = await patchMember(t.app, t.gm.client, t.table.id, t.bob.userId, {
      defaultCharacterId: CHARACTER_ID,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'not_own_member' } });
  });
});

describe('removal (FR-TABLE-04)', () => {
  it('lets the GM remove a member', async () => {
    const t = await setup();
    expect((await removeMember(t.app, t.gm.client, t.table.id, t.bob.userId)).statusCode).toBe(204);
    expect(roleOf(t, t.bob.userId)).toBeUndefined();
  });

  it('lets a member leave but not remove others', async () => {
    const t = await setup();
    expect((await removeMember(t.app, t.bob.client, t.table.id, t.carol.userId)).statusCode).toBe(
      403,
    );
    expect((await removeMember(t.app, t.bob.client, t.table.id, t.bob.userId)).statusCode).toBe(
      204,
    );
  });

  it('does not remove the last GM', async () => {
    const t = await setup();
    const res = await removeMember(t.app, t.gm.client, t.table.id, t.gm.userId);
    expect(res.statusCode).toBe(409);
  });

  it("leaves a removed member's actors and journal entries on the table, without their level", async () => {
    const t = await setup();
    const now = new Date();
    const actor = createActor(
      t.db,
      {
        tableId: t.table.id,
        type: 'character',
        name: 'Bob the Brave',
        dataVersion: '1.2.0',
        ownership: {
          default: 'observer',
          users: { [t.bob.userId]: 'owner', [t.carol.userId]: 'owner' },
        },
      },
      now,
    );
    const entry = createJournalEntry(
      t.db,
      {
        tableId: t.table.id,
        title: 'Notes',
        ownership: { default: 'observer', users: { [t.bob.userId]: 'owner' } },
      },
      now,
    );

    expect((await removeMember(t.app, t.gm.client, t.table.id, t.bob.userId)).statusCode).toBe(204);

    expect(findActor(t.db, actor.id)?.ownership).toEqual({
      default: 'observer',
      users: { [t.carol.userId]: 'owner' },
    });
    expect(findJournalEntry(t.db, entry.id)?.ownership).toEqual({ default: 'observer', users: {} });
  });
});
