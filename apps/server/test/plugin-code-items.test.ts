import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { documentName } from '@vtt/shared';
import type { ActorView, ChatMessage } from '@vtt/shared/api';

import { actors, items, members } from '../src/db/schema.js';

import {
  authHeaders,
  createTable,
  createTestApp,
  createUserClient,
  setupAdmin,
  type Client,
  type TestApp,
} from './support/app.js';
import { openCollab } from './support/collab.js';

// T-1610: server code works with items, derived values and item totals, steps item counters
// and sets fields, with the roller's rights; counters may be bounded by formulas; a formula
// recipe's `then` runs server code after its card is posted.

const json = (value: unknown) => JSON.stringify(value);

const GEMMED = {
  'plugin.json': json({
    id: 'gemmed',
    name: 'Gemmed',
    version: '1.0.0',
    kind: 'system',
    coreApi: '^0.1.0',
    hasCode: true,
    locales: ['en'],
  }),
  'lang/en.json': json({ 'type.hero': 'Hero', 'type.gem': 'Gem' }),
  'types/actors/hero.json': json({
    label: 'type.hero',
    controlledBy: 'player',
    sheet: 'hero',
    schema: {
      type: 'object',
      properties: {
        might: { type: 'integer', default: 4 },
        title: { type: 'string', default: '', maxLength: 10 },
        hp: {
          type: 'object',
          properties: {
            value: {
              type: 'integer',
              default: 5,
              minimum: 0,
              maximum: 'cap(@hp.max)',
              'x-counter': true,
            },
            max: { type: 'integer', default: 8 },
          },
        },
        notes: { type: 'string', default: 'hidden', 'x-layer': 'secret' },
      },
    },
    derived: { power: 'twice(@might)' },
  }),
  'types/items/gem.json': json({
    label: 'type.gem',
    sheet: 'gem',
    schema: {
      type: 'object',
      properties: {
        charges: {
          type: 'object',
          properties: {
            used: { type: 'integer', default: 0, maximum: '@charges.max', 'x-counter': true },
            max: { type: 'integer', default: 3 },
          },
        },
      },
    },
    derived: { worth: '@charges.max * 10' },
    contributes: { gems: { formula: '1' } },
  }),
  'sheets/hero.json': json({ layout: { type: 'field', path: 'might', label: 'type.hero' } }),
  'sheets/gem.json': json({ layout: { type: 'field', path: 'charges.max', label: 'type.gem' } }),
  'rolls.json': json({
    look: { handler: 'look', item: ['gem'] },
    drain: { handler: 'drain', item: ['gem'] },
    drainById: { handler: 'drainById' },
    heal: { handler: 'heal' },
    rename: { handler: 'rename' },
    cast: {
      formula: '1d1 + @options.level',
      options: { level: { type: 'number', label: 'Level', default: 1, minimum: 1, maximum: 3 } },
      item: ['gem'],
      then: 'spend',
    },
    fizzle: { formula: '1d1', then: 'refuse' },
    lost: { formula: '1d1', then: 'missing' },
  }),
  // Bounds may call shared functions.
  'code/shared.js': `export default { functions: { twice: (x) => x * 2, cap: (x) => x - 1 } };`,
  'code/server.js': `export default {
  handlers: {
    look: async ({ ctx, derived, totals, items, item, options }) => {
      await ctx.chat.post({ text: JSON.stringify({ derived, totals, items, item, options }) });
    },
    drain: async ({ ctx, item }) => {
      const left = await ctx.items.adjust(item.id, 'charges.used', 5);
      await ctx.chat.post({ text: 'used ' + left });
    },
    drainById: async ({ ctx, args }) => {
      await ctx.items.adjust(args.id, 'charges.used', 1);
      await ctx.chat.post({ text: 'drained' });
    },
    heal: async ({ ctx, actor }) => {
      const hp = await ctx.actors.adjust(actor.id, 'hp.value', 10);
      await ctx.chat.post({ text: 'hp ' + hp });
    },
    rename: async ({ ctx, actor, args }) => {
      try {
        await ctx.actors.set(actor.id, args.path, args.value);
        await ctx.chat.post({ text: 'set' });
      } catch (error) {
        await ctx.chat.post({ text: error.message });
      }
    },
    spend: async ({ ctx, item, options, result }) => {
      const used = await ctx.items.adjust(item.id, 'charges.used', options.level);
      await ctx.chat.post({ text: 'spent ' + used + ' after ' + result.total });
    },
    refuse: ({ ctx }) => { ctx.fail('No charge left.'); },
  },
};
`,
};

