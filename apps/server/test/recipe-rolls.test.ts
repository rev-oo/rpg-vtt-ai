import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@vtt/shared/api';

import { authHeaders, type Client, type TestApp } from './support/app.js';
import { createActorAs, startWithSystems, systemsDir, tableWithPlayer } from './support/systems.js';

// T-1608: recipes with named values, several formulas, the dice, and actor types.

const SYSTEMS = ['tiny-d20'];

let dataDir: string;
let t: TestApp;
let gm: Client;

async function withRecipes(dir: string) {
  const file = path.join(dir, 'plugins/tiny-d20/rolls.json');
  const rolls = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  rolls.strike = {
    actors: ['character'],
    let: { bonus: '@derived.strMod + 1', twice: '@let.bonus * 2' },
    formula: {
      attack: '1d20 + @let.bonus',
      damage: '(@rolls.attack.natural >= 1 ? 2 : 1)d6 + @let.twice',
    },
    outcomes: [
      {
        when: '@roll.natural == @rolls.attack.natural and @rolls.damage.total > 0',
        label: 'Hit',
      },
    ],
  };
  rolls.monster = { formula: '1d20', actors: ['npc'] };
  await writeFile(file, JSON.stringify(rolls));
}

beforeEach(async () => {
  dataDir = await systemsDir(SYSTEMS);
  await withRecipes(dataDir);
  ({ t, gm } = await startWithSystems(dataDir, SYSTEMS));
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe('recipes (T-1608)', () => {
  it('rolls named values and several formulas into one message', async () => {
    const { table, player: bob } = await tableWithPlayer(t, gm, 'tiny-d20', 'bob');
    const ayla = await createActorAs(t, bob.client, table.id, 'character', 'Ayla');
    const roll = (name: string) =>
      t.app.inject({
        method: 'POST',
        url: `/api/v1/tables/${table.id}/rolls`,
        headers: authHeaders(bob.client),
        payload: { recipe: { name }, actorId: ayla.id },
      });

    const res = await roll('strike');
    expect(res.statusCode, res.body).toBe(201);
    const { message } = res.json<{ message: ChatMessage }>();
    // Strength 10: the bonus is 1, and twice it 2. Any natural d20 doubles the d6 here.
    expect(message.rolls.map((rolled) => rolled.resolved)).toEqual(['1d20 + 1', '2d6 + 2']);
    expect(message.card?.outcome?.label).toBe('Hit');
    expect(message.text).toMatch(/^strike: 1d20 \+ 1 = \d+; 2d6 \+ 2 = \d+ \(Hit\)$/);

    const refused = await roll('monster');
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ error: { code: 'wrong_actor_type' } });
  });
});
