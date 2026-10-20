import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createChatMessage } from '../src/db/repositories/index.js';
import { chatMessages, gameTables, members, plugins, sessions, users } from '../src/db/schema.js';

import {
  authHeaders,
  createTestApp,
  createUserClient,
  login,
  setupAdmin,
  type Client,
} from './support/app.js';

async function setup() {
  const t = await createTestApp();
  const admin = await setupAdmin(t.app);
  const adminId = t.db.select().from(users).get()?.id ?? '';
  return { ...t, admin, adminId };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

const patchUser = (app: App, client: Client, id: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'PATCH',
    url: `/api/v1/users/${id}`,
    headers: authHeaders(client),
    payload,
  });

const deleteUser = (app: App, client: Client, id: string) =>
  app.inject({ method: 'DELETE', url: `/api/v1/users/${id}`, headers: authHeaders(client) });

describe('user administration (FR-AUTH-02, FR-AUTH-06)', () => {
  it('creates a user with a one-time password that must be changed', async () => {
    const { app, admin } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeaders(admin),
      payload: { username: 'alice', displayName: 'Alice' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ user: Record<string, unknown>; oneTimePassword: string }>();
    expect(body.user).toMatchObject({
      username: 'alice',
      isAdmin: false,
      mustChangePassword: true,
      disabled: false,
    });
    expect(body.user).not.toHaveProperty('passwordHash');

    const loggedIn = await login(app, { username: 'alice', password: body.oneTimePassword });
    expect(loggedIn.statusCode).toBe(200);
    expect(loggedIn.json()).toMatchObject({ user: { mustChangePassword: true } });
  });

  it('rejects a duplicate username regardless of case', async () => {
    const { app, admin } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeaders(admin),
      payload: { username: 'ADMIN', displayName: 'Again' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'username_taken' } });
  });

  it('lists users without password hashes', async () => {
    const { app, admin } = await setup();
    await createUserClient(app, admin, 'alice');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: authHeaders(admin),
    });

    expect(res.statusCode).toBe(200);
    const list = res.json<{ users: Record<string, unknown>[] }>().users;
    expect(list.map((u) => u.username)).toEqual(['admin', 'alice']);
    expect(JSON.stringify(list)).not.toContain('argon2');
  });

  it('returns 403 to non-admins on every admin route', async () => {
    const { app, admin, adminId } = await setup();
    const { client } = await createUserClient(app, admin, 'alice');
    const responses = [
      await app.inject({ method: 'GET', url: '/api/v1/users', headers: authHeaders(client) }),
      await app.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: authHeaders(client),
        payload: { username: 'mallory', displayName: 'M' },
      }),
      await patchUser(app, client, adminId, { disabled: true }),
      await deleteUser(app, client, adminId),
    ];
    for (const res of responses) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'forbidden' } });
    }
  });

  it('returns 401 without a session', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/v1/users' })).statusCode).toBe(401);
  });

  it('disables a user: their sessions end and login is refused; re-enabling restores login', async () => {
    const { app, admin } = await setup();
    const alice = await createUserClient(app, admin, 'alice');

    const res = await patchUser(app, admin, alice.userId, { disabled: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { disabled: true } });
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: authHeaders(alice.client),
    });
    expect(me.statusCode).toBe(401);
    expect((await login(app, { username: 'alice', password: alice.password })).statusCode).toBe(
      403,
    );

    await patchUser(app, admin, alice.userId, { disabled: false });
    expect((await login(app, { username: 'alice', password: alice.password })).statusCode).toBe(
      200,
    );
  });

  it('resets a password: returns a new one-time password and ends sessions', async () => {
    const { app, admin } = await setup();
    const alice = await createUserClient(app, admin, 'alice');

    const res = await patchUser(app, admin, alice.userId, { resetPassword: true });
    const { oneTimePassword } = res.json<{ oneTimePassword: string }>();
    expect(oneTimePassword).not.toBe(alice.password);
    expect((await login(app, { username: 'alice', password: alice.password })).statusCode).toBe(
      401,
    );
    expect((await login(app, { username: 'alice', password: oneTimePassword })).statusCode).toBe(
      200,
    );
  });

  it('promotes a user to admin', async () => {
    const { app, admin } = await setup();
    const alice = await createUserClient(app, admin, 'alice');
    await patchUser(app, admin, alice.userId, { isAdmin: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: authHeaders(alice.client),
    });
    expect(res.statusCode).toBe(200);
  });

  it('does not let admins disable, demote or delete themselves', async () => {
    const { app, admin, adminId } = await setup();
    for (const res of [
      await patchUser(app, admin, adminId, { disabled: true }),
      await patchUser(app, admin, adminId, { isAdmin: false }),
      await deleteUser(app, admin, adminId),
    ]) {
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'cannot_modify_self' } });
    }
  });

  it('validates the id and body', async () => {
    const { app, admin, adminId } = await setup();
    expect((await patchUser(app, admin, 'not-a-uuid', { disabled: true })).statusCode).toBe(400);
    expect((await patchUser(app, admin, adminId, {})).statusCode).toBe(400);
    expect(
      (await patchUser(app, admin, '00000000-0000-4000-8000-000000000000', { disabled: true }))
        .statusCode,
    ).toBe(404);
  });

  it('deletes a user with their sessions and memberships; their tables survive', async () => {
    const { app, db, admin } = await setup();
    const alice = await createUserClient(app, admin, 'alice');
    db.insert(plugins).values({ id: 'sys', name: 'Sys', version: '1.0.0', enabled: true }).run();
    db.insert(gameTables)
      .values({
        id: 't1',
        name: 'T',
        systemId: 'sys',
        systemVersion: '1.0.0',
        createdBy: alice.userId,
      })
      .run();
    db.insert(members).values({ tableId: 't1', userId: alice.userId, role: 'gm' }).run();

    const res = await deleteUser(app, admin, alice.userId);
    expect(res.statusCode).toBe(204);
    expect(db.select().from(users).where(eq(users.id, alice.userId)).get()).toBeUndefined();
    expect(db.select().from(sessions).where(eq(sessions.userId, alice.userId)).all()).toEqual([]);
    expect(db.select().from(members).all()).toEqual([]);
    expect(db.select().from(gameTables).get()?.createdBy).toBeNull();
  });

  it("keeps a deleted user's chat messages with the author name snapshot (FR-AUTH-06)", async () => {
    const { app, db, admin } = await setup();
    const alice = await createUserClient(app, admin, 'alice');
    db.insert(plugins).values({ id: 'sys', name: 'Sys', version: '1.0.0', enabled: true }).run();
    db.insert(gameTables)
      .values({ id: 't1', name: 'T', systemId: 'sys', systemVersion: '1.0.0' })
      .run();
    db.insert(members).values({ tableId: 't1', userId: alice.userId, role: 'player' }).run();
    const speaker = { name: 'alice', actorId: null, imageUrl: null };
    createChatMessage(
      db,
      {
        tableId: 't1',
        senderId: alice.userId,
        speaker,
        audience: 'public',
        kind: 'text',
        text: 'bye',
      },
      new Date(),
    );

    expect((await deleteUser(app, admin, alice.userId)).statusCode).toBe(204);
    expect(db.select().from(chatMessages).all()).toMatchObject([
      { senderId: null, speaker, text: 'bye' },
    ]);
  });
});
