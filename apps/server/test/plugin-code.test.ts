import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ActorView, ChatMessage } from '@vtt/shared/api';

import { actors, members } from '../src/db/schema.js';
import { createLogger } from '../src/logger/index.js';
import {
  FUNCTION_TIME_LIMIT_MS,
  HANDLER_TIME_LIMIT_MS,
  PluginCodeError,
  PluginCodeRuntime,
  type HandlerHost,
} from '../src/plugins/code-runtime.js';

import {
  authHeaders,
  createTable,
  createTestApp,
  createUserClient,
  setupAdmin,
  type Client,
  type TestApp,
} from './support/app.js';
import { captureLogs } from './support/log-capture.js';

// T-0809, ADR-047: plugin shared and server code in a worker thread per plugin.

const SHARED = `export default {
  functions: {
    twice: (x) => x * 2,
    fail: () => { throw new Error('nope'); },
    spin: () => { for (;;) {} },
    object: () => ({ a: 1 }),
  },
};
`;

const SERVER = `export default {
  handlers: {
    attack: async ({ ctx, actor, args }) => {
      const hit = await ctx.roll('1d20 + ' + args.bonus);
      ctx.log('rolled', { total: hit.total });
      await ctx.chat.post({ text: actor.name + ' attacks', rolls: [hit] });
    },
    broken: async () => { throw new Error('the handler broke'); },
    asksBadly: async ({ ctx }) => { await ctx.actors.get('missing'); },
    hangs: () => new Promise(() => {}),
  },
  hooks: { onTurnStart: () => {} },
};
`;

let dir = '';
let runtime: PluginCodeRuntime;
let logs: ReturnType<typeof captureLogs>;

async function plugin(id: string, files: Record<string, string>): Promise<string[]> {
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(dir, id, ...file.split('/'));
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text);
  }
  return Object.keys(files);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vtt-code-'));
  logs = captureLogs();
  runtime = new PluginCodeRuntime({ dir, logger: createLogger('info', logs) });
});

afterEach(async () => {
  await runtime.reset();
  await rm(dir, { recursive: true, force: true });
});

describe('plugin code runtime (T-0809, ADR-047)', () => {
  it('loads nothing for a plugin without shared or server code', async () => {
    const entries = await plugin('client-only', { 'code/client.js': 'export default {};' });
    expect(await runtime.load('client-only', entries)).toBeUndefined();
  });

  it('calls shared functions synchronously, with their errors', async () => {
    const entries = await plugin('fns', { 'code/shared.js': SHARED });
    const code = await runtime.load('fns', entries);
    expect(Object.keys(code?.functions ?? {}).sort()).toEqual(['fail', 'object', 'spin', 'twice']);
    expect(code?.functions.twice?.(21)).toBe(42);
    expect(() => code?.functions.fail?.()).toThrow('nope');
    // The evaluator checks results; the runtime passes them through.
    expect(code?.functions.object?.()).toEqual({ a: 1 });
    // The same worker serves later loads.
    expect(await runtime.load('fns', entries)).toBe(code);
  });

  it('stops a shared function that runs too long, and starts a new worker after', async () => {
    const entries = await plugin('fns', { 'code/shared.js': SHARED });
    const code = await runtime.load('fns', entries);
    const started = Date.now();
    expect(() => code?.functions.spin?.()).toThrow(
      `longer than ${String(FUNCTION_TIME_LIMIT_MS)} ms`,
    );
    expect(Date.now() - started).toBeLessThan(FUNCTION_TIME_LIMIT_MS + 500);
    expect(logs.lines.some((line) => line.msg === 'plugin code stopped')).toBe(true);
    const fresh = await runtime.load('fns', entries);
    expect(fresh).not.toBe(code);
    expect(fresh?.functions.twice?.(2)).toBe(4);
  });

  it('runs handlers, answering their ctx calls on the main thread', async () => {
    const entries = await plugin('srv', { 'code/server.js': SERVER });
    const code = await runtime.load('srv', entries);
    expect([...(code?.handlers ?? [])].sort()).toEqual(['asksBadly', 'attack', 'broken', 'hangs']);
    const calls: [string, readonly unknown[]][] = [];
    const host: HandlerHost = (method, args) => {
      calls.push([method, args]);
      if (method === 'roll') return Promise.resolve({ total: 17, ref: 1 });
      if (method === 'get') return Promise.reject(new Error('no such actor'));
      return Promise.resolve(undefined);
    };
    await code?.handle('attack', { actor: { name: 'Ana' }, args: { bonus: 3 } }, host);
    expect(calls).toEqual([
      ['roll', ['1d20 + 3']],
      ['post', [{ text: 'Ana attacks', rolls: [{ total: 17, ref: 1 }] }]],
    ]);
    expect(logs.lines).toContainEqual(
      expect.objectContaining({ msg: 'rolled', plugin: 'srv', data: { total: 17 } }),
    );
  });

  it('turns failing handlers into handler_failed', async () => {
    const entries = await plugin('srv', { 'code/server.js': SERVER });
    const code = await runtime.load('srv', entries);
    const host: HandlerHost = () => Promise.reject(new Error('no such actor'));
    await expect(code?.handle('broken', {}, host)).rejects.toMatchObject({
      code: 'handler_failed',
      message: 'the handler broke',
    });
    await expect(code?.handle('asksBadly', {}, host)).rejects.toMatchObject({
      code: 'handler_failed',
      message: 'no such actor',
    });
    await expect(code?.handle('nothing', {}, host)).rejects.toBeInstanceOf(PluginCodeError);
  });

  it('refuses code whose default export has the wrong shape', async () => {
    const entries = await plugin('bad', {
      'code/server.js': 'export default { handlers: { attack: 3 } };',
    });
    await expect(runtime.load('bad', entries)).rejects.toMatchObject({
      code: 'plugin_code_failed',
      message: expect.stringContaining('handlers.attack is not a function') as unknown,
    });
  });
});

