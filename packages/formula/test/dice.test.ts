import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_DICE,
  FormulaError,
  roll,
  seededRng,
  type CustomDie,
  type RollContext,
  type Rng,
} from '../src/index.js';

/** An RNG that returns the given standard-die faces in order (face n is draw n - 1). */
function faces(...values: number[]): Rng {
  const queue = [...values];
  return {
    nextInt(n) {
      const face = queue.shift();
      if (face === undefined) throw new Error('the scripted RNG ran out');
      if (face < 1 || face > n) throw new Error(`face ${String(face)} does not fit d${String(n)}`);
      return face - 1;
    },
  };
}

const FATE: CustomDie = {
  faces: [
    { label: '-', value: -1 },
    { label: '-', value: -1 },
    { label: ' ', value: 0 },
    { label: ' ', value: 0 },
    { label: '+', value: 1 },
    { label: '+', value: 1 },
  ],
};

const rolled = (source: string, rng: Rng, context: Partial<RollContext> = {}) =>
  roll(source, { rng, customDice: { dF: FATE }, ...context });

/** Values of a term's dice, marked: `6!` exploded, `(1)` rerolled, `[2]` dropped, `*` success, `_` failure. */
function marks(source: string, rng: Rng, context: Partial<RollContext> = {}) {
  const result = rolled(source, rng, context);
  return {
    total: result.total,
    dice: result.dice.map((term) =>
      term.results
        .map(({ value, rerolled, exploded, dropped, success, failure }) => {
          let text = String(value);
          if (exploded) text += '!';
          if (success) text += '*';
          if (failure) text += '_';
          if (rerolled) text = `(${text})`;
          if (dropped) text = `[${text}]`;
          return text;
        })
        .join(' '),
    ),
  };
}

function failure(source: string, context: Partial<RollContext> = {}): FormulaError {
  try {
    rolled(source, seededRng(1), context);
  } catch (error) {
    if (error instanceof FormulaError) return error;
    throw error;
  }
  throw new Error(`${source} did not fail`);
}

describe('dice terms (FR-DICE-01)', () => {
  it.each([
    ['3d6', [2, 5, 6], 13, '2 5 6'],
    ['d20', [17], 17, '17'],
    ['0d6', [], 0, ''],
    ['4d6kh3', [1, 4, 3, 6], 13, '[1] 4 3 6'],
    ['4d6kh', [1, 4, 3, 6], 6, '[1] [4] [3] 6'],
    ['2d20kl1', [15, 3], 3, '[15] 3'],
    ['4d6dl1', [1, 4, 3, 6], 13, '[1] 4 3 6'],
    ['4d6dh2', [1, 4, 3, 6], 4, '1 [4] 3 [6]'],
    ['3d6kh1', [5, 5, 2], 5, '5 [5] [2]'],
    ['3d6kh9', [5, 5, 2], 12, '5 5 2'],
    ['3d6kh0', [5, 5, 2], 0, '[5] [5] [2]'],
    ['3d6!', [6, 6, 2, 3, 4], 21, '6! 6! 2 3 4'],
    ['2d6r<2', [1, 4, 5], 9, '(1) 4 5'],
    ['1d6r1', [1, 1], 1, '(1) 1'],
    ['1d6!r1', [1, 6, 2], 8, '(1) 6! 2'],
    ['2d6!kh1', [6, 3, 2], 6, '6! [3] [2]'],
    ['5d10cs>=8cf1', [10, 8, 1, 5, 3], 1, '10* 8* 1_ 5 3'],
    ['3d10kh2cs>=8', [9, 2, 8], 2, '9* [2] 8*'],
    ['3d6cs6', [6, 6, 1], 2, '6* 6* 1'],
    ['3d6cs>4', [5, 4, 6], 2, '5* 4 6*'],
    ['3d6cs<2', [1, 2, 6], 1, '1* 2 6'],
    ['3d6cf<=2', [1, 2, 6], -2, '1_ 2_ 6'],
  ])('%s rolling %j → %i', (source, values, total, dice) => {
    expect(marks(source, faces(...values))).toEqual({ total, dice: dice ? [dice] : [''] });
  });

  it('applies modifiers in a fixed order, whatever order they are written in', () => {
    expect(marks('2d6kh1!r1', faces(1, 6, 3, 2))).toEqual(marks('2d6r1!kh1', faces(1, 6, 3, 2)));
  });

  it('combines terms with arithmetic and references', () => {
    const result = rolled('1d20 + @mod - 1d4', faces(12, 3), { data: { mod: 5 } });
    expect(result.total).toBe(14);
    expect(result.dice.map((term) => [term.formula, term.total])).toEqual([
      ['1d20', 12],
      ['1d4', 3],
    ]);
  });

  it('takes the count from data or another roll', () => {
    const pool = rolled('(@pool)d6cs>=5', faces(5, 2, 6), { data: { pool: 3 } });
    expect(pool.total).toBe(2);
    expect(pool.dice[0]).toMatchObject({ formula: '3d6cs>=5', count: 3, die: 'd6' });

    const nested = rolled('(1d4)d6', faces(2, 6, 1));
    expect(nested.total).toBe(7);
    expect(nested.dice.map((term) => term.formula)).toEqual(['1d4', '2d6']);
  });

  it('records every die with its flags (FR-DICE-04)', () => {
    expect(rolled('3d6!kh2', faces(6, 2, 1, 4)).dice).toEqual([
      {
        formula: '3d6!kh2',
        count: 3,
        die: 'd6',
        total: 10,
        results: [
          { value: 6, active: true, exploded: true },
          { value: 2, active: false, dropped: true },
          { value: 1, active: false, dropped: true },
          { value: 4, active: true },
        ],
      },
    ]);
  });
});

