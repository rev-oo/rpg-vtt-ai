import { describe, expect, it } from 'vitest';

import {
  healthResponseSchema,
  instanceInfoResponseSchema,
  instanceSettingsResponseSchema,
  signupResponseSchema,
} from '@vtt/shared/api';

import {
  authHeaders,
  clientFrom,
  createTable,
  createTestApp,
  createUserClient,
  setupAdmin,
  type Client,
} from './support/app.js';
import { insertPlugin } from './support/fixtures.js';

async function setup() {
  let clock = new Date('2026-03-01T12:00:00Z');
  const t = await createTestApp({ now: () => clock });
  insertPlugin(t.db);
  const admin = await setupAdmin(t.app);
  const call = (
    client: Client | null,
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    t.app.inject({
      method,
      url: `/api/v1${url}`,
      ...(client && { headers: authHeaders(client) }),
      ...(payload && { payload }),
    });
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  return { ...t, admin, call, advance };
}

describe('instance settings (FR-ADMIN-01, T-0604)', () => {
  it('start from defaults and are changed by admins only', async () => {
    const t = await setup();
    const read = async () =>
      instanceSettingsResponseSchema.parse((await t.call(t.admin, 'GET', '/admin/settings')).json())
        .settings;
    expect(await read()).toEqual({
      siteName: 'VTT',
      registration: 'closed',
      sessionLifetimeSeconds: 7 * 24 * 60 * 60,
    });

    const bob = await createUserClient(t.app, t.admin, 'bob');
    expect((await t.call(bob.client, 'GET', '/admin/settings')).statusCode).toBe(403);
    expect(
      (await t.call(bob.client, 'PATCH', '/admin/settings', { siteName: 'Mine' })).statusCode,
    ).toBe(403);

    const res = await t.call(t.admin, 'PATCH', '/admin/settings', {
      siteName: '  Thursday Night  ',
      registration: 'invite',
    });
    expect(res.statusCode).toBe(200);
    expect(instanceSettingsResponseSchema.parse(res.json()).settings).toMatchObject({
      siteName: 'Thursday Night',
      registration: 'invite',
    });
    for (const bad of [
      {},
      { siteName: '' },
      { registration: 'open' },
      { sessionLifetimeSeconds: 60 },
      { other: 1 },
    ]) {
      expect((await t.call(t.admin, 'PATCH', '/admin/settings', bad)).statusCode).toBe(400);
    }

    // Anyone, signed in or not, sees the site name and whether sign-up is open.
    const info = instanceInfoResponseSchema.parse((await t.call(null, 'GET', '/instance')).json());
    expect(info.instance).toEqual({ siteName: 'Thursday Night', registration: 'invite' });
  });

  it('give new sessions the configured lifetime', async () => {
    const t = await setup();
    await t.call(t.admin, 'PATCH', '/admin/settings', { sessionLifetimeSeconds: 2 * 60 * 60 });
    const bob = await createUserClient(t.app, t.admin, 'bob');
    t.advance(60 * 60 * 1000);
    expect((await t.call(bob.client, 'GET', '/me')).statusCode).toBe(200);
    t.advance(61 * 60 * 1000);
    expect((await t.call(bob.client, 'GET', '/me')).statusCode).toBe(401);
  });
});

describe('sign-up through an invite link (FR-ADMIN-01)', () => {
  const newcomer = { username: 'newcomer', displayName: 'New Comer', password: 'long-password-1' };

  async function withInvite() {
    const t = await setup();
    const table = await createTable(t.app, t.admin);
    const created = await t.call(t.admin, 'POST', `/tables/${table.id}/invites`, {
      role: 'player',
    });
    const { token } = created.json<{ token: string }>();
    return { ...t, table, token };
  }

  it('is refused while registration is closed', async () => {
    const t = await withInvite();
    const res = await t.call(null, 'POST', `/invites/${t.token}/signup`, newcomer);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'registration_closed' } });
    // Nor can anyone see where the link leads without an account.
    expect((await t.call(null, 'GET', `/invites/${t.token}`)).statusCode).toBe(401);
  });

  it('creates a signed-in account that joins the table with the invite role', async () => {
    const t = await withInvite();
    await t.call(t.admin, 'PATCH', '/admin/settings', { registration: 'invite' });

    const preview = await t.call(null, 'GET', `/invites/${t.token}`);
    expect(preview.json()).toMatchObject({ invite: { role: 'player', table: { id: t.table.id } } });

    const res = await t.call(null, 'POST', `/invites/${t.token}/signup`, newcomer);
    expect(res.statusCode).toBe(201);
    const body = signupResponseSchema.parse(res.json());
    expect(body.user).toMatchObject({ username: 'newcomer', isAdmin: false });
    expect(body.table).toMatchObject({ id: t.table.id, role: 'player' });
    const client = clientFrom(res);
    const tables = (await t.call(client, 'GET', '/tables')).json<{ tables: { id: string }[] }>();
    expect(tables.tables.map((table) => table.id)).toEqual([t.table.id]);

    const again = await t.call(null, 'POST', `/invites/${t.token}/signup`, newcomer);
    expect(again.json()).toMatchObject({ error: { code: 'username_taken' } });
    const weak = await t.call(null, 'POST', `/invites/${t.token}/signup`, {
      ...newcomer,
      username: 'other',
      password: 'short',
    });
    expect(weak.statusCode).toBe(400);
  });

  it('needs a usable link', async () => {
    const t = await withInvite();
    await t.call(t.admin, 'PATCH', '/admin/settings', { registration: 'invite' });
    const unknown = 'x'.repeat(43);
    expect((await t.call(null, 'POST', `/invites/${unknown}/signup`, newcomer)).statusCode).toBe(
      404,
    );
    t.advance(8 * 24 * 60 * 60 * 1000);
    const expired = await t.call(null, 'POST', `/invites/${t.token}/signup`, newcomer);
    expect(expired.statusCode).toBe(410);
  });

  it('limits sign-ups per client (T-0701)', async () => {
    const t = await withInvite();
    await t.call(t.admin, 'PATCH', '/admin/settings', { registration: 'invite' });
    for (let i = 0; i < 10; i += 1) {
      const res = await t.call(null, 'POST', `/invites/${t.token}/signup`, {
        ...newcomer,
        username: `newcomer${String(i)}`,
      });
      expect(res.statusCode).toBe(201);
    }
    const res = await t.call(null, 'POST', `/invites/${t.token}/signup`, newcomer);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: { code: 'rate_limited' } });
    t.advance(60 * 60 * 1000);
    expect((await t.call(null, 'POST', `/invites/${t.token}/signup`, newcomer)).statusCode).toBe(
      201,
    );
  });
});

describe('GET /api/health (FR-ADMIN-03, T-0604)', () => {
  const health = async (t: Awaited<ReturnType<typeof setup>>) => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    return { code: res.statusCode, body: healthResponseSchema.parse(res.json()) };
  };

  it('reports the database and the enabled plugins', async () => {
    const t = await setup();
    insertPlugin(t.db, { id: 'broken', status: 'invalid' });
    insertPlugin(t.db, { id: 'off', enabled: false, status: 'invalid' });
    expect(await health(t)).toEqual({
      code: 200,
      body: { status: 'ok', database: 'ok', plugins: { enabled: 2, ready: 1, failed: 1 } },
    });
  });

  it('reports unhealthy when the database is broken', async () => {
    const t = await setup();
    t.db.$client.close();
    expect(await health(t)).toEqual({
      code: 503,
      body: {
        status: 'unhealthy',
        database: 'error',
        plugins: { enabled: 0, ready: 0, failed: 0 },
      },
    });
    expect(t.logs.lines.some((line) => line.msg === 'health check: database unavailable')).toBe(
      true,
    );
  });
});
