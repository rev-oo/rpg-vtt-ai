import type { LightMyRequestResponse } from 'fastify';

import type { Rng } from '@vtt/formula';
import type { TableRole } from '@vtt/shared';

import { members } from '../../src/db/schema.js';

import {
  authHeaders,
  createTable,
  createTestApp,
  createUserClient,
  setupAdmin,
  type Client,
  type TableView,
  type TestApp,
} from './app.js';
import { insertPlugin } from './fixtures.js';

const DAY_MS = 24 * 60 * 60 * 1000;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface TableMember {
  client: Client;
  userId: string;
}

export interface TableSetup extends TestApp {
  table: TableView;
  gm: TableMember;
  bob: TableMember;
  carol: TableMember;
  dave: TableMember;
  /** Not a member of the table. */
  eve: TableMember;
  call: (
    client: Client,
    method: Method,
    url: string,
    payload?: Record<string, unknown>,
  ) => Promise<LightMyRequestResponse>;
  advanceDays: (days: number) => void;
}

/**
 * A table with a GM, two players (bob, carol), a spectator (dave) and a user who is not a
 * member (eve), plus a movable clock. Sessions last a year so the clock can move past the
 * soft-delete window.
 */
export async function setupTable({ rng }: { rng?: Rng } = {}): Promise<TableSetup> {
  let clock = new Date('2026-03-01T12:00:00Z');
  const t = await createTestApp({
    env: { SESSION_TTL: String(365 * 24 * 60 * 60) },
    now: () => clock,
    ...(rng && { rng }),
  });
  insertPlugin(t.db);
  const admin = await setupAdmin(t.app);
  const user = (name: string) => createUserClient(t.app, admin, name);
  const [gm, bob, carol, dave, eve] = await Promise.all(
    ['gamemaster', 'bob', 'carol', 'dave', 'eve'].map(user),
  ).then((list) => list.map((u) => ({ client: u.client, userId: u.userId })));
  if (!gm || !bob || !carol || !dave || !eve) throw new Error('setup failed');

  const table = await createTable(t.app, gm.client);
  const join = (userId: string, role: TableRole) =>
    t.db.insert(members).values({ tableId: table.id, userId, role }).run();
  join(bob.userId, 'player');
  join(carol.userId, 'player');
  join(dave.userId, 'spectator');

  const call = (
    client: Client,
    method: Method,
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> =>
    t.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: authHeaders(client),
      ...(payload && { payload }),
    });

  return {
    ...t,
    table,
    gm,
    bob,
    carol,
    dave,
    eve,
    call,
    advanceDays: (days: number) => {
      clock = new Date(clock.getTime() + days * DAY_MS);
    },
  };
}