describe('custom dice (FR-DICE-03)', () => {
  /** Draws are face indexes for custom dice. */
  const indexes = (...values: number[]): Rng => faces(...values.map((index) => index + 1));

  it('rolls Fate dice with labels and values', () => {
    const result = rolled('4dF', indexes(0, 5, 4, 2));
    expect(result.total).toBe(1);
    expect(result.dice[0]?.results.map((die) => [die.label, die.value])).toEqual([
      ['-', -1],
      ['+', 1],
      ['+', 1],
      [' ', 0],
    ]);
  });

  it('counts successes and explodes on the highest value', () => {
    expect(marks('4dFcs>=1', indexes(5, 4, 0, 2)).total).toBe(2);
    expect(marks('1dF!', indexes(4, 1)).dice).toEqual(['1! -1']);
  });

  it('refuses unknown dice', () => {
    expect(failure('2dX')).toMatchObject({
      code: 'unknown_die',
      message: 'Unknown die "dX"; this system has dF (line 1, column 1)',
    });
    expect(failure('dF', { customDice: {} }).message).toContain('this system has no custom dice');
    expect(failure('dF', { customDice: { dF: { faces: [] } } })).toMatchObject({
      code: 'invalid_dice',
    });
  });
});

describe('limits', () => {
  it.each([
    ['d0', 'invalid_dice', 1, 'A die needs between 1 and 1000000 sides'],
    ['d1000001', 'invalid_dice', 1, ''],
    [
      '1 + (-1)d6',
      'invalid_dice',
      6,
      'The number of dice must be a whole number of 0 or more, not -1',
    ],
    ['(1.5)d6', 'invalid_dice', 2, 'not 1.5'],
    [`${String(DEFAULT_MAX_DICE + 1)}d6`, 'too_many_dice', 1, 'The roll uses too many dice'],
    ['d1!', 'too_many_dice', 1, ''],
    ['600d6 + 600d6', 'too_many_dice', 9, ''],
    ['1d6 == 1', 'type_error', 1, 'A roll must add up to a number, not true/false'],
  ])('%s → %s', (source, code, column, message) => {
    const error = failure(source);
    expect(error).toMatchObject({ code, column });
    expect(error.message).toContain(message);
  });

  it('takes a smaller dice budget', () => {
    expect(rolled('2d6', faces(1, 2), { maxDice: 2 }).total).toBe(3);
    expect(failure('3d6', { maxDice: 2 })).toMatchObject({ code: 'too_many_dice' });
  });

  it('refuses a broken RNG', () => {
    expect(() => roll('1d6', { rng: { nextInt: () => 6 } })).toThrow(RangeError);
    expect(() => roll('1d6', { rng: { nextInt: () => 0.5 } })).toThrow(RangeError);
  });
});

describe('seeded RNG (FR-DICE-05)', () => {
  it('gives identical results for a seed, across runs', () => {
    const replay = () => roll('4d6kh3 + 1d20 + 2d10!', { rng: seededRng('replay-1') });
    expect(replay()).toEqual(replay());
    // Fixed values: a change to the RNG or the engine breaks replays of stored rolls.
    expect(replay().dice.map((term) => term.results.map((die) => die.value))).toEqual(
      REPLAY_VALUES,
    );
    expect(seededRng(42).nextInt(1000)).toBe(seededRng(42).nextInt(1000));
  });

  it('differs between seeds', () => {
    const sequence = (seed: number | string) => {
      const rng = seededRng(seed);
      return Array.from({ length: 20 }, () => rng.nextInt(100));
    };
    expect(sequence(1)).not.toEqual(sequence(2));
    expect(sequence('a')).not.toEqual(sequence('b'));
    expect(sequence(7)).toEqual(sequence(7));
  });

  it('draws within range, including the full 32-bit range', () => {
    const rng = seededRng(3);
    for (const n of [1, 2, 3, 6, 7, 1000, 2 ** 31 + 1, 2 ** 32]) {
      for (let i = 0; i < 50; i += 1) {
        const value = rng.nextInt(n);
        expect(Number.isInteger(value) && value >= 0 && value < n).toBe(true);
      }
    }
  });

  it('rolls 2d6 with the expected distribution over 100k rolls', () => {
    const rng = seededRng('distribution');
    const ROLLS = 100_000;
    const counts = new Map<number, number>();
    const formula = '2d6';
    for (let i = 0; i < ROLLS; i += 1) {
      const { total } = roll(formula, { rng });
      counts.set(total, (counts.get(total) ?? 0) + 1);
    }
    // P(total = t) = (6 - |t - 7|) / 36 for t in 2..12.
    let chiSquare = 0;
    for (let total = 2; total <= 12; total += 1) {
      const expected = (ROLLS * (6 - Math.abs(total - 7))) / 36;
      const observed = counts.get(total) ?? 0;
      expect(Math.abs(observed - expected) / ROLLS).toBeLessThan(0.006);
      chiSquare += (observed - expected) ** 2 / expected;
    }
    expect([...counts.keys()].every((total) => total >= 2 && total <= 12)).toBe(true);
    // 10 degrees of freedom; 29.59 is the 99.9% critical value.
    expect(chiSquare).toBeLessThan(29.59);
  });
});

const REPLAY_VALUES = [[5, 5, 2, 5], [16], [1, 10, 1]];
