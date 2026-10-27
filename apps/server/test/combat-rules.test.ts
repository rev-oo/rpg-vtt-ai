import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  encounterResponseSchema,
  type ActorView,
  type ChatMessage,
  type EncounterView,
} from '@vtt/shared/api';

import { actors, members } from '../src/db/schema.js';
import { orderCombatants, type Orderable } from '../src/domain/combat.js';

import {
  authHeaders,
  createTable,
  createTestApp,
  createUserClient,
  setupAdmin,
  type Client,
  type TestApp,
} from './support/app.js';

// T-0802 (FR-COMBAT-02, ADR-050): initiative from combat.json, ordering rules and hooks.

describe('ordering rules', () => {
  const c = (id: string, initiative: number | null, side: 'player' | 'gm', sort: number) =>
    ({ id, initiative, side, sort }) satisfies Orderable;
  const list = [
    c('a', 12, 'player', 1),
    c('b', 15, 'gm', 2),
    c('c', null, 'gm', 3),
    c('d', 12, 'gm', 4),
    c('e', 3, 'player', 5),
  ];
  const ids = (rule: 'desc' | 'asc' | 'sideBased', items = list) =>
    orderCombatants(items, rule).map((x) => x.id);

  it('orders highest first, ties in adding order, without initiative last', () => {
    expect(ids('desc')).toEqual(['b', 'a', 'd', 'e', 'c']);
  });

  it('orders lowest first, still without initiative last', () => {
    expect(ids('asc')).toEqual(['e', 'a', 'd', 'b', 'c']);
  });

  it('lets the side with the best roll act first, each side highest first', () => {
    expect(ids('sideBased')).toEqual(['b', 'd', 'c', 'a', 'e']);
    // The players' side wins a tie between the sides.
    const tied = [c('p', 9, 'player', 2), c('g', 9, 'gm', 1)];
    expect(ids('sideBased', tied)).toEqual(['p', 'g']);
    expect(ids('sideBased', [c('x', null, 'gm', 1), c('y', null, 'player', 2)])).toEqual([
      'y',
      'x',
    ]);
  });
});

/** A system whose combat.json and server hooks each test chooses. */
function fighter(combat: object | null, hooks: string): Record<string, string> {
  const type = (controlledBy: string) =>
    JSON.stringify({
      label: 'type.x',
      controlledBy,
      sheet: 'x',
      schema: { type: 'object', properties: { might: { type: 'integer', default: 1 } } },
    });
  return {
    'plugin.json': JSON.stringify({
      id: 'fighter',
      name: 'Fighter',
      version: '1.0.0',
      kind: 'system',
      coreApi: '^0.1.0',
      hasCode: true,
      locales: ['en'],
    }),
    'lang/en.json': JSON.stringify({ 'type.x': 'X' }),
    'types/actors/hero.json': type('player'),
    'types/actors/brute.json': type('gm'),
    'sheets/x.json': JSON.stringify({ layout: { type: 'field', path: 'might', label: 'type.x' } }),
    ...(combat && { 'combat.json': JSON.stringify(combat) }),
    'code/server.js': `export default { hooks: { ${hooks} } };`,
  };
}

const TURN_HOOK = `onTurnStart: async ({ ctx, combatant, round, actor }) => {
  const parts = ['turn', combatant.name, 'round', round, 'side', combatant.side];
  if (actor) parts.push('might', actor.data.might);
  await ctx.chat.post({ text: parts.join(' ') });
},`;

