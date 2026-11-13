import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { writeZip } from '@vtt/plugin-io';
import type {
  ActorHistoryResponse,
  ActorView,
  ItemView,
  TableView,
  UpgradeSystemResponse,
} from '@vtt/shared/api';

import { actors, items } from '../src/db/schema.js';

import {
  authHeaders,
  createTable,
  createTestApp,
  setupAdmin,
  type Client,
  type TestApp,
} from './support/app.js';
import { openCollab } from './support/collab.js';
import { referencePluginFiles } from './support/reference.js';

// T-1501 (FR-PLUGIN-12, ADR-072): upgrading a table migrates its actors' and items' data with
// the plugin's `migrations/` steps and `migrate` hook, one entity at a time.

let dataDir: string;
let t: TestApp;
let admin: Client;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'vtt-migrations-'));
  t = await createTestApp({ env: { DATA_DIR: dataDir } });
  admin = await setupAdmin(t.app);
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

const json = (value: unknown) => Buffer.from(JSON.stringify(value));

const request = async <T>(method: 'GET' | 'POST', url: string, status = 200): Promise<T> => {
  const res = await t.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: authHeaders(admin),
    ...(method === 'POST' && { payload: {} }),
  });
  expect(res.statusCode, res.body).toBe(status);
  return res.json<T>();
};

const post = async <T>(url: string, payload: object): Promise<T> => {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: authHeaders(admin),
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<T>();
};

/** Installs a plugin from its files, replacing any other version, and enables it. */
async function install(id: string, files: Map<string, Buffer>, acknowledgeCode = false) {
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
    url: `/api/v1/plugins/${id}/enable`,
    headers,
    payload: acknowledgeCode ? { acknowledgeCode: true } : {},
  });
  expect(enabled.statusCode, enabled.body).toBe(200);
}

/**
 * tiny-d20 at 0.1.0 as it ships, or at 0.2.0: characters gain an `edition`, and two migration
 * files bring older data up. By 0.1.5, `wounds` moved into `hp.value` and skills' `lvl` became
 * `rank`; at 0.2.0, characters made before get the first edition and `legacy` goes.
 */
async function tinyD20(version: '0.1.0' | '0.2.0'): Promise<Map<string, Buffer>> {
  const files = await referencePluginFiles('tiny-d20');
  const manifest = JSON.parse(String(files.get('plugin.json'))) as Record<string, unknown>;
  files.set('plugin.json', json({ ...manifest, version }));
  if (version === '0.1.0') return files;
  const character = JSON.parse(String(files.get('types/actors/character.json'))) as {
    schema: { properties: Record<string, unknown> };
  };
  character.schema.properties.edition = { type: 'string', enum: ['1e', '2e'], default: '2e' };
  files.set('types/actors/character.json', json(character));
  const step = (op: string, rest: object) => ({ op, kind: 'actor', type: 'character', ...rest });
  files.set(
    'migrations/0.1.5.json',
    json({
      steps: [
        step('rename', { path: 'skills.*.lvl', to: 'rank' }),
        step('move', { path: 'wounds', to: 'hp.value' }),
      ],
    }),
  );
  files.set(
    'migrations/0.2.0.json',
    json({
      steps: [
        step('setDefault', { path: 'edition', value: '1e' }),
        step('drop', { path: 'legacy' }),
      ],
    }),
  );
  return files;
}

/** An actor made through the API, then given data as an older version left it. */
async function oldActor(tableId: string, name: string, system: Record<string, unknown>) {
  const { actor } = await post<{ actor: ActorView }>(`/tables/${tableId}/actors`, {
    type: 'character',
    name,
  });
  t.db.update(actors).set({ system }).where(eq(actors.id, actor.id)).run();
  return actor.id;
}

const actorOf = async (id: string) =>
  (await request<{ actor: ActorView }>('GET', `/actors/${id}`)).actor;

