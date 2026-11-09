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
    ['@ready ? 1d6 : 1d4', [3], '1d6'],
    ["@name == 'Seoni' ? 1d6 : 0", [3], '1d6'],
    ['@ready or @missing > 1 ? 1d4 : 0', [2], '1d4'],
    ['false and @skills[@args.id].rank > 0 ? 1 : 1d4', [2], '1d4'],
    ['1d20 + (@ready ? @derived.strMod : @missing)', [2], '1d20 + 2'],
    ['1d20 + if(@ready, @str, @missing)', [2], '1d20 + 14'],
    ['(@ready ? 1d6 : 1d4) * 2', [2], '1d6 * 2'],
    ['(@ready ? 1d6 + 1 : 1d4) * 2', [2], '(1d6 + 1) * 2'],
    ['1d20 + @derived.strMod - 2', [2], '1d20 + 2 - 2'],
    ['1d20 + (@ready ? 0 : 5) + 0', [2], '1d20'],
    ['0 + 1d4 - 0', [2], '1d4'],
    ['max(0, 1d4)', [2], 'max(0, 1d4)'],
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

describe('dice from data (T-1607)', () => {
  const ITEM = { dice: 2, die: 8, damage: '1d8 + 2d6 + 3', blank: ' ', bad: '@str', name: 'Axe' };
  const withItem = (source: string, rng: Rng, context: Partial<RollContext> = {}) =>
    rolled(source, rng, { data: { ...ACTOR, item: ITEM }, ...context });

  it('rolls a die whose size is a formula', () => {
    const result = withItem('(@item.dice)d(@item.die) + 1', faces(3, 7));
    expect(result).toMatchObject({ resolved: '2d8 + 1', total: 11 });
    expect(result.dice).toEqual([
      expect.objectContaining({ formula: '2d8', count: 2, die: 'd8', total: 10 }),
    ]);
    expect(withItem('d(@item.die * 2)kh1', faces(16)).resolved).toBe('1d16kh1');
  });

  it.each([
    ['d(@item.name)', 'type_error', 'Expected a number, got text'],
    ['d(0)', 'invalid_dice', 'from 1 to 1000000, not 0'],
    ['d(2.5)', 'invalid_dice', 'not 2.5'],
    ['d(@item.die * 1000000)', 'invalid_dice', 'not 8000000'],
  ])('refuses a bad size: %s', (source, code, message) => {
    expect(() => withItem(source, faces())).toThrow(expect.objectContaining({ code }));
    expect(() => withItem(source, faces())).toThrow(message);
  });

  it('rolls a dice expression kept as text, in the same roll', () => {
    const result = withItem('roll(@item.damage) + @derived.strMod', faces(5, 1, 6));
    expect(result).toMatchObject({ resolved: '1d8 + 2d6 + 3 + 2', total: 17 });
    expect(result.dice.map((dice) => dice.formula)).toEqual(['1d8', '2d6']);
  });

  it('multiplies the dice of a critical hit, not the bonus', () => {
    const result = withItem('roll(@item.damage, 2)', faces(1, 1, 1, 1, 1, 1));
    expect(result).toMatchObject({ resolved: '2d8 + 4d6 + 3', total: 9 });
    expect(withItem("roll('(2)d6 + d4', 3)", faces()).resolved).toBe('6d6 + 3d4');
  });

  it('keeps parentheses the surrounding formula needs', () => {
    expect(withItem("roll('1d4 + 1') * 2", faces(2)).resolved).toBe('(1d4 + 1) * 2');
  });

  it('rolls blank text as nothing', () => {
    expect(withItem('1d20 + roll(@item.blank)', faces(4))).toMatchObject({
      resolved: '1d20',
      total: 4,
    });
  });

  it('shares the dice limit with the rest of the roll', () => {
    expect(() => withItem("10d6 + roll('10d6')", faces(), { maxDice: 15 })).toThrow(
      expect.objectContaining({ code: 'too_many_dice' }),
    );
  });

  it.each([
    ['roll(@item.bad)', 'not_dice', "roll('@str'): Only numbers, dice and + - * /"],
    ["roll('max(1d4, 2)')", 'not_dice', 'Only numbers, dice'],
    ["roll('2d6 +')", 'unexpected_end', "roll('2d6 +')"],
    ["roll('1d0')", 'invalid_dice', "roll('1d0')"],
    ['roll(@item.dice)', 'type_error', 'roll() needs text, got a number'],
    ['roll()', 'invalid_arguments', 'roll() takes 1 or 2 arguments, not 0'],
    ["roll('1d6', 0)", 'invalid_arguments', 'from 1 to 10, not 0'],
    ["roll('1d6', 11)", 'invalid_arguments', 'not 11'],
  ])('refuses %s', (source, code, message) => {
    expect(() => withItem(source, faces())).toThrow(expect.objectContaining({ code }));
    expect(() => withItem(source, faces())).toThrow(message);
  });

  it('points errors inside the text at the roll() call', () => {
    expect(() => withItem("1 + roll('1d0')", faces())).toThrow(
      expect.objectContaining({ column: 5 }),
    );
  });
});
