import { describe, expect, it } from 'vitest';

import { parse, print, roll, seededRng, type RollContext, type Rng } from '../src/index.js';

/** Standard-die faces in order. */
function faces(...values: number[]): Rng {
  const queue = [...values];
  return { nextInt: () => (queue.shift() ?? 1) - 1 };
}

/** An actor's state as the roll sees it (specs §8.4, §8.7). */
const ACTOR = {
  str: 14,
  penalty: -1,
  ready: true,
  name: 'Seoni',
  derived: { strMod: 2 },
  skills: { sk1: { name: 'Climb', rank: 3 }, sk2: { name: 'Swim', rank: 1 } },
  pool: 3,
  args: { id: 'sk1' },
};

const rolled = (source: string, rng: Rng, context: Partial<RollContext> = {}) =>
  roll(source, { rng, data: ACTOR, ...context });

describe('roll results with references (T-0304)', () => {
  it('records the expression, the resolved expression, the dice and the total', () => {
    const result = rolled('1d20 + @derived.strMod + @skills[@args.id].rank', faces(12));
    expect(result).toEqual({
      expression: '1d20 + @derived.strMod + @skills[@args.id].rank',
      resolved: '1d20 + 2 + 3',
      total: 17,
      dice: [
        {
          formula: '1d20',
          count: 1,
          die: 'd20',
          total: 12,
          results: [{ value: 12, active: true }],
        },
      ],
    });
  });

  it.each([
    ['(@pool)d6cs>=5', [5, 1, 6], '3d6cs>=5'],
    ['sum(@skills[*].rank) + 1d4', [2], 'sum(3, 1) + 1d4'],
    ['1d20 - @penalty', [10], '1d20 - -1'],
    ['1d20 + -@penalty', [10], '1d20 + -(-1)'],
    ['@ready ? 1d6 : 1d4', [3], 'true ? 1d6 : 1d4'],
    ["@name == 'Seoni' ? 1d6 : 0", [3], "'Seoni' == 'Seoni' ? 1d6 : 0"],
    ['@ready or @missing > 1 ? 1d4 : 0', [2], 'true or @missing > 1 ? 1d4 : 0'],
    [
      'false and @skills[@args.id].rank > 0 ? 1 : 1d4',
      [2],
      'false and @skills[@args.id].rank > 0 ? 1 : 1d4',
    ],
    ['count(@skills[*]) + d4', [1], 'count(@skills[*]) + 1d4'],
    ['1d20+@str', [4], '1d20 + 14'],
  ])('%s → %s', (source, values, resolved) => {
    const result = rolled(source, faces(...values));
    expect(result.expression).toBe(source);
    expect(result.resolved).toBe(resolved);
  });

  it('resolves references without dice too', () => {
    expect(rolled('@str + @derived.strMod', faces())).toMatchObject({
      resolved: '14 + 2',
      total: 16,
      dice: [],
    });
  });

  it('can be stored as JSON and read back unchanged', () => {
    const result = rolled('4d6kh3r1! + @derived.strMod', seededRng('json'));
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('prints a negated negative number unambiguously', () => {
    expect(print(parse('-(-1)'))).toBe('-(-1)');
    expect(print(parse('- -@a'))).toBe('-(-@a)');
  });
});
