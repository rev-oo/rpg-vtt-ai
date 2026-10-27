import { describe, expect, it } from 'vitest';

import { encounterResponseSchema, type ActorView, type EncounterView } from '@vtt/shared/api';

import type { Client } from './support/app.js';
import { openSocket } from './support/socket.js';
import { setupTable, type TableSetup } from './support/table.js';

// T-0801 (FR-COMBAT-01, 03, 04; ADR-049): the table's encounter, run by the GM.

const url = (t: TableSetup, path = '') => `/tables/${t.table.id}/encounter${path}`;

async function encounter(
  t: TableSetup,
  client: Client,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  path = '',
  payload?: Record<string, unknown>,
): Promise<EncounterView | null> {
  const res = await t.call(client, method, url(t, path), payload);
  expect(res.statusCode, res.body).toBeLessThan(300);
  return encounterResponseSchema.parse(res.json()).encounter;
}

const names = (view: EncounterView | null) => view?.combatants.map((c) => c.name);
const current = (view: EncounterView | null) =>
  view?.combatants.find((c) => c.id === view.currentId)?.name ?? null;

async function actor(
  t: TableSetup,
  client: Client,
  body: Record<string, unknown>,
): Promise<ActorView> {
  const res = await t.call(client, 'POST', `/tables/${t.table.id}/actors`, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ actor: ActorView }>().actor;
}