describe('table upgrades migrate data (T-1501)', () => {
  it('runs the steps between versions, and reports what it could not migrate', async () => {
    await install('tiny-d20', await tinyD20('0.1.0'));
    const table = await createTable(t.app, admin, { systemId: 'tiny-d20' });
    const hero = await oldActor(table.id, 'Hero', {
      str: 12,
      wounds: 7,
      hp: { max: 10 },
      skills: { a: { name: 'Climb', lvl: 2, sort: 'a0' } },
      legacy: 'old',
    });
    // `hp` is not an object here, so moving `wounds` into it cannot run.
    const broken = await oldActor(table.id, 'Broken', { hp: 3, wounds: 1 });
    // The move runs, but leaves text where hit points are a number.
    const odd = await oldActor(table.id, 'Odd', { wounds: 'many' });
    const { item } = await post<{ item: ItemView }>(`/tables/${table.id}/items`, {
      type: 'weapon',
      name: 'Sword',
    });

    await install('tiny-d20', await tinyD20('0.2.0'));
    const before = await request<{ table: TableView }>('GET', `/tables/${table.id}`);
    // Nothing is counted until the table moves: its data is not behind its own version.
    expect(before.table.outdatedEntities).toBe(0);

    const upgraded = await request<UpgradeSystemResponse>(
      'POST',
      `/tables/${table.id}/upgrade-system`,
    );
    expect(upgraded.migration).toEqual({
      migrated: 2,
      failedCount: 2,
      failed: [
        { kind: 'actor', id: broken, name: 'Broken', reason: 'step', version: '0.1.5', step: 1 },
        {
          kind: 'actor',
          id: odd,
          name: 'Odd',
          reason: 'invalid',
          issues: [{ path: ['hp', 'value'], reason: 'type' }],
        },
      ],
    });
    expect(upgraded.table).toMatchObject({ systemVersion: '0.2.0', outdatedEntities: 2 });
    // Only the server runs migrations; browsers never get them.
    const system = await request<{ system: { definition: object } }>('GET', '/systems/tiny-d20');
    expect(system.system.definition).not.toHaveProperty('migrations');

    const migrated = await actorOf(hero);
    expect(migrated.dataVersion).toBe('0.2.0');
    expect(migrated.system).toMatchObject({
      str: 12,
      hp: { value: 7, max: 10 },
      skills: { a: { name: 'Climb', rank: 2, sort: 'a0' } },
      edition: '1e',
    });
    expect(migrated.system).not.toHaveProperty('wounds');
    expect(migrated.system).not.toHaveProperty('legacy');
    expect((await request<{ item: ItemView }>('GET', `/items/${item.id}`)).item.dataVersion).toBe(
      '0.2.0',
    );
    // Failed entities are left as they were.
    const left = await actorOf(broken);
    expect(left).toMatchObject({ dataVersion: '0.1.0', system: { hp: 3, wounds: 1 } });
    // The hero's sheet history keeps what it was, so a GM can go back.
    const history = await request<ActorHistoryResponse>('GET', `/actors/${hero}/history`);
    expect(history.snapshots.length).toBeGreaterThan(0);

    // Once its data is fixed, upgrading again migrates what was left.
    t.db
      .update(actors)
      .set({ system: { hp: { max: 4 }, wounds: 1 } })
      .where(eq(actors.id, broken))
      .run();
    const again = await request<UpgradeSystemResponse>(
      'POST',
      `/tables/${table.id}/upgrade-system`,
    );
    expect(again.migration).toMatchObject({ migrated: 1, failedCount: 1 });
    expect(again.table.outdatedEntities).toBe(1);
    expect(await actorOf(broken)).toMatchObject({
      dataVersion: '0.2.0',
      system: { hp: { value: 1, max: 4 }, edition: '1e' },
    });
  });

  it('brings an open sheet up to date at once', async () => {
    await install('tiny-d20', await tinyD20('0.1.0'));
    const table = await createTable(t.app, admin, { systemId: 'tiny-d20' });
    const hero = await oldActor(table.id, 'Hero', { wounds: 4, legacy: 'old' });
    const sheet = await (await openCollab(t.app, admin)).open(`actor:${hero}:main`);
    const data = sheet.doc.getMap<unknown>('data');
    expect(data.get('wounds')).toBe(4);

    await install('tiny-d20', await tinyD20('0.2.0'));
    await request('POST', `/tables/${table.id}/upgrade-system`);
    await expect.poll(() => data.get('edition')).toBe('1e');
    expect(data.has('wounds')).toBe(false);
    expect(data.has('legacy')).toBe(false);
    expect((data.get('hp') as Y.Map<unknown>).get('value')).toBe(4);
  });

  it('runs nothing on data from a newer version, which only gets older on a downgrade', async () => {
    await install('tiny-d20', await tinyD20('0.2.0'));
    const table = await createTable(t.app, admin, { systemId: 'tiny-d20' });
    const hero = await oldActor(table.id, 'Hero', { wounds: 2 });
    await install('tiny-d20', await tinyD20('0.1.0'));
    const downgraded = await request<UpgradeSystemResponse>(
      'POST',
      `/tables/${table.id}/upgrade-system`,
    );
    expect(downgraded.migration).toEqual({ migrated: 0, failedCount: 0, failed: [] });
    expect(downgraded.table.outdatedEntities).toBe(0);
    expect(await actorOf(hero)).toMatchObject({ dataVersion: '0.2.0', system: { wounds: 2 } });
  });
});