describe('server code with items, derived values and bounds (T-1610)', () => {
  let dir = '';
  let app: TestApp;
  let gm: Client;
  let bob: { client: Client; userId: string };
  let carol: { client: Client; userId: string };
  let tableId = '';
  let heroId = '';
  let gemId = '';
  let carolHeroId = '';

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'vtt-items-'));
    for (const [file, text] of Object.entries(GEMMED)) {
      const full = path.join(dir, 'plugins', 'gemmed', ...file.split('/'));
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, text);
    }
    app = await createTestApp({ env: { DATA_DIR: dir }, rng: { nextInt: () => 0 } });
    gm = await setupAdmin(app.app);
    const headers = authHeaders(gm);
    const scan = await app.app.inject({ method: 'POST', url: '/api/v1/plugins/rescan', headers });
    expect(scan.json<{ plugins: { id: string; issues: unknown[] }[] }>().plugins).toContainEqual(
      expect.objectContaining({ id: 'gemmed', issues: [] }),
    );
    const enabled = await app.app.inject({
      method: 'POST',
      url: '/api/v1/plugins/gemmed/enable',
      headers,
      payload: { acknowledgeCode: true },
    });
    expect(enabled.statusCode).toBe(200);
    tableId = (await createTable(app.app, gm, { systemId: 'gemmed' })).id;
    bob = await createUserClient(app.app, gm, 'bob');
    carol = await createUserClient(app.app, gm, 'carol');
    for (const { userId } of [bob, carol]) {
      app.db.insert(members).values({ tableId, userId, role: 'player' }).run();
    }
    heroId = await hero(bob.client, 'Bo');
    carolHeroId = await hero(carol.client, 'Cy');
    app.db
      .update(actors)
      .set({ system: { might: 5, hp: { value: 5, max: 8 }, notes: 'gm only' } })
      .where(eq(actors.id, heroId))
      .run();
    gemId = randomUUID();
    app.db
      .insert(items)
      .values({
        id: gemId,
        tableId,
        actorId: heroId,
        type: 'gem',
        name: 'Ruby',
        system: { charges: { used: 1, max: 3 } },
        dataVersion: '1.0.0',
      })
      .run();
  });

  afterEach(async () => {
    await app.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const call = (client: Client, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: authHeaders(client),
      ...(payload && { payload }),
    });
  async function hero(client: Client, name: string): Promise<string> {
    const res = await call(client, 'POST', `/tables/${tableId}/actors`, { type: 'hero', name });
    return res.json<{ actor: ActorView }>().actor.id;
  }
  const roll = (
    name: string,
    recipe: { args?: Record<string, unknown>; itemId?: string; options?: object } = {},
    { client = bob.client, actorId = heroId } = {},
  ) =>
    call(client, 'POST', `/tables/${tableId}/rolls`, {
      actorId,
      recipe: { name, args: {}, ...recipe },
    });
  const said = (res: Awaited<ReturnType<typeof roll>>) => {
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ message: ChatMessage }>().message.text;
  };
  const history = async () =>
    (await call(bob.client, 'GET', `/tables/${tableId}/messages`)).json<{
      messages: ChatMessage[];
    }>().messages;
  const stored = (table: typeof actors | typeof items, id: string) =>
    app.db.select({ system: table.system }).from(table).where(eq(table.id, id)).get()?.system;

  it('gives handlers the item, derived values, item totals and held items', async () => {
    const seen: unknown = JSON.parse(said(await roll('look', { itemId: gemId })));
    const gem = {
      id: gemId,
      name: 'Ruby',
      type: 'gem',
      data: { charges: { used: 1, max: 3 } },
      derived: { worth: 30 },
    };
    expect(seen).toEqual({
      derived: { power: 10 },
      totals: { gems: 1 },
      items: [gem],
      item: gem,
      options: {},
    });
    // A handler recipe made with an item needs one the actor holds.
    expect((await roll('look')).json<{ error: { code: string } }>().error.code).toBe(
      'item_required',
    );
  });

  it('steps item counters within their formula bounds', async () => {
    expect(said(await roll('drain', { itemId: gemId }))).toBe('used 3');
    await expect.poll(() => stored(items, gemId)).toEqual({ charges: { used: 3, max: 3 } });
  });

  it("refuses to change another player's items", async () => {
    const res = await roll(
      'drainById',
      { args: { id: gemId } },
      { client: carol.client, actorId: carolHeroId },
    );
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('handler_failed');
    expect(app.logs.lines.some((l) => l.reason === 'The sender cannot edit that item.')).toBe(true);
  });

  it('stops actor counters at their formula bounds, shared functions included', async () => {
    // `cap(@hp.max)` is 7.
    expect(said(await roll('heal'))).toBe('hp 7');
  });

  it('sets plain fields, and says why it cannot', async () => {
    const rename = async (fieldPath: string, value: unknown) =>
      said(await roll('rename', { args: { path: fieldPath, value } }));
    expect(await rename('title', 'Sir')).toBe('set');
    await expect.poll(() => stored(actors, heroId)).toMatchObject({ title: 'Sir' });
    expect(await rename('title', 'Sir Bo the Brave')).toBe('"title" is too long.');
    expect(await rename('hp.value', 3)).toBe(
      '"hp.value" is a counter: step it with ctx.actors.adjust.',
    );
    expect(await rename('hp', 3)).toBe('"hp" is not a text, number or true/false field.');
    // Players cannot reach secret fields.
    expect(await rename('notes', 'mine')).toBe('"notes" is not a field the sender can set.');
  });

  it('runs `then` after the card, with the options and the result', async () => {
    const res = await roll('cast', { itemId: gemId, options: { level: 2 } });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<{ message: ChatMessage }>().message.kind).toBe('card');
    const texts = (await history()).map((m) => m.text);
    expect(texts[0]).toBe('spent 3 after 3');
    expect(texts).toHaveLength(2);
  });

  it('keeps the card when `then` fails, showing what ctx.fail says', async () => {
    expect((await roll('fizzle')).statusCode).toBe(201);
    expect((await history()).map((m) => [m.kind, m.text])).toEqual([
      ['text', 'No charge left.'],
      ['card', expect.any(String)],
    ]);
    expect((await roll('lost')).statusCode).toBe(201);
    expect(app.logs.lines.some((l) => l.msg === 'the system’s code has no such handler')).toBe(
      true,
    );
  });

  it('bounds steps from sheets by formulas too', async () => {
    const sheet = await (
      await openCollab(app.app, bob.client)
    ).open(documentName({ kind: 'actor', id: heroId, layer: 'main' }));
    sheet.send({ type: 'adjust', id: 's1', path: ['hp', 'value'], delta: 10 });
    expect(await sheet.next()).toEqual(
      expect.objectContaining({ type: 'adjusted', id: 's1', value: 7, clamped: true }),
    );
  });
});
