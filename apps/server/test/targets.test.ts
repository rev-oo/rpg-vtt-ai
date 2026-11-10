import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { documentName } from '@vtt/shared';
import {
  sceneResponseSchema,
  type ActorView,
  type ChatMessage,
  type EncounterResponse,
  type TokenView,
} from '@vtt/shared/api';

import { actors, members } from '../src/db/schema.js';
import { COLLAB_TIMING } from '../src/realtime/collab.js';

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
import { openSocket } from './support/socket.js';

// T-1615: rolls carry the tokens their roller targets; recipes read the first as `@target`,
// and cards offer actions on the targets to those who may edit them. Actor types show
// true/false fields as statuses on tokens and in the combat tracker.

const json = (value: unknown) => JSON.stringify(value);

const fighter = (ac: number) => ({
  type: 'object',
  properties: {
    ac: { type: 'integer', default: ac },
    prone: { type: 'boolean', default: false },
    marked: { type: 'boolean', default: false, 'x-layer': 'secret' },
    hp: {
      type: 'object',
      properties: {
        value: { type: 'integer', default: 10, minimum: 0, maximum: '@hp.max', 'x-counter': true },
        max: { type: 'integer', default: 10 },
      },
    },
  },
});

const STATUSES = [
  { field: 'prone', label: 'status.prone', icon: 'icons/prone.svg' },
  { field: 'marked', label: 'Marked', icon: 'icons/marked.svg' },
];

const AIMED = {
  'plugin.json': json({
    id: 'aimed',
    name: 'Aimed',
    version: '1.0.0',
    kind: 'system',
    coreApi: '^0.1.0',
    hasCode: false,
    locales: ['en'],
  }),
  'lang/en.json': json({ 'status.prone': 'Prone' }),
  'icons/prone.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  'icons/marked.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  'types/actors/hero.json': json({
    label: 'Hero',
    controlledBy: 'player',
    sheet: 'fighter',
    schema: fighter(12),
    derived: { guard: '@ac + 1' },
    statuses: STATUSES,
  }),
  'types/actors/monster.json': json({
    label: 'Monster',
    controlledBy: 'gm',
    sheet: 'fighter',
    schema: fighter(15),
    derived: { guard: '@ac + 1' },
    statuses: STATUSES,
  }),
  'sheets/fighter.json': json({ layout: { type: 'field', path: 'ac', label: 'AC' } }),
  'rolls.json': json({
    strike: {
      formula: { hit: '1d20', damage: '1d6' },
      target: ['hero', 'monster'],
      outcomes: [
        { when: '@targets > 0 and @rolls.hit.total >= @target.derived.guard', label: 'Hit' },
        { when: '@targets > 0', label: 'Miss' },
      ],
      card: 'strike',
    },
    glare: { formula: '1d1', target: ['monster'] },
    plain: { formula: '1d1' },
  }),
  'cards/strike.json': json({
    title: 'Strike',
    rows: [
      { label: 'Target', value: "@targets > 0 ? @target.name + ' ' + text(@target.ac) : '—'" },
      { label: 'Targets', value: '@targets' },
    ],
    apply: [
      { label: 'Apply damage', field: 'hp.value', amount: '-@rolls.damage.total' },
      { label: 'Broken', field: 'hp.value', amount: "'lots'" },
    ],
    outcome: true,
  }),
};