describe('encounters (T-0801)', () => {
  it('lets the GM run an encounter through two rounds', async () => {
    const t = await setupTable();
    expect(await encounter(t, t.bob.client)).toBeNull();
    const hero = await actor(t, t.bob.client, { type: 'character', name: 'Ayla' });

    expect(await encounter(t, t.gm.client, 'POST')).toMatchObject({ round: 0, combatants: [] });
    await encounter(t, t.gm.client, 'POST', '/combatants', { actorId: hero.id, initiative: 12 });
    await encounter(t, t.gm.client, 'POST', '/combatants', { name: 'Goblin', initiative: 15 });
    const added = await encounter(t, t.gm.client, 'POST', '/combatants', { name: 'Wolf' });
    // Highest initiative first; those without one last.
    expect(names(added)).toEqual(['Goblin', 'Ayla', 'Wolf']);
    expect(added?.combatants[1]).toMatchObject({ actorId: hero.id, initiative: 12 });

    let view = await encounter(t, t.gm.client, 'POST', '/start');
    expect([view?.round, current(view)]).toEqual([1, 'Goblin']);
    const turns: [number | undefined, string | null][] = [];
    for (let i = 0; i < 4; i += 1) {
      view = await encounter(t, t.gm.client, 'POST', '/turn', { direction: 'next' });
      turns.push([view?.round, current(view)]);
    }
    expect(turns).toEqual([
      [1, 'Ayla'],
      [1, 'Wolf'],
      [2, 'Goblin'],
      [2, 'Ayla'],
    ]);
    await encounter(t, t.gm.client, 'POST', '/turn', { direction: 'previous' });
    view = await encounter(t, t.gm.client, 'POST', '/turn', { direction: 'previous' });
    expect([view?.round, current(view)]).toEqual([1, 'Wolf']);

    // Players read the same encounter.
    expect(names(await encounter(t, t.bob.client))).toEqual(['Goblin', 'Ayla', 'Wolf']);

    const ended = await t.call(t.gm.client, 'DELETE', url(t));
    expect(ended.statusCode).toBe(204);
    expect(await encounter(t, t.bob.client)).toBeNull();
  });

  it('reorders on new initiative and passes the turn on when its holder leaves', async () => {
    const t = await setupTable();
    await encounter(t, t.gm.client, 'POST');
    for (const name of ['A', 'B', 'C']) {
      await encounter(t, t.gm.client, 'POST', '/combatants', { name });
    }
    let view = await encounter(t, t.gm.client, 'POST', '/start');
    const [a, b] = view?.combatants ?? [];
    view = await encounter(t, t.gm.client, 'PATCH', `/combatants/${String(b?.id)}`, {
      initiative: 20,
    });
    expect(names(view)).toEqual(['B', 'A', 'C']);
    expect(current(view)).toBe('A');
    view = await encounter(t, t.gm.client, 'DELETE', `/combatants/${String(a?.id)}`);
    expect([names(view), current(view)]).toEqual([['B', 'C'], 'C']);
  });

  it('keeps the encounter for GMs and assistants to run', async () => {
    const t = await setupTable();
    const asBob = await t.call(t.bob.client, 'POST', url(t));
    expect(asBob.statusCode).toBe(403);
    await encounter(t, t.gm.client, 'POST');
    expect((await t.call(t.gm.client, 'POST', url(t))).statusCode).toBe(409);
    for (const who of [t.bob, t.dave]) {
      const res = await t.call(who.client, 'POST', url(t, '/combatants'), { name: 'Sneak' });
      expect(res.statusCode).toBe(403);
    }
    expect((await t.call(t.eve.client, 'GET', url(t))).statusCode).toBe(404);
    const early = await t.call(t.gm.client, 'POST', url(t, '/turn'), { direction: 'next' });
    expect(early.json<{ error: { code: string } }>().error.code).toBe('encounter_not_started');
    const empty = await t.call(t.gm.client, 'POST', url(t, '/start'));
    expect(empty.json<{ error: { code: string } }>().error.code).toBe('no_combatants');
  });

  it('shows players neither hidden combatants nor actors they cannot see (FR-COMBAT-04)', async () => {
    const t = await setupTable();
    const lurker = await actor(t, t.gm.client, {
      type: 'npc',
      name: 'Lurker',
      ownership: { default: 'none', users: {} },
    });
    await encounter(t, t.gm.client, 'POST');
    await encounter(t, t.gm.client, 'POST', '/combatants', {
      name: 'Assassin',
      hidden: true,
      initiative: 30,
    });
    await encounter(t, t.gm.client, 'POST', '/combatants', {
      actorId: lurker.id,
      name: 'Shadow',
      initiative: 10,
    });
    const gmView = await encounter(t, t.gm.client, 'POST', '/start');
    expect(names(gmView)).toEqual(['Assassin', 'Shadow']);
    expect(current(gmView)).toBe('Assassin');

    const bobView = await encounter(t, t.bob.client);
    expect(bobView?.combatants).toEqual([
      {
        id: expect.any(String) as unknown,
        actorId: null,
        name: 'Shadow',
        initiative: 10,
        hidden: false,
      },
    ]);
    // The hidden combatant has the turn, so players do not learn whose it is.
    expect(bobView?.currentId).toBeNull();
  });

  it('tells members of each change, and hidden combatants never reach players on the wire', async () => {
    const t = await setupTable();
    const socket = await openSocket(t.app, t.bob.client);
    await socket.request({ type: 'subscribe', tableId: t.table.id });
    const outsider = await openSocket(t.app, t.eve.client);

    const changes = async () => {
      await socket.flush();
      return socket.ofType('combat.updated').length;
    };
    await encounter(t, t.gm.client, 'POST');
    expect(await changes()).toBe(1);
    await encounter(t, t.gm.client, 'POST', '/combatants', { name: 'Assassin', hidden: true });
    await encounter(t, t.gm.client, 'POST', '/combatants', { name: 'Ayla' });
    await encounter(t, t.gm.client, 'POST', '/start');
    await encounter(t, t.gm.client, 'POST', '/turn', { direction: 'next' });
    expect(await changes()).toBe(5);
    expect(socket.ofType('combat.updated').every((e) => e.tableId === t.table.id)).toBe(true);

    // Everything Bob received: the events and the encounter he refetches.
    const fetched = await t.call(t.bob.client, 'GET', url(t));
    const wire = JSON.stringify(socket.received) + fetched.body;
    expect(wire).toContain('Ayla');
    expect(wire).not.toContain('Assassin');

    await outsider.flush();
    expect(outsider.ofType('combat.updated')).toEqual([]);
    socket.ws.close();
    outsider.ws.close();
  });
});
