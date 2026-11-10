import { describe, expect, it } from 'vitest';

import type {
  HandlerActor,
  HandlerInput,
  HandlerItem,
  HandlerPost,
  HandlerRoll,
  ServerContext,
} from '@vtt/sdk';

import { deathSave, longRest, spendHitDie, spendSlot } from '../src/rests.js';

class Failed extends Error {}

/** What a fake handler gets besides the actor's data. */
interface FakeInput {
  rolls?: { total: number; natural?: number }[];
  /** Counters' highest values by path, as their bounds give them; counters start at the data. */
  limits?: Record<string, number>;
  derived?: HandlerInput['derived'];
  items?: HandlerItem[];
  options?: HandlerInput['options'];
}

/** A number at a dot path of plain data. */
function numberIn(data: Record<string, unknown>, path: string): number {
  let value: unknown = data;
  for (const key of path.split('.')) {
    value = typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
  }
  return typeof value === 'number' ? value : 0;
}

/**
 * A fake server context: rolls give the totals and natural d20s it is told, and counters move
 * from the data within 0 and their limits.
 */
function fake(
  data: Record<string, unknown>,
  { rolls = [], limits = {}, derived = {}, items = [], options = {} }: FakeInput = {},
) {
  const adjusted: [string, number][] = [];
  const itemsAdjusted: [string, string, number][] = [];
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
        const start = counters.get(path) ?? numberIn(data, path);
        const value = Math.min(limits[path] ?? Infinity, Math.max(0, start + delta));
        counters.set(path, value);
        return Promise.resolve(value);
      },
      set: () => Promise.resolve(),
    },
    items: {
      adjust: (id, path, delta) => {
        itemsAdjusted.push([id, path, delta]);
        return Promise.resolve(delta);
      },
    },
    log: () => undefined,
    fail: (message) => {
      throw new Failed(message);
    },
  };
  const actor: HandlerActor = { id: 'a1', name: 'Mira', type: 'character', data };
  const input: HandlerInput = { ctx, actor, derived, totals: {}, items, args: {}, options };
  return { input, adjusted, itemsAdjusted, posts, formulas, counters };
}

/** A feature item with `used` uses spent. */
const feature = (id: string, recharge: string, used: number): HandlerItem => ({
  id,
  name: id,
  type: 'feature',
  data: { recharge, uses: { used, max: 3 } },
  derived: {},
});

describe('death saving throws', () => {
  it('counts a success at 10 or more and a failure below', async () => {
    const up = fake({ hp: { value: 0 } }, { rolls: [{ total: 12 }] });
    await deathSave(up.input);
    expect(up.adjusted).toEqual([['deathSaves.successes', 1]]);
    expect(up.posts[0]?.text).toBe('Mira: Death Saving Throw success (1/3).');

    const down = fake({ hp: { value: 0 } }, { rolls: [{ total: 7 }] });
    await deathSave(down.input);
    expect(down.adjusted).toEqual([['deathSaves.failures', 1]]);
  });

  it('counts a natural 1 as two failures, and brings the character back on a 20', async () => {
    const one = fake({ hp: { value: 0 } }, { rolls: [{ total: -1, natural: 1 }] });
    await deathSave(one.input);
    expect(one.adjusted).toEqual([['deathSaves.failures', 2]]);

    const twenty = fake(
      { hp: { value: 0 }, deathSaves: { successes: 1, failures: 2 } },
      { rolls: [{ total: 20 }] },
    );
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
      { rolls: [{ total: 9 }], limits: { 'hp.value': 8 }, derived: { hitDie: 6 } },
    );
    await spendHitDie(rest.input);
    expect(rest.formulas).toEqual(['1d6 + @derived.conMod']);
    // The counter's maximum (`@hp.max`) stops the healing.
    expect(rest.adjusted).toEqual([
      ['hp.value', 9],
      ['hitDiceUsed', 1],
    ]);
    expect(rest.posts[0]?.text).toBe('Mira spends a Hit Die (d6) and regains 4 Hit Points.');
  });

  it('has no Hit Die to spend once all are spent', async () => {
    const rest = fake({ class: 'class.fighter', level: 2, hitDiceUsed: 2 });
    await expect(spendHitDie(rest.input)).rejects.toThrow('Mira has no Hit Dice left.');
  });

  it('restores everything a Long Rest restores', async () => {
    const rest = fake(
      {
        hp: { value: 3, max: 20, temp: 4 },
        hitDiceUsed: 2,
        exhaustion: 2,
        deathSaves: { successes: 0, failures: 1 },
        slotsUsed: { l1: 3, l2: 1 },
      },
      {
        items: [
          feature('f1', 'recharge.long', 2),
          feature('f2', 'recharge.short', 1),
          feature('f3', 'recharge.none', 1),
          feature('f4', 'recharge.long', 0),
        ],
      },
    );
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
    // Features that recharge get their uses back; the others keep theirs.
    expect(rest.itemsAdjusted).toEqual([
      ['f1', 'uses.used', -2],
      ['f2', 'uses.used', -1],
    ]);
    expect(rest.posts).toHaveLength(1);
  });
});

describe('spell slots (T-1610)', () => {
  it('spends a slot of the level the spell was cast at', async () => {
    const cast = fake(
      { slotsUsed: { l2: 1 } },
      { limits: { 'slotsUsed.l2': 3 }, options: { slot: 2 } },
    );
    await spendSlot(cast.input);
    expect(cast.adjusted).toEqual([['slotsUsed.l2', 1]]);
    expect(cast.counters.get('slotsUsed.l2')).toBe(2);
    expect(cast.posts).toEqual([]);
  });

  it('spends nothing for a cantrip', async () => {
    const cantrip = fake({}, { options: { slot: 0 } });
    await spendSlot(cantrip.input);
    expect(cantrip.adjusted).toEqual([]);
  });

  it('says so when no slot of that level is left', async () => {
    const spent = fake(
      { slotsUsed: { l1: 2 } },
      { limits: { 'slotsUsed.l1': 2 }, options: { slot: 1 } },
    );
    await expect(spendSlot(spent.input)).rejects.toThrow('Mira has no level 1 spell slots left.');
  });
});