describe('targets and token statuses (T-1615)', () => {
  let dir = '';
  let app: TestApp;
  let gm: Client;
  let bob: { client: Client; userId: string };
  let tableId = '';
  let sceneId = '';
  let heroId = '';
  let monsterId = '';
  let heroToken = '';
  let monsterToken = '';
  let rolls: number[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'vtt-targets-'));
    for (const [file, text] of Object.entries(AIMED)) {
      const full = path.join(dir, 'plugins', 'aimed', ...file.split('/'));
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, text);
    }
    rolls = [];
    app = await createTestApp({
      env: { DATA_DIR: dir },
      rng: { nextInt: (n) => Math.min(rolls.shift() ?? 1, n) - 1 },
      // Short debounces, so stores happen within a test.
      collabTiming: { ...COLLAB_TIMING, debounceMs: 20, maxDebounceMs: 100 },
    });
    gm = await setupAdmin(app.app);
    const headers = authHeaders(gm);
    const scan = await app.app.inject({ method: 'POST', url: '/api/v1/plugins/rescan', headers });
    expect(scan.json<{ plugins: { id: string; issues: unknown[] }[] }>().plugins).toContainEqual(
      expect.objectContaining({ id: 'aimed', issues: [] }),
    );
    const enabled = await app.app.inject({
      method: 'POST',
      url: '/api/v1/plugins/aimed/enable',
      headers,
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    tableId = (await createTable(app.app, gm, { systemId: 'aimed' })).id;
    bob = await createUserClient(app.app, gm, 'bob');
    app.db.insert(members).values({ tableId, userId: bob.userId, role: 'player' }).run();
    heroId = await actor(bob.client, 'hero', 'Bo');
    monsterId = await actor(gm, 'monster', 'Ogre');
    const created = await call(gm, 'POST', `/tables/${tableId}/scenes`, {
      name: 'Field',
      columns: 10,
      rows: 8,
    });
    sceneId = sceneResponseSchema.parse(created.json()).scene.id;
    await call(gm, 'POST', `/tables/${tableId}/scenes/active`, { sceneId });
    heroToken = await place({ actorId: heroId, column: 1, row: 1 });
    monsterToken = await place({ actorId: monsterId, column: 2, row: 1 });
  });

  afterEach(async () => {
    await app.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const call = (client: Client, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    app.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: authHeaders(client),
      ...(payload && { payload }),
    });
  async function actor(client: Client, type: string, name: string): Promise<string> {
    const res = await call(client, 'POST', `/tables/${tableId}/actors`, { type, name });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ actor: ActorView }>().actor.id;
  }
  async function place(body: object): Promise<string> {
    const res = await call(gm, 'POST', `/scenes/${sceneId}/tokens`, body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ token: TokenView }>().token.id;
  }
  const strike = (targets: string[], name = 'strike', client = bob.client, actorId = heroId) =>
    call(client, 'POST', `/tables/${tableId}/rolls`, {
      actorId,
      recipe: { name, args: {}, targets },
    });
  const posted = (res: Awaited<ReturnType<typeof strike>>) => {
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ message: ChatMessage }>().message;
  };
  const code = (res: Awaited<ReturnType<typeof strike>>) =>
    res.json<{ error: { code: string } }>().error.code;
  const hp = (id: string) => {
    const system = app.db
      .select({ system: actors.system })
      .from(actors)
      .where(eq(actors.id, id))
      .get()?.system;
    const value: unknown = system?.hp;
    return typeof value === 'object' && value !== null && 'value' in value
      ? value.value
      : undefined;
  };
  const setData = (id: string, system: Record<string, unknown>) => {
    app.db.update(actors).set({ system }).where(eq(actors.id, id)).run();
  };
  const tokensSeenBy = async (client: Client) =>
    (await call(client, 'GET', `/scenes/${sceneId}/tokens`)).json<{ tokens: TokenView[] }>().tokens;

  it('reads the first target as @target and keeps the targets on the card', async () => {
    rolls = [16, 4];
    const hit = posted(await strike([monsterToken]));
    expect(hit.card?.outcome?.label).toBe('Hit');
    expect(hit.card?.card?.rows[0]).toMatchObject({ label: 'Target', value: 'Ogre 15' });
    expect(hit.card?.targets).toEqual([
      { tokenId: monsterToken, actorId: monsterId, name: 'Ogre', applied: [] },
    ]);
    expect(hit.card?.card?.apply).toEqual([
      { label: 'Apply damage', field: 'hp.value', amount: -4 },
      expect.objectContaining({ label: 'Broken', amount: 0, error: expect.any(String) as unknown }),
    ]);

    rolls = [15, 4];
    expect(posted(await strike([monsterToken, heroToken])).card).toMatchObject({
      outcome: { label: 'Miss' },
      card: { rows: [{ value: 'Ogre 15' }, { value: '2' }] },
      targets: [{ name: 'Ogre' }, { name: 'Bo' }],
    });
    // Without targets, `@target` does not exist and the formulas that guard it say so.
    const alone = posted(await strike([]));
    expect(alone.card).toMatchObject({ outcome: null, targets: [] });
    expect(alone.card?.card?.rows[0]?.value).toBe('—');
  });

  it('refuses targets the roller cannot see, tokens alone, and recipes that do not target', async () => {
    const hidden = await place({ actorId: monsterId, column: 3, row: 1, hidden: true });
    const loose = await place({ name: 'Barrel', column: 4, row: 1 });
    expect(code(await strike([hidden]))).toBe('unknown_target');
    expect(code(await strike([loose]))).toBe('unknown_target');
    expect(code(await strike([crypto.randomUUID()]))).toBe('unknown_target');
    // The GM sees the hidden token, so the GM may target it.
    expect(posted(await strike([hidden], 'strike', gm)).card?.targets).toHaveLength(1);
    expect(code(await strike([monsterToken], 'plain'))).toBe('bad_target');
    expect(code(await strike([heroToken], 'glare'))).toBe('bad_target');
  });

  it('applies a card action once, for members who may edit the target', async () => {
    rolls = [20, 4];
    const message = posted(await strike([monsterToken, heroToken]));
    const apply = (client: Client, target: number, action = 0) =>
      call(client, 'POST', `/messages/${message.id}/apply`, { target, action });

    // Bob may not change the GM's monster, but may change his own hero.
    expect((await apply(bob.client, 0)).statusCode).toBe(403);
    const own = await apply(bob.client, 1);
    expect(own.statusCode, own.body).toBe(200);
    await vi.waitFor(() => {
      expect(hp(heroId)).toBe(6);
    });

    const done = await apply(gm, 0);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json<{ message: ChatMessage }>().message.card?.targets).toMatchObject([
      { name: 'Ogre', applied: [0] },
      { name: 'Bo', applied: [0] },
    ]);
    await vi.waitFor(() => {
      expect(hp(monsterId)).toBe(6);
    });
    // Once per target, and only actions that worked out.
    expect(code(await apply(gm, 0))).toBe('already_applied');
    expect(code(await apply(gm, 0, 1))).toBe('unknown_action');
    expect(code(await apply(gm, 5))).toBe('unknown_action');
  });

  it('shows the statuses that are on, secret ones only to GMs, on tokens and combatants', async () => {
    setData(monsterId, { prone: true, marked: true });
    const prone = {
      field: 'prone',
      label: 'status.prone',
      iconUrl: '/plugins/aimed/icons/prone.svg',
    };
    const marked = { field: 'marked', label: 'Marked', iconUrl: '/plugins/aimed/icons/marked.svg' };
    const ogre = (seen: TokenView[]) => seen.find((token) => token.id === monsterToken)?.statuses;
    expect(ogre(await tokensSeenBy(gm))).toEqual([prone, marked]);
    expect(ogre(await tokensSeenBy(bob.client))).toEqual([prone]);
    expect((await tokensSeenBy(bob.client)).find((t) => t.id === heroToken)?.statuses).toEqual([]);

    await call(gm, 'POST', `/tables/${tableId}/encounter`);
    await call(gm, 'POST', `/tables/${tableId}/encounter/combatants`, { actorId: monsterId });
    const encounter = (
      await call(bob.client, 'GET', `/tables/${tableId}/encounter`)
    ).json<EncounterResponse>();
    expect(encounter.encounter?.combatants[0]?.statuses).toEqual([prone]);
  });

  it('tells the table when a sheet change turns a status on', async () => {
    await call(gm, 'POST', `/tables/${tableId}/encounter`);
    await call(gm, 'POST', `/tables/${tableId}/encounter/combatants`, { actorId: monsterId });
    const socket = await openSocket(app.app, bob.client);
    await socket.request({ type: 'subscribe', tableId });
    const sheet = await (
      await openCollab(app.app, gm)
    ).open(documentName({ kind: 'actor', id: monsterId, layer: 'main' }));
    expect(await sheet.change((doc) => doc.getMap('data').set('prone', true))).toBe(true);
    await socket.next((event) => event.type === 'token.updated');
    await socket.next((event) => event.type === 'combat.updated');
    expect((await tokensSeenBy(bob.client)).find((t) => t.id === monsterToken)?.statuses).toEqual([
      expect.objectContaining({ field: 'prone' }),
    ]);
  });
});
