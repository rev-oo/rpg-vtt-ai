import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeZip } from '@vtt/plugin-io';
import type { ActorView, ItemView, TableView } from '@vtt/shared/api';

import {
  authHeaders,
  createTable,
  createTestApp,
  setupAdmin,
  type Client,
  type TestApp,
} from './support/app.js';
import { referencePluginFiles } from './support/reference.js';
import { setupTable } from './support/table.js';

// T-0813 (§9.7, ADR-058): a table moves to its system's installed version when a GM upgrades
// it, and entities keep the version they were made with.

let dataDir: string;
let t: TestApp;
let admin: Client;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'vtt-data-version-'));
  t = await createTestApp({ env: { DATA_DIR: dataDir } });
  admin = await setupAdmin(t.app);
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

/** tiny-d20 at `version`, installed (replacing any other version) and enabled. */
async function install(version: string): Promise<void> {
  const files = await referencePluginFiles('tiny-d20');
  const manifest = JSON.parse(String(files.get('plugin.json'))) as Record<string, unknown>;
  files.set('plugin.json', Buffer.from(JSON.stringify({ ...manifest, version })));
  const headers = authHeaders(admin);
  const installed = await t.app.inject({
    method: 'POST',
    url: '/api/v1/plugins/install?replace=true',
    headers: { ...headers, 'content-type': 'application/zip' },
    payload: writeZip(files),
  });
  expect(installed.statusCode, installed.body).toBeLessThan(300);
  const enabled = await t.app.inject({
    method: 'POST',
    url: '/api/v1/plugins/tiny-d20/enable',
    headers,
    payload: {},
  });
  expect(enabled.statusCode, enabled.body).toBe(200);
}

const get = async <T>(url: string): Promise<T> => {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/v1${url}`,
    headers: authHeaders(admin),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<T>();
};

const post = async <T>(url: string, payload: unknown, status = 201): Promise<T> => {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: authHeaders(admin),
    payload: payload as Record<string, unknown>,
  });
  expect(res.statusCode, res.body).toBe(status);
  return res.json<T>();
};

describe('data versions (T-0813)', () => {
  it('keeps a table at its version until a GM upgrades it', async () => {
    await install('0.1.0');
    const table = await createTable(t.app, admin, { systemId: 'tiny-d20' });
    expect(table).toMatchObject({ systemVersion: '0.1.0', installedVersion: '0.1.0' });
    const { actor: old } = await post<{ actor: ActorView }>(`/tables/${table.id}/actors`, {
      type: 'character',
      name: 'Old hero',
    });

    // Installing a new version leaves the table, and what is made on it, where it was.
    await install('0.2.0');
    const { table: before } = await get<{ table: TableView }>(`/tables/${table.id}`);
    expect(before).toMatchObject({ systemVersion: '0.1.0', installedVersion: '0.2.0' });
    const { actor: meanwhile } = await post<{ actor: ActorView }>(`/tables/${table.id}/actors`, {
      type: 'character',
      name: 'Meanwhile',
    });
    expect(meanwhile.dataVersion).toBe('0.1.0');

    const { table: after } = await post<{ table: TableView }>(
      `/tables/${table.id}/upgrade-system`,
      {},
      200,
    );
    expect(after).toMatchObject({ systemVersion: '0.2.0', installedVersion: '0.2.0' });
    expect((await get<{ actor: ActorView }>(`/actors/${old.id}`)).actor.dataVersion).toBe('0.1.0');
    const { actor } = await post<{ actor: ActorView }>(`/tables/${table.id}/actors`, {
      type: 'character',
      name: 'New hero',
    });
    const { item } = await post<{ item: ItemView }>(`/tables/${table.id}/items`, {
      type: 'weapon',
      name: 'New sword',
    });
    expect([actor.dataVersion, item.dataVersion]).toEqual(['0.2.0', '0.2.0']);
  });
});

describe('POST /tables/:id/upgrade-system', () => {
  it('is for GMs and assistants, on tables that are not archived', async () => {
    const s = await setupTable();
    const url = `/tables/${s.table.id}/upgrade-system`;
    expect((await s.call(s.bob.client, 'POST', url)).statusCode).toBe(403);
    expect((await s.call(s.gm.client, 'POST', url)).statusCode).toBe(200);
    await s.call(s.gm.client, 'POST', `/tables/${s.table.id}/archive`);
    const archived = await s.call(s.gm.client, 'POST', url);
    expect(archived.json()).toMatchObject({ error: { code: 'table_archived' } });
    await s.app.close();
  });
});