describe('initiative and combat hooks (T-0802)', () => {
  let dir = '';
  let app: TestApp;
  let gm: Client;
  let bob: { client: Client; userId: string };
  let tableId = '';

  async function setup(combat: object | null, hooks = TURN_HOOK) {
    for (const [file, text] of Object.entries(fighter(combat, hooks))) {
      const full = path.join(dir, 'plugins', 'fighter', ...file.split('/'));
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, text);
    }
    // Every die rolls its lowest face: 1d20 + @might is 1 + might.
    app = await createTestApp({ env: { DATA_DIR: dir }, rng: { nextInt: () => 0 } });
    gm = await setupAdmin(app.app);
    const headers = authHeaders(gm);
    await app.app.inject({ method: 'POST', url: '/api/v1/plugins/rescan', headers });
    const enabled = await app.app.inject({
      method: 'POST',
      url: '/api/v1/plugins/fighter/enable',
      headers,
      payload: { acknowledgeCode: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    tableId = (await createTable(app.app, gm, { systemId: 'fighter' })).id;
    bob = await createUserClient(app.app, gm, 'bob');
    app.db.insert(members).values({ tableId, userId: bob.userId, role: 'player' }).run();
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'vtt-combat-'));
  });

  afterEach(async () => {
    await app.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const call = (client: Client, method: string, url: string, payload?: object) =>
    app.app.inject({
      method: method as 'GET',
      url: `/api/v1/tables/${tableId}${url}`,
      headers: authHeaders(client),
      ...(payload && { payload }),
    });

  async function change(path: string, payload?: object, method = 'POST') {
    const res = await call(gm, method, `/encounter${path}`, payload);
    expect(res.statusCode, res.body).toBeLessThan(300);
    return encounterResponseSchema.parse(res.json()).encounter;
  }

  async function actor(client: Client, type: string, name: string, might: number) {
    const res = await call(client, 'POST', '/actors', { type, name });
    expect(res.statusCode, res.body).toBe(201);
    const { id } = res.json<{ actor: ActorView }>().actor;
    app.db.update(actors).set({ system: { might } }).where(eq(actors.id, id)).run();
    return id;
  }

  async function chat(client: Client): Promise<string[]> {
    const res = await call(client, 'GET', '/messages');
    const { messages } = res.json<{ messages: ChatMessage[] }>();
    return messages.reverse().map((m) => `${m.speaker.name}: ${m.text}`);
  }

  const names = (view: EncounterView | null) =>
    view?.combatants.map((c) => `${c.name} ${String(c.initiative)}`);
  const current = (view: EncounterView | null) =>
    view?.combatants.find((c) => c.id === view.currentId)?.name;

  it('rolls initiative from combat.json and runs onTurnStart once per turn', async () => {
    await setup({ initiative: '1d20 + @might', order: 'desc' });
    const bo = await actor(bob.client, 'hero', 'Bo', 5);
    const ogre = await actor(gm, 'brute', 'Ogre', 2);
    await change('');
    await change('/combatants', { actorId: bo });
    await change('/combatants', { actorId: ogre, hidden: true });
    await change('/combatants', { name: 'Rat' });

    // The free-form Rat has no might: the GM types its initiative.
    let view = await change('/initiative');
    expect(names(view)).toEqual(['Bo 6', 'Ogre 3', 'Rat null']);
    view = await change(
      `/combatants/${String(view?.combatants[2]?.id)}`,
      { initiative: 4 },
      'PATCH',
    );
    expect(names(view)).toEqual(['Bo 6', 'Rat 4', 'Ogre 3']);

    view = await change('/start');
    expect(current(view)).toBe('Bo');
    for (let i = 0; i < 3; i += 1) view = await change('/turn', { direction: 'next' });
    expect([view?.round, current(view)]).toEqual([2, 'Bo']);
    // Stepping back is no new turn.
    await change('/turn', { direction: 'previous' });

    const turns = (lines: string[]) => lines.filter((line) => line.includes(' turn '));
    expect(turns(await chat(gm))).toEqual([
      'Bo: turn Bo round 1 side player might 5',
      'Admin: turn Rat round 1 side gm',
      'Ogre: turn Ogre round 1 side gm might 2',
      'Bo: turn Bo round 2 side player might 5',
    ]);
    // The hidden Ogre's roll and turn reach only the GM.
    const seen = await chat(bob.client);
    expect(seen).toContain('Bo: 1d20 + @might');
    expect(seen.some((line) => line.includes('Ogre'))).toBe(false);
  });

  it('orders side by side with sideBased', async () => {
    await setup({ initiative: '1d20 + @might', order: 'sideBased' });
    const bo = await actor(bob.client, 'hero', 'Bo', 5);
    const ogre = await actor(gm, 'brute', 'Ogre', 2);
    await change('');
    await change('/combatants', { actorId: bo });
    await change('/combatants', { actorId: ogre });
    expect(names(await change('/initiative'))).toEqual(['Bo 6', 'Ogre 3']);
    // A free-form combatant is on the GM's side, which now has the best roll.
    const view = await change('/combatants', { name: 'Wolf', initiative: 10 });
    expect(names(view)).toEqual(['Wolf 10', 'Ogre 3', 'Bo 6']);
  });

  it('lets an orderCombatants hook order the turns, and falls back on a bad answer', async () => {
    await setup(
      { order: 'desc' },
      `orderCombatants: ({ combatants }) => {
        if (combatants.some((c) => c.name === 'Bad')) return ['nope'];
        return [...combatants].sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.id);
      },`,
    );
    await change('');
    await change('/combatants', { name: 'Zed', initiative: 20 });
    expect(names(await change('/combatants', { name: 'Amy', initiative: 1 }))).toEqual([
      'Amy 1',
      'Zed 20',
    ]);
    expect(names(await change('/combatants', { name: 'Bad', initiative: 5 }))).toEqual([
      'Zed 20',
      'Bad 5',
      'Amy 1',
    ]);
    // Without a formula there is nothing to roll.
    const res = await call(gm, 'POST', '/encounter/initiative');
    expect(res.json<{ error: { code: string } }>().error.code).toBe('no_initiative');
  });

  it('keeps initiative rolls for GMs and assistants', async () => {
    await setup({ initiative: '1d20 + @might' });
    await change('');
    expect((await call(bob.client, 'POST', '/encounter/initiative')).statusCode).toBe(403);
    await change('/combatants', { name: 'Rat' });
    const res = await call(gm, 'POST', '/encounter/initiative');
    expect(res.json<{ error: { code: string } }>().error.code).toBe('initiative_failed');
  });
});
