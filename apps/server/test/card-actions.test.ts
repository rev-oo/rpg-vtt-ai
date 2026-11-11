import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActorView, ChatMessage } from '@vtt/shared/api';

import { actors, items } from '../src/db/schema.js';

import {
  authHeaders,
  createTestApp,
  setupAdmin,
  type Client,
  type TestApp,
} from './support/app.js';
import { copyReferencePlugin } from './support/reference.js';
import { createActorAs, tableWithPlayer } from './support/systems.js';

// T-1617: card actions. srd5's attack and spell cards apply damage or healing to the actor of
// the token the clicker has selected, if they may edit it, and spells that ask for a save
// offer to roll it.

let dir: string;
let t: TestApp;
let gm: Client;
let bob: Client;
let tableId: string;
let goblinId: string;
let miraId: string;
let spellId: string;
let rolls: number[];

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vtt-card-actions-'));
  await copyReferencePlugin('srd5', path.join(dir, 'plugins', 'srd5'), { code: true });
  rolls = [];
  t = await createTestApp({
    env: { DATA_DIR: dir },
    rng: { nextInt: (n) => Math.min(rolls.shift() ?? 1, n) - 1 },
  });
  gm = await setupAdmin(t.app);
  const headers = authHeaders(gm);
  await t.app.inject({ method: 'POST', url: '/api/v1/plugins/rescan', headers });
  const enabled = await t.app.inject({
    method: 'POST',
    url: '/api/v1/plugins/srd5/enable',
    headers,
    payload: { acknowledgeCode: true },
  });
  expect(enabled.statusCode, enabled.body).toBe(200);
  const { table, player } = await tableWithPlayer(t, gm, 'srd5', 'bob');
  tableId = table.id;
  bob = player.client;

  const goblin = await call(gm, `/tables/${tableId}/actors`, { type: 'npc', name: 'Goblin' });
  goblinId = goblin.json<{ actor: ActorView }>().actor.id;
  const scimitar = {
    name: 'Scimitar',
    bonus: 4,
    dice: 1,
    die: 6,
    damageBonus: 2,
    damageType: 'slashing',
    extraDamage: '',
    sort: 'a0',
  };
  t.db
    .update(actors)
    .set({ system: { hp: { value: 7, max: 7 }, actions: { a1: scimitar } } })
    .where(eq(actors.id, goblinId))
    .run();
  miraId = (await createActorAs(t, bob, tableId, 'character', 'Mira')).id;
  spellId = randomUUID();
  t.db
    .insert(items)
    .values({
      id: spellId,
      tableId,
      actorId: miraId,
      type: 'spell',
      name: 'Burning Hands',
      system: {
        level: 1,
        attack: 'spell.save',
        save: 'ability.dex',
        dice: 3,
        die: 6,
        effectType: 'fire',
      },
      dataVersion: '0.1.0',
    })
    .run();
}, 60_000);

afterAll(async () => {
  await t.app.close();
  await rm(dir, { recursive: true, force: true });
});

function call(client: Client, url: string, payload: object) {
  return t.app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: authHeaders(client),
    payload,
  });
}

async function rolled(client: Client, payload: object): Promise<ChatMessage> {
  const res = await call(client, `/tables/${tableId}/rolls`, payload);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ message: ChatMessage }>().message;
}

const apply = (client: Client, message: ChatMessage, action: number, actorId: string) =>
  call(client, `/messages/${message.id}/apply`, { action, actorId });

describe('card actions (T-1617)', () => {
  it('applies an attack’s damage, or half of it, to an actor the clicker may edit', async () => {
    rolls = [15, 4];
    const attack = await rolled(gm, {
      actorId: goblinId,
      recipe: { name: 'npcAttack', args: { id: 'a1' } },
    });
    // 1d6 + 2 = 6 damage, worked out when the roll was made.
    expect(attack.card?.card?.actions).toEqual([
      { kind: 'apply', label: 'card.applyDamage', field: 'hp.value', amount: -6 },
      { kind: 'apply', label: 'card.applyHalf', field: 'hp.value', amount: -3 },
    ]);

    // A player takes the hit on their own character: 10 - 6.
    const taken = await apply(bob, attack, 0, miraId);
    expect(taken.statusCode, taken.body).toBe(200);
    expect(taken.json()).toEqual({ value: 4 });
    // They cannot apply it to an actor they may not edit.
    const refused = await apply(bob, attack, 1, goblinId);
    expect(refused.statusCode).toBe(403);

    // The GM applies half, then the whole, which stops at 0.
    expect((await apply(gm, attack, 1, goblinId)).json()).toEqual({ value: 4 });
    expect((await apply(gm, attack, 0, goblinId)).json()).toEqual({ value: 0 });

    const missing = await apply(gm, attack, 2, goblinId);
    expect(missing.statusCode).toBe(422);
    expect(missing.json()).toMatchObject({ error: { code: 'unknown_action' } });
    const unknownActor = await apply(gm, attack, 0, randomUUID());
    expect(unknownActor.statusCode).toBe(404);
  });

  it('keeps a message the clicker cannot see out of reach', async () => {
    rolls = [15, 4];
    const secret = await rolled(gm, {
      actorId: goblinId,
      audience: 'gm',
      recipe: { name: 'npcAttack', args: { id: 'a1' } },
    });
    const res = await apply(bob, secret, 0, miraId);
    expect(res.statusCode).toBe(404);
  });

  it('offers the saving throw a spell asks for, and rolls it against the DC', async () => {
    rolls = [3, 4, 5];
    const spell = await rolled(bob, {
      actorId: miraId,
      recipe: { name: 'spellEffect', args: {}, itemId: spellId },
    });
    const actions = spell.card?.card?.actions ?? [];
    expect(actions.map((action) => action.label)).toEqual([
      'card.rollSave',
      'card.applyDamage',
      'card.applyHalf',
    ]);
    const [save] = actions;
    if (save?.kind !== 'roll') throw new Error('expected the save to roll');
    expect(save.roll).toBe('save');
    expect(save.args).toEqual({ ability: 'ability.dex', dc: expect.any(Number) as unknown });

    // The GM rolls the goblin's save from the card: 20 always beats the DC, 1 never does.
    rolls = [20];
    const saved = await rolled(gm, {
      actorId: goblinId,
      recipe: { name: save.roll, args: save.args },
    });
    expect(saved.card?.outcome?.label).toBe('outcome.saved');
    expect(saved.card?.card?.rows[0]).toEqual({ label: 'card.ability', value: 'ability.dex' });
    rolls = [1];
    const failed = await rolled(gm, {
      actorId: goblinId,
      recipe: { name: save.roll, args: save.args },
    });
    expect(failed.card?.outcome?.label).toBe('outcome.failed');
  });
});