describe('the migrate hook (T-1501)', () => {
  /** A small system with server code: its hook doubles `might`, or fails on purpose. */
  const coded = (version: string) =>
    new Map<string, Buffer>([
      [
        'plugin.json',
        json({
          id: 'coded',
          name: 'Coded',
          version,
          kind: 'system',
          coreApi: '^1.0.0',
          hasCode: true,
        }),
      ],
      [
        'types/actors/hero.json',
        json({
          label: 'Hero',
          controlledBy: 'player',
          sheet: 'hero',
          schema: {
            type: 'object',
            properties: { might: { type: 'integer', default: 1, maximum: 100 } },
          },
        }),
      ],
      ['sheets/hero.json', json({ layout: { type: 'field', path: 'might', input: 'number' } })],
      [
        'code/server.js',
        Buffer.from(`export default {
  hooks: {
    migrate: ({ kind, type, from, to, data, ctx }) => {
      if (ctx !== undefined) throw new Error('migrate got a ctx');
      if (data.might === 13) throw new Error('unlucky');
      if (data.might === 0) return 'not data';
      return { ...data, might: data.might * 2, seen: kind + ':' + type + ':' + from + '>' + to };
    },
  },
};
`),
      ],
    ]);

  it('runs after the steps, and an error or an answer that is not data fails the entity', async () => {
    await install('coded', coded('1.0.0'), true);
    const table = await createTable(t.app, admin, { systemId: 'coded' });
    const make = async (name: string, might: number) => {
      const { actor } = await post<{ actor: ActorView }>(`/tables/${table.id}/actors`, {
        type: 'hero',
        name,
      });
      t.db.update(actors).set({ system: { might } }).where(eq(actors.id, actor.id)).run();
      return actor.id;
    };
    const strong = await make('Strong', 21);
    await make('Unlucky', 13);
    await make('Empty', 0);
    await make('Huge', 60);

    await install('coded', coded('1.1.0'), true);
    const { migration } = await request<UpgradeSystemResponse>(
      'POST',
      `/tables/${table.id}/upgrade-system`,
    );
    expect(migration.migrated).toBe(1);
    expect(migration.failed.map(({ name, reason }) => [name, reason])).toEqual([
      ['Unlucky', 'hook'],
      ['Empty', 'hook'],
      // 120 is over the field's maximum.
      ['Huge', 'invalid'],
    ]);
    expect(await actorOf(strong)).toMatchObject({
      dataVersion: '1.1.0',
      system: { might: 42, seen: 'actor:hero:1.0.0>1.1.0' },
    });
  });
});

// Entities of a type the system no longer declares are not migrated or counted.
describe('migrations and missing types (T-1501)', () => {
  it('leaves items of a type the system dropped alone', async () => {
    await install('tiny-d20', await tinyD20('0.1.0'));
    const table = await createTable(t.app, admin, { systemId: 'tiny-d20' });
    const { item } = await post<{ item: ItemView }>(`/tables/${table.id}/items`, {
      type: 'weapon',
      name: 'Sword',
    });
    t.db.update(items).set({ type: 'relic' }).where(eq(items.id, item.id)).run();
    await install('tiny-d20', await tinyD20('0.2.0'));
    const { migration, table: after } = await request<UpgradeSystemResponse>(
      'POST',
      `/tables/${table.id}/upgrade-system`,
    );
    expect(migration.migrated).toBe(0);
    expect(after.outdatedEntities).toBe(0);
  });
});