// Through the API: a system whose derived values and rolls call shared code, and whose
// handler recipes run server code as the roller.

const CODED = {
  'plugin.json': JSON.stringify({
    id: 'coded',
    name: 'Coded',
    version: '1.0.0',
    kind: 'system',
    coreApi: '^0.1.0',
    hasCode: true,
    locales: ['en'],
  }),
  'lang/en.json': JSON.stringify({ 'type.hero': 'Hero' }),
  'types/actors/hero.json': JSON.stringify({
    label: 'type.hero',
    controlledBy: 'player',
    sheet: 'hero',
    schema: {
      type: 'object',
      properties: {
        might: { type: 'integer', default: 4 },
        hp: { type: 'integer', default: 7, minimum: 0, maximum: 10, 'x-counter': true },
        notes: { type: 'string', default: 'hidden', 'x-layer': 'secret' },
      },
    },
    derived: { power: 'twice(@might)' },
  }),
  'sheets/hero.json': JSON.stringify({
    layout: { type: 'field', path: 'might', label: 'type.hero' },
  }),
  'rolls.json': JSON.stringify({
    check: { formula: '1d1 + @derived.power' },
    strike: { handler: 'strike' },
    peek: { handler: 'peek' },
    silent: { handler: 'silent' },
    crash: { handler: 'crash' },
    hang: { handler: 'hang' },
    heal: { handler: 'heal' },
    forge: { handler: 'forge' },
  }),
  'code/shared.js': `export default { functions: { twice: (x) => x * 2 } };`,
  'code/server.js': `export default {
  handlers: {
    strike: async ({ ctx, actor, args }) => {
      const hit = await ctx.roll('1d1 + twice(@might) + ' + args.bonus);
      await ctx.chat.post({ text: actor.name + ' strikes', rolls: [hit] });
      await ctx.chat.post({ text: 'and then?' });
    },
    peek: async ({ ctx, actor }) => {
      const seen = await ctx.actors.get(actor.id);
      await ctx.chat.post({ text: JSON.stringify(seen.data) });
    },
    silent: () => {},
    crash: async () => { throw new Error('secret plugin details'); },
    hang: () => new Promise(() => {}),
    heal: async ({ ctx, actor }) => {
      const hp = await ctx.actors.adjust(actor.id, 'hp', 2);
      await ctx.chat.post({ text: 'hp ' + hp });
    },
    forge: async ({ ctx }) => {
      await ctx.chat.post({ rolls: [{ ref: 1, total: 999 }] });
    },
  },
};
`,
};

