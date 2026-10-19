import { describe, expect, it } from 'vitest';

import { invites, members } from '../src/db/schema.js';

import {
  authHeaders,
  createTable,
  createTestApp,
  createUserClient,
  setupAdmin,
  type Client,
  type TableView,
} from './support/app.js';
import { insertPlugin } from './support/fixtures.js';

async function setup() {
  let clock = new Date('2026-03-01T12:00:00Z');
  const t = await createTestApp({
    env: { PUBLIC_URL: 'https://vtt.example.com/play' },
    now: () => clock,
  });
  insertPlugin(t.db);
  const admin = await setupAdmin(t.app);
  const gm = await createUserClient(t.app, admin, 'gamemaster');
  const bob = await createUserClient(t.app, admin, 'bob');
  const table = await createTable(t.app, gm.client);
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  return { ...t, admin, gm, bob, table, advance };
}

type Setup = Awaited<ReturnType<typeof setup>>;
interface CreatedInvite {
  invite: { id: string; role: string; status: string; expiresAt: string | null };
  token: string;
  url: string;
}

const createInvite = (t: Setup, client: Client, payload: Record<string, unknown>) =>
  t.app.inject({
    method: 'POST',
    url: `/api/v1/tables/${t.table.id}/invites`,
    headers: authHeaders(client),
    payload,
  });

async function inviteAs(t: Setup, payload: Record<string, unknown>): Promise<CreatedInvite> {
  const res = await createInvite(t, t.gm.client, payload);
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json<CreatedInvite>();
}

const accept = (t: Setup, client: Client, token: string) =>
  t.app.inject({
    method: 'POST',
    url: `/api/v1/invites/${token}/accept`,
    headers: authHeaders(client),
  });

const membershipsOf = (t: Setup, userId: string) =>
  t.db
    .select()
    .from(members)
    .all()
    .filter((m) => m.userId === userId);

describe('creating invites (FR-TABLE-03)', () => {
  it('returns a link under PUBLIC_URL and stores only the token hash', async () => {
    const t = await setup();
    const created = await inviteAs(t, { role: 'player' });

    expect(created.url).toBe(`https://vtt.example.com/play/invite/${created.token}`);
    expect(created.invite).toMatchObject({
      role: 'player',
      status: 'active',
      expiresAt: '2026-03-08T12:00:00.000Z',
    });
    const [stored] = t.db.select().from(invites).all();
    expect(stored?.tokenHash).not.toBe(created.token);
    expect(JSON.stringify(stored)).not.toContain(created.token);
  });

  it('supports links that never expire', async () => {
    const t = await setup();
    const created = await inviteAs(t, { role: 'spectator', expiresInSeconds: null });
    expect(created.invite.expiresAt).toBeNull();
  });

  it('rejects the gm role and out-of-range lifetimes', async () => {
    const t = await setup();
    for (const payload of [
      { role: 'gm' },
      { role: 'player', expiresInSeconds: 1 },
      { role: 'player', expiresInSeconds: 365 * 24 * 3600 },
    ]) {
      expect((await createInvite(t, t.gm.client, payload)).statusCode).toBe(400);
    }
  });

  it.each(['assistant', 'player', 'spectator'] as const)('returns 403 to a %s', async (role) => {
    const t = await setup();
    t.db.insert(members).values({ tableId: t.table.id, userId: t.bob.userId, role }).run();
    expect((await createInvite(t, t.bob.client, { role: 'player' })).statusCode).toBe(403);
  });

  it('lists invites with their status to the GM', async () => {
    const t = await setup();
    await inviteAs(t, { role: 'player', expiresInSeconds: 60 });
    t.advance(60_000);
    await inviteAs(t, { role: 'spectator' });

    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/tables/${t.table.id}/invites`,
      headers: authHeaders(t.gm.client),
    });
    const list = res.json<{ invites: { role: string; status: string }[] }>().invites;
    expect(list.map((i) => [i.role, i.status])).toEqual([
      ['spectator', 'active'],
      ['player', 'expired'],
    ]);
  });
});

describe('accepting invites', () => {
  it('previews, then adds the membership with the invite role', async () => {
    const t = await setup();
    const { token } = await inviteAs(t, { role: 'player' });

    const preview = await t.app.inject({
      method: 'GET',
      url: `/api/v1/invites/${token}`,
      headers: authHeaders(t.bob.client),
    });
    expect(preview.json()).toEqual({
      invite: { role: 'player', table: { id: t.table.id, name: 'Test Table' } },
    });

    const res = await accept(t, t.bob.client, token);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ table: TableView; joined: boolean }>()).toMatchObject({
      table: { id: t.table.id, role: 'player' },
      joined: true,
    });
    expect(membershipsOf(t, t.bob.userId).map((m) => m.role)).toEqual(['player']);
  });

  it('adds the membership only once', async () => {
    const t = await setup();
    const { token } = await inviteAs(t, { role: 'player' });
    await accept(t, t.bob.client, token);
    const again = await accept(t, t.bob.client, token);

    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ joined: false });
    expect(membershipsOf(t, t.bob.userId)).toHaveLength(1);
  });

  it('never changes the role of an existing member', async () => {
    const t = await setup();
    const { token } = await inviteAs(t, { role: 'spectator' });
    const res = await accept(t, t.gm.client, token);

    expect(res.json()).toMatchObject({ table: { role: 'gm' }, joined: false });
    expect(membershipsOf(t, t.gm.userId).map((m) => m.role)).toEqual(['gm']);
  });

  it('returns 410 for an expired token', async () => {
    const t = await setup();
    const { token } = await inviteAs(t, { role: 'player', expiresInSeconds: 3600 });
    t.advance(3600 * 1000);

    const res = await accept(t, t.bob.client, token);
    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ error: { code: 'invite_expired' } });
    expect(membershipsOf(t, t.bob.userId)).toEqual([]);
  });

  it('returns 410 for a revoked token', async () => {
    const t = await setup();
    const { token, invite } = await inviteAs(t, { role: 'player' });
    const revoke = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/tables/${t.table.id}/invites/${invite.id}`,
      headers: authHeaders(t.gm.client),
    });
    expect(revoke.statusCode).toBe(204);

    for (const res of [
      await accept(t, t.bob.client, token),
      await t.app.inject({
        method: 'GET',
        url: `/api/v1/invites/${token}`,
        headers: authHeaders(t.bob.client),
      }),
    ]) {
      expect(res.statusCode).toBe(410);
      expect(res.json()).toMatchObject({ error: { code: 'invite_revoked' } });
    }
  });

  it('returns 404 for an unknown token and 401 without a session', async () => {
    const t = await setup();
    const { token } = await inviteAs(t, { role: 'player' });
    expect((await accept(t, t.bob.client, 'x'.repeat(43))).statusCode).toBe(404);
    const anonymous = await t.app.inject({
      method: 'POST',
      url: `/api/v1/invites/${token}/accept`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('only lets the table GM revoke', async () => {
    const t = await setup();
    const { invite } = await inviteAs(t, { role: 'player' });
    const other = await createTable(t.app, t.bob.client);
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/tables/${other.id}/invites/${invite.id}`,
      headers: authHeaders(t.bob.client),
    });
    expect(res.statusCode).toBe(404);
  });
});
