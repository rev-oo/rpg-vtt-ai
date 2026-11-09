import { describe, expect, it } from 'vitest';

import type { HandlerActor, HandlerInput, HandlerPost, HandlerRoll, ServerContext } from '@vtt/sdk';

import { deathSave, longRest, spendHitDie } from '../src/rests.js';

class Failed extends Error {}

/** A fake server context: rolls give the totals and natural d20s it is told, counters move. */
function fake(data: Record<string, unknown>, rolls: { total: number; natural?: number }[] = []) {
  const adjusted: [string, number][] = [];
  const posts: HandlerPost[] = [];
  const formulas: string[] = [];
  const counters = new Map<string, number>();
  const ctx: ServerContext = {
    roll: (formula) => {
      formulas.push(formula);
      const next = rolls.shift() ?? { total: 10 };
      const roll: HandlerRoll = {
        ref: formulas.length,
        expression: formula,
        resolved: formula,
        total: next.total,
        dice: [
          {
            formula: '1d20',
            count: 1,
            die: 'd20',
            total: next.natural ?? next.total,
            results: [{ value: next.natural ?? next.total, active: true }],
          },
        ],
      };
      return Promise.resolve(roll);
    },
    chat: {
      post: (message) => {
        posts.push(message);
        return Promise.resolve();
      },
    },
    actors: {
      get: () => Promise.resolve(null),
      adjust: (_id, path, delta) => {
        adjusted.push([path, delta]);
        const value = (counters.get(path) ?? 0) + delta;
        counters.set(path, value);
        return Promise.resolve(value);
      },
    },
    log: () => undefined,
    fail: (message) => {
      throw new Failed(message);
    },
  };
  const actor: HandlerActor = { id: 'a1', name: 'Mira', type: 'character', data };
  const input: HandlerInput = { ctx, actor, args: {} };
  return { input, adjusted, posts, formulas, counters };
}

describe('death saving throws', () => {
  it('counts a success at 10 or more and a failure below', async () => {
    const up = fake({ hp: { value: 0 } }, [{ total: 12 }]);
    await deathSave(up.input);
    expect(up.adjusted).toEqual([['deathSaves.successes', 1]]);
    expect(up.posts[0]?.text).toBe('Mira: Death Saving Throw success (1/3).');

    const down = fake({ hp: { value: 0 } }, [{ total: 7 }]);
    await deathSave(down.input);
    expect(down.adjusted).toEqual([['deathSaves.failures', 1]]);
  });

  it('counts a natural 1 as two failures, and brings the character back on a 20', async () => {
    const one = fake({ hp: { value: 0 } }, [{ total: -1, natural: 1 }]);
    await deathSave(one.input);
    expect(one.adjusted).toEqual([['deathSaves.failures', 2]]);

    const twenty = fake({ hp: { value: 0 }, deathSaves: { successes: 1, failures: 2 } }, [
      { total: 20 },
    ]);
    await deathSave(twenty.input);
    expect(twenty.adjusted).toEqual([
      ['hp.value', 1],
      ['deathSaves.successes', -1],
      ['deathSaves.failures', -2],
    ]);
    expect(twenty.posts[0]?.text).toBe('Mira rolls a natural 20 and regains 1 Hit Point!');
  });

  it('refuses a character who is not dying', async () => {
    await expect(deathSave(fake({ hp: { value: 3 } }).input)).rejects.toThrow('Mira is not dying.');
  });
});

describe('rests', () => {
  it('spends a Hit Die of the class and heals up to the maximum', async () => {
    const rest = fake(
      { class: 'class.wizard', level: 3, hitDiceUsed: 1, hp: { value: 4, max: 8 } },
      [{ total: 9 }],
    );
    await spendHitDie(rest.input);
    expect(rest.formulas).toEqual(['1d6 + @derived.conMod']);
    expect(rest.adjusted).toEqual([
      ['hp.value', 4],
      ['hitDiceUsed', 1],
    ]);
    expect(rest.posts[0]?.text).toBe('Mira spends a Hit Die (d6) and regains 4 Hit Points.');
  });

  it('has no Hit Die to spend once all are spent', async () => {
    const rest = fake({ class: 'class.fighter', level: 2, hitDiceUsed: 2 });
    await expect(spendHitDie(rest.input)).rejects.toThrow('Mira has no Hit Dice left.');
  });

  it('restores everything a Long Rest restores', async () => {
    const rest = fake({
      hp: { value: 3, max: 20, temp: 4 },
      hitDiceUsed: 2,
      exhaustion: 2,
      deathSaves: { successes: 0, failures: 1 },
      slotsUsed: { l1: 3, l2: 1 },
    });
    await longRest(rest.input);
    expect(rest.adjusted).toEqual([
      ['hp.value', 17],
      ['hp.temp', -4],
      ['hitDiceUsed', -2],
      ['deathSaves.failures', -1],
      ['exhaustion', -1],
      ['slotsUsed.l1', -3],
      ['slotsUsed.l2', -1],
    ]);
    expect(rest.posts).toHaveLength(1);
  });
});