describe('plugin code through the API (T-0809, ADR-047)', () => {
  let app: TestApp;
  let gm: Client;
  let bob: { client: Client; userId: string };
  let tableId = '';
  let heroId = '';

  beforeEach(async () => {
    for (const [file, text] of Object.entries(CODED)) {
      const full = path.join(dir, 'plugins', 'coded', ...file.split('/'));
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, text);
    }
    app = await createTestApp({ env: { DATA_DIR: dir }, rng: { nextInt: () => 0 } });
    gm = await setupAdmin(app.app);
    const headers = authHeaders(gm);
    const scan = await app.app.inject({ method: 'POST', url: '/api/v1/plugins/rescan', headers });
    expect(scan.json<{ plugins: { id: string; issues: unknown[] }[] }>().plugins).toContainEqual(
      expect.objectContaining({ id: 'coded', issues: [] }),
    );
    const enabled = await app.app.inject({
      method: 'POST',
      url: '/api/v1/plugins/coded/enable',
      headers,
      payload: { acknowledgeCode: true },
    });
    expect(enabled.statusCode).toBe(200);
    tableId = (await createTable(app.app, gm, { systemId: 'coded' })).id;
    bob = await createUserClient(app.app, gm, 'bob');
    app.db.insert(members).values({ tableId, userId: bob.userId, role: 'player' }).run();
    const res = await call(bob.client, 'POST', `/tables/${tableId}/actors`, {
      type: 'hero',
      name: 'Bo',
    });
    heroId = res.json<{ actor: ActorView }>().actor.id;
    app.db
      .update(actors)
      .set({ system: { might: 5, hp: 7, notes: 'gm only' } })
      .where(eq(actors.id, heroId))
      .run();
  });

  afterEach(async () => {
    await app.app.close();
  });

  const call = (client: Client, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: authHeaders(client),
      ...(payload && { payload }),
    });
  const recipe = (name: string, args: Record<string, unknown> = {}) =>
    call(bob.client, 'POST', `/tables/${tableId}/rolls`, {
      actorId: heroId,
      recipe: { name, args },
    });
  const history = async () =>
    (await call(bob.client, 'GET', `/tables/${tableId}/messages`)).json<{
      messages: ChatMessage[];
    }>().messages;

  it('rolls formulas and derived values with shared functions', async () => {
    const res = await recipe('check');
    expect(res.statusCode).toBe(201);
    expect(res.json<{ message: ChatMessage }>().message.rolls[0]?.total).toBe(11);
    const typed = await call(bob.client, 'POST', `/tables/${tableId}/rolls`, {
      actorId: heroId,
      formula: 'twice(3)',
    });
    expect(typed.json<{ message: ChatMessage }>().message.rolls[0]?.total).toBe(6);
  });

  it('runs a handler that rolls and posts as the roller, answering with the first message', async () => {
    const res = await recipe('strike', { bonus: 2 });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ message: ChatMessage }>().message).toMatchObject({
      kind: 'roll',
      text: 'Bo strikes',
      senderId: bob.userId,
      speaker: { name: 'Bo', actorId: heroId },
      rolls: [{ total: 13 }],
    });
    // Both are stored, newest first.
    expect((await history()).map((m) => m.text)).toEqual(['and then?', 'Bo strikes']);
  });

  it('shows handlers only what the roller may see', async () => {
    const res = await recipe('peek');
    expect(res.statusCode).toBe(201);
    const { text } = res.json<{ message: ChatMessage }>().message;
    expect(JSON.parse(text)).toEqual({ might: 5, hp: 7 });
  });

  it('adjusts counters of actors the roller owns', async () => {
    const res = await recipe('heal');
    expect(res.json<{ message: ChatMessage }>().message.text).toBe('hp 9');
  });

  it('refuses rolls a handler did not make', async () => {
    const res = await recipe('forge');
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('handler_failed');
    expect(await history()).toEqual([]);
  });

  it('fails handlers that post nothing, throw or hang, without leaking their errors', async () => {
    const code = async (name: string) =>
      (await recipe(name)).json<{ error: { code: string; message: string } }>().error;
    expect(await code('silent')).toMatchObject({ code: 'handler_no_message' });
    const crashed = await code('crash');
    expect(crashed.code).toBe('handler_failed');
    expect(crashed.message).not.toContain('secret');
    expect(app.logs.lines.some((l) => l.reason === 'secret plugin details')).toBe(true);
    // The server still answers afterwards.
    expect((await recipe('check')).statusCode).toBe(201);
  });

  it('stops a handler that runs too long', { timeout: HANDLER_TIME_LIMIT_MS + 5000 }, async () => {
    const res = await recipe('hang');
    expect(res.json<{ error: { code: string } }>().error.code).toBe('handler_timeout');
    expect((await recipe('strike', { bonus: 0 })).statusCode).toBe(201);
  });
});
