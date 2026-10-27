import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect } from 'vitest';

import { documentName } from '@vtt/shared';

import type { CollabTiming } from '../../src/realtime/collab.js';

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
import { copyReferencePlugin } from './reference.js';

/** A data directory holding code-free copies of reference plugins. */
export async function systemsDir(ids: readonly string[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'vtt-systems-'));
  for (const id of ids) await copyReferencePlugin(id, path.join(dir, 'plugins', id));
  return dir;
}

/**
 * Starts a server on `dataDir` with its plugins enabled. Given the database and admin of a
 * previous run, it restarts on that data, where sessions are still valid.
 */
export async function startWithSystems(
  dataDir: string,
  ids: readonly string[],
  options: {
    db?: TestApp['db'];
    admin?: Client;
    collabTiming?: CollabTiming;
    now?: () => Date;
  } = {},
): Promise<{ t: TestApp; gm: Client }> {
  const { admin, ...rest } = options;
  const t = await createTestApp({ env: { DATA_DIR: dataDir }, ...rest });
  const gm = admin ?? (await setupAdmin(t.app));
  const headers = authHeaders(gm);
  await t.app.inject({ method: 'POST', url: '/api/v1/plugins/rescan', headers });
  for (const id of ids) {
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/plugins/${id}/enable`,
      headers,
      payload: {},
    });
  }
  return { t, gm };
}

/** A table of the GM's on `systemId`, joined by a new player. */
export async function tableWithPlayer(
  t: TestApp,
  gm: Client,
  systemId: string,
  username: string,
): Promise<{ table: TableView; player: { client: Client; userId: string } }> {
  const table = await createTable(t.app, gm, { systemId });
  const player = await createUserClient(t.app, gm, username);
  const invite = await t.app.inject({
    method: 'POST',
    url: `/api/v1/tables/${table.id}/invites`,
    headers: authHeaders(gm),
    payload: { role: 'player' },
  });
  const { token } = invite.json<{ token: string }>();
  await t.app.inject({
    method: 'POST',
    url: `/api/v1/invites/${token}/accept`,
    headers: authHeaders(player.client),
  });
  return { table, player };
}

/** Creates an actor as `client`, with its main and secret document names. */
export async function createActorAs(
  t: TestApp,
  client: Client,
  tableId: string,
  type: string,
  name: string,
): Promise<{ id: string; main: string; secret: string }> {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/actors`,
    headers: authHeaders(client),
    payload: { type, name },
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json<{ actor: { id: string } }>().actor.id;
  return {
    id,
    main: documentName({ kind: 'actor', id, layer: 'main' }),
    secret: documentName({ kind: 'actor', id, layer: 'secret' }),
  };
}
