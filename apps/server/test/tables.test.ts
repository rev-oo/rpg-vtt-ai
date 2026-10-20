import { describe, expect, it } from 'vitest';

import { gameTables, members } from '../src/db/schema.js';

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
  const t = await createTestApp();
  insertPlugin(t.db);
  const admin = await setupAdmin(t.app);
  const alice = await createUserClient(t.app, admin, 'alice');
  return { ...t, admin, alice };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

const listTables = async (app: App, client: Client) => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/tables',
    headers: authHeaders(client),
  });
  return res.json<{ tables: TableView[] }>().tables;
};

const getTable = (app: App, client: Client, id: string) =>
  app.inject({ method: 'GET', url: `/api/v1/tables/${id}`, headers: authHeaders(client) });

const patchTable = (app: App, client: Client, id: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'PATCH',
    url: `/api/v1/tables/${id}`,
    headers: authHeaders(client),
    payload,
  });

describe('table creation (FR-TABLE-01, FR-TABLE-02)', () => {
  it('creates a table pinned to the plugin version, with the creator as GM', async () => {
    const { app, db, alice } = await setup();
    const table = await createTable(app, alice.client, {
      name: '  Curse of the Crimson Throne ',
      description: 'Weekly',
    });

    expect(table).toMatchObject({
      name: 'Curse of the Crimson Throne',
      description: 'Weekly',
      systemId: 'test-system',
      systemName: 'Test System',
      systemVersion: '1.2.0',
      settings: {},
      role: 'gm',
    });
    expect(db.select().from(members).all()).toEqual([
      expect.objectContaining({ tableId: table.id, userId: alice.userId, role: 'gm' }),
    ]);
  });

  it.each([
    ['a disabled plugin', { id: 'off-system', enabled: false }, 'off-system'],
    ['an unknown plugin', null, 'no-such-system'],
  ])('returns 422 for %s', async (_label, plugin, systemId) => {
    const { app, db, alice } = await setup();
    if (plugin) insertPlugin(db, plugin);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tables',
      headers: authHeaders(alice.client),
      payload: { name: 'T', systemId },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'system_unavailable' } });
    expect(db.select().from(gameTables).all()).toEqual([]);
  });

  it('validates the body', async () => {
    const { app, alice } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tables',
      headers: authHeaders(alice.client),
      payload: { name: '', systemId: 'test-system' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires a session and the CSRF token', async () => {
    const { app, alice } = await setup();
    const payload = { name: 'T', systemId: 'test-system' };
    const anonymous = await app.inject({ method: 'POST', url: '/api/v1/tables', payload });
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/tables',
      headers: authHeaders(alice.client, { csrf: false }),
      payload,
    });
    expect(anonymous.statusCode).toBe(401);
    expect(noCsrf.statusCode).toBe(403);
  });
});

describe('table listing and access', () => {
  it("lists only the caller's tables, with their role", async () => {
    const { app, db, admin, alice } = await setup();
    const mine = await createTable(app, alice.client, { name: 'B table' });
    const theirs = await createTable(app, admin, { name: 'A table' });
    db.insert(members).values({ tableId: theirs.id, userId: alice.userId, role: 'player' }).run();
    await createTable(app, admin, { name: 'Private' });

    const tables = await listTables(app, alice.client);
    expect(tables.map((t) => [t.name, t.role])).toEqual([
      ['A table', 'player'],
      ['B table', 'gm'],
    ]);
    expect(tables[1]?.id).toBe(mine.id);
  });

  it('returns 404 to non-members, including instance admins (FR-AUTH-08)', async () => {
    const { app, admin, alice } = await setup();
    const table = await createTable(app, alice.client);

    expect((await getTable(app, alice.client, table.id)).statusCode).toBe(200);
    const res = await getTable(app, admin, table.id);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});

describe('table settings (FR-TABLE-07)', () => {
  it('lets the GM rename and change settings', async () => {
    const { app, alice } = await setup();
    const table = await createTable(app, alice.client);
    const res = await patchTable(app, alice.client, table.id, {
      name: 'Renamed',
      settings: { gridSize: 70 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ table: { name: 'Renamed', settings: { gridSize: 70 } } });
  });

  it.each(['assistant', 'player', 'spectator'] as const)('returns 403 to a %s', async (role) => {
    const { app, db, admin, alice } = await setup();
    const table = await createTable(app, admin);
    db.insert(members).values({ tableId: table.id, userId: alice.userId, role }).run();

    const res = await patchTable(app, alice.client, table.id, { name: 'Mine now' });
    expect(res.statusCode).toBe(403);
  });

  it('does not allow changing the system plugin', async () => {
    const { app, alice } = await setup();
    const table = await createTable(app, alice.client);
    const res = await patchTable(app, alice.client, table.id, { systemId: 'other' });
    expect(res.statusCode).toBe(400);
  });
});
