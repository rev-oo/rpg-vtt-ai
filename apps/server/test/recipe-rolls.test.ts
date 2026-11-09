import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@vtt/shared/api';

import { authHeaders, type Client, type TestApp } from './support/app.js';
import { createActorAs, startWithSystems, systemsDir, tableWithPlayer } from './support/systems.js';

// T-1608: recipes with named values, several formulas, the dice, and actor types.
// T-1609: options the app asks for, checked by the server.

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
  rolls.aimed = {
    options: {
      mode: {
        type: 'choice',
        label: 'Roll',
        choices: [
          { value: 'normal', label: 'Normal' },
          { value: 'advantage', label: 'Advantage', key: 'shift' },
        ],
      },
      level: { type: 'number', label: 'Level', default: 1, minimum: 1, maximum: '@str' },
      bonus: { type: 'dice', label: 'Bonus' },
    },
    formula:
      "(@options.mode == 'advantage' ? 2d20kh1 : 1d20) + @options.level + roll(@options.bonus)",
  };
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
    const roll = (name: string, options?: Record<string, string | number>) =>
      t.app.inject({
        method: 'POST',
        url: `/api/v1/tables/${table.id}/rolls`,
        headers: authHeaders(bob.client),
        payload: { recipe: { name, ...(options && { options }) }, actorId: ayla.id },
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

  it('rolls with the options asked for, and refuses those the recipe does not allow', async () => {
    const { table, player: bob } = await tableWithPlayer(t, gm, 'tiny-d20', 'bob');
    const ayla = await createActorAs(t, bob.client, table.id, 'character', 'Ayla');
    const roll = (name: string, options?: Record<string, string | number>) =>
      t.app.inject({
        method: 'POST',
        url: `/api/v1/tables/${table.id}/rolls`,
        headers: authHeaders(bob.client),
        payload: { recipe: { name, ...(options && { options }) }, actorId: ayla.id },
      });

    const plain = await roll('aimed');
    expect(plain.statusCode, plain.body).toBe(201);
    expect(plain.json<{ message: ChatMessage }>().message.rolls[0]?.resolved).toBe('1d20 + 1');
    const aimed = await roll('aimed', { mode: 'advantage', level: 3, bonus: '1d4' });
    expect(aimed.statusCode, aimed.body).toBe(201);
    expect(aimed.json<{ message: ChatMessage }>().message.rolls[0]?.resolved).toBe(
      '2d20kh1 + 3 + 1d4',
    );

    // Strength 10 caps the level; dice cannot read the sheet; plain rolls take no options.
    for (const [name, options] of [
      ['aimed', { level: 11 }],
      ['aimed', { bonus: '1d4 + @str' }],
      ['aimed', { mode: 'wild' }],
      ['aimed', { luck: 1 }],
      ['strike', { mode: 'normal' }],
    ] as const) {
      const refused = await roll(name, options);
      expect(refused.statusCode, `${name} ${JSON.stringify(options)}`).toBe(422);
      expect(refused.json()).toMatchObject({ error: { code: 'bad_option' } });
    }
  });
});
