import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pluginDefinitionSchema } from '@vtt/plugin-schema';
import {
  chatMessageResponseSchema,
  systemDefinitionResponseSchema,
  tableResponseSchema,
  type ActorView,
  type ChatMessage,
} from '@vtt/shared/api';

import { actors } from '../src/db/schema.js';

import {
  authHeaders,
  createTable,
  createTestApp,
  setupAdmin,
  type Client,
  type TableView,
  type TestApp,
} from './support/app.js';
import { copyReferencePlugin } from './support/reference.js';
import { openSocket } from './support/socket.js';

let dataDir: string;
let t: TestApp;
let admin: Client;
let rolls: number[];

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'vtt-system-'));
  for (const id of ['tiny-d20', 'tiny-pool']) {
    await copyReferencePlugin(id, path.join(dataDir, 'plugins', id));
  }
  rolls = [];
  t = await createTestApp({
    env: { DATA_DIR: dataDir },
    rng: { nextInt: (n) => Math.min(rolls.shift() ?? 1, n) - 1 },
  });
  admin = await setupAdmin(t.app);
  const headers = authHeaders(admin);
  await t.app.inject({ method: 'POST', url: '/api/v1/plugins/rescan', headers });
  for (const id of ['tiny-d20', 'tiny-pool']) {
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/plugins/${id}/enable`,
      headers,
      payload: {},
    });
  }
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
  t.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: authHeaders(admin),
    ...(payload && { payload }),
  });

async function hero(
  table: TableView,
  type: string,
  system: Record<string, unknown>,
): Promise<ActorView> {
  const res = await call('POST', `/tables/${table.id}/actors`, { type, name: 'Ayla' });
  const { actor } = res.json<{ actor: ActorView }>();
  // Sheets write plugin data with M5; the test sets it directly.
  t.db.update(actors).set({ system }).where(eq(actors.id, actor.id)).run();
  return actor;
}

async function roll(table: TableView, payload: Record<string, unknown>, ...dice: number[]) {
  rolls = dice;
  return call('POST', `/tables/${table.id}/rolls`, payload);
}

const messageOf = (res: { json: () => unknown }): ChatMessage =>
  chatMessageResponseSchema.parse(res.json()).message;

describe('GET /systems/:id (T-0409)', () => {
  it('sends an available system with its definition, styles and client code', async () => {
    const res = await call('GET', '/systems/tiny-d20');
    expect(res.statusCode).toBe(200);
    const { system } = systemDefinitionResponseSchema.parse(res.json());
    expect(system).toMatchObject({
      id: 'tiny-d20',
      name: 'Tiny D20',
      styles: ['/plugins/tiny-d20/styles/sheet.css'],
      client: null,
      shared: null,
    });
    const definition = pluginDefinitionSchema.parse(system.definition);
    expect(Object.keys(definition.actorTypes)).toEqual(['character', 'npc']);
    expect(definition.lang.en?.['field.str']).toBe('Strength');
  });

  it('answers 404 for unknown and disabled systems, and needs a session', async () => {
    expect((await call('GET', '/systems/nope')).statusCode).toBe(404);
    await call('POST', '/plugins/tiny-pool/disable');
    expect((await call('GET', '/systems/tiny-pool')).statusCode).toBe(404);
    const anonymous = await t.app.inject({ method: 'GET', url: '/api/v1/systems/tiny-d20' });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('tables report their system (T-0409)', () => {
  it('says whether the system is available', async () => {
    const table = await createTable(t.app, admin, { systemId: 'tiny-d20' });
    const read = async () =>
      tableResponseSchema.parse((await call('GET', `/tables/${table.id}`)).json()).table;
    expect((await read()).systemAvailable).toBe(true);
    await call('POST', '/plugins/tiny-d20/disable');
    expect((await read()).systemAvailable).toBe(false);
  });
});

describe('rolls with the system rules (ADR-025)', () => {
  it('reads derived values and defaults in typed formulas', async () => {
    const table = await createTable(t.app, admin, { systemId: 'tiny-d20' });
    const actor = await hero(table, 'character', { str: 16 });
    const res = await roll(
      table,
      { formula: '1d20 + @derived.strMod + @dex', actorId: actor.id },
      12,
    );
    expect(res.statusCode).toBe(201);
    expect(messageOf(res)).toMatchObject({
      kind: 'roll',
      text: '1d20 + @derived.strMod + @dex',
      rolls: [{ resolved: '1d20 + 3 + 10', total: 25 }],
      card: null,
    });
  });

  it('rolls custom dice and reads settings without an actor', async () => {
    const table = await createTable(t.app, admin, { systemId: 'tiny-pool' });
    const res = await roll(table, { formula: '4dF' }, 1, 3, 5, 6);
    expect(messageOf(res).rolls[0]?.total).toBe(1);
    const tiny = await createTable(t.app, admin, { systemId: 'tiny-d20' });
    const setting = await roll(tiny, { formula: '@settings.startingHp + 1' });
    expect(messageOf(setting).rolls[0]?.total).toBe(11);
  });

  it('rolls a recipe into a card message with its outcome and plain-text fallback', async () => {
    const table = await createTable(t.app, admin, { systemId: 'tiny-d20' });
    const actor = await hero(table, 'character', {
      str: 14,
      skills: { climb: { name: 'Climb', ability: 'str', rank: 3, sort: 'i' } },
    });
    const res = await roll(
      table,
      { recipe: { name: 'skill', args: { id: 'climb' } }, actorId: actor.id },
      10,
    );
    expect(res.statusCode).toBe(201);
    const message = messageOf(res);
    expect(message).toMatchObject({
      kind: 'card',
      speaker: { name: 'Ayla', actorId: actor.id },
      rolls: [{ total: 15 }],
      card: {
        system: 'tiny-d20',
        recipe: 'skill',
        label: 'roll.skill',
        outcome: { index: 0, label: 'outcome.success', class: 'ok' },
        card: {
          name: 'skill',
          title: 'card.skill.title',
          outcome: true,
          rows: [
            {
              label: 'card.roll',
              value: expect.stringMatching(/^1d20 \+ .+ \+ 3$/) as unknown as string,
            },
            { label: 'card.total', value: '15', class: 'total' },
          ],
        },
      },
    });
    expect(message.text).toMatch(/^Roll: 1d20 \+ .+ = 15 \(Success\)$/);

    const low = messageOf(
      await roll(table, { recipe: { name: 'skill', args: { id: 'climb' } }, actorId: actor.id }, 2),
    );
    expect(low.card?.outcome?.label).toBe('outcome.failure');
  });

  it('refuses recipes it cannot roll', async () => {
    const table = await createTable(t.app, admin, { systemId: 'tiny-d20' });
    const actor = await hero(table, 'character', {});
    const code = async (payload: Record<string, unknown>) => {
      const res = await roll(table, payload);
      return [res.statusCode, res.json<{ error: { code: string } }>().error.code];
    };
    expect(await code({ recipe: { name: 'skill', args: { id: 'climb' } } })).toEqual([
      422,
      'actor_required',
    ]);
    expect(await code({ recipe: { name: 'nope' }, actorId: actor.id })).toEqual([
      422,
      'unknown_recipe',
    ]);
    expect(
      await code({ recipe: { name: 'skill', args: { id: 'missing' } }, actorId: actor.id }),
    ).toEqual([422, 'invalid_formula']);
    expect(await code({ formula: '1d6', recipe: { name: 'skill' } })).toEqual([
      400,
      'validation_failed',
    ]);
    expect(await code({})).toEqual([400, 'validation_failed']);
  });

  it('rolls an actor whose type the plugin dropped against its raw data', async () => {
    const table = await createTable(t.app, admin, { systemId: 'tiny-d20' });
    const actor = await hero(table, 'character', { str: 5 });
    t.db.update(actors).set({ type: 'retired' }).where(eq(actors.id, actor.id)).run();
    const res = await roll(table, { formula: '@str + 1', actorId: actor.id });
    expect(messageOf(res).rolls[0]?.total).toBe(6);
  });
});

describe('table settings (T-0603, FR-ADMIN-04)', () => {
  it('changes a derived value in a roll when the GM changes a house rule', async () => {
    const table = await createTable(t.app, admin, { systemId: 'tiny-d20' });
    const actor = await hero(table, 'character', { level: 3 });
    const maxHp = async () =>
      messageOf(await roll(table, { formula: '@derived.maxHp', actorId: actor.id })).rolls[0]
        ?.total;
    // tiny-d20: maxHp is @settings.startingHp + @level - 1, starting from the default 10.
    expect(await maxHp()).toBe(12);

    const events = await openSocket(t.app, admin);
    await events.request({ type: 'subscribe', tableId: table.id });
    const res = await call('PATCH', `/tables/${table.id}`, { settings: { startingHp: 20 } });
    expect(res.statusCode).toBe(200);
    expect(tableResponseSchema.parse(res.json()).table.settings).toEqual({ startingHp: 20 });
    expect(await maxHp()).toBe(22);
    // Open sheets hear about it, so their derived values follow.
    await events.next((event) => event.type === 'table.updated' && event.tableId === table.id);
  });

  it('refuses settings the system does not define or whose values do not fit', async () => {
    const table = await createTable(t.app, admin, { systemId: 'tiny-d20' });
    const res = await call('PATCH', `/tables/${table.id}`, {
      settings: { startingHp: 0, critFumble: 'yes', gridSize: 70 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: {
        code: 'validation_failed',
        details: [
          { path: 'settings.startingHp', reason: 'minimum' },
          { path: 'settings.critFumble', reason: 'type' },
          { path: 'settings.gridSize', reason: 'unknown' },
        ],
      },
    });
    const created = await call('POST', '/tables', {
      name: 'Odd',
      systemId: 'tiny-d20',
      settings: { startingHp: 1.5 },
    });
    expect(created.json()).toMatchObject({
      error: { details: [{ path: 'settings.startingHp', reason: 'type' }] },
    });
    // Settings it leaves out keep their defaults.
    const ok = await call('PATCH', `/tables/${table.id}`, { settings: { critFumble: false } });
    expect(ok.statusCode).toBe(200);
  });

  it('keeps house rules while the system is unavailable, but still allows a rename', async () => {
    const table = await createTable(t.app, admin, { systemId: 'tiny-d20' });
    await call('POST', '/plugins/tiny-d20/disable');
    const res = await call('PATCH', `/tables/${table.id}`, { settings: { startingHp: 12 } });
    expect(res.json()).toMatchObject({ error: { code: 'table_read_only' } });
    expect((await call('PATCH', `/tables/${table.id}`, { name: 'Paused' })).statusCode).toBe(200);
  });
});
