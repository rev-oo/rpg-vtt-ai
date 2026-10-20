import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  BUILTIN_FUNCTIONS,
  compile,
  DEFAULT_MAX_STEPS,
  evaluate,
  FormulaError,
  type EvaluationContext,
  type FormulaFunction,
} from '../src/index.js';

import { formulaTree } from './support/ast.js';

const DATA = {
  str: 15,
  name: 'Seoni',
  hp: { value: 7, max: 10 },
  derived: { strMod: 2 },
  args: { id: 'sk2', index: 1 },
  skills: { sk1: { name: 'Climb', rank: 1 }, sk2: { name: 'Swim', rank: 3 } },
  levels: [2, 5, 1],
  groups: { g1: { members: { a: { hp: 3 } } }, g2: { members: { b: { hp: 4 }, c: { hp: 5 } } } },
  flags: { ready: true },
};
const run = (source: string, context: EvaluationContext = {}) =>
  evaluate(source, { data: DATA, ...context });

/** The error a formula raises, for checking its code and position. */
function failure(source: string, context: EvaluationContext = {}): FormulaError {
  try {
    run(source, context);
  } catch (error) {
    if (error instanceof FormulaError) return error;
    throw error;
  }
  throw new Error(`${source} did not fail`);
}

describe('evaluate in pure mode (T-0302)', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 / 4', 2.5],
    ['7 % 3', 1],
    ['2 - 3 - 4', -5],
    ['-@str + 1', -14],
    ['floor((@str - 10) / 2)', 2],
    ['@derived.strMod + @skills[@args.id].rank', 5],
    ["@skills['sk1'].rank", 1],
    ['@levels[@args.index]', 5],
    ['@levels[0] + @levels[2]', 3],
    ['@hp.value < @hp.max ? @hp.max - @hp.value : 0', 3],
    ["@name + ' the Brave'", 'Seoni the Brave'],
    ["@name == 'Seoni'", true],
    ["'a' < 'b'", true],
    ['@flags.ready and @str >= 15', true],
    ['not @flags.ready or @str != 15', false],
    ['true == false', false],
    ['@str > 10 ? 1 : @str > 5 ? 2 : 3', 1],
  ] as [string, unknown][])('%s → %j', (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it('aggregates collections with [*] (specs §8.9)', () => {
    expect(run('@skills[*].rank')).toEqual([1, 3]);
    expect(run('sum(@skills[*].rank)')).toBe(4);
    expect(run('count(@skills[*])')).toBe(2);
    expect(run('count(@groups[*].members[*])')).toBe(3);
    expect(run('max(@levels[*], 4)')).toBe(5);
    expect(run('min(@levels[*])')).toBe(1);
    expect(run('sum(@groups[*].members[*].hp)')).toBe(12);
    expect(run('sum()')).toBe(0);
    expect(run('count(@skills[*].rank)')).toBe(2);
  });

  it.each([
    ['floor(2.7)', 2],
    ['ceil(2.1)', 3],
    ['round(2.5)', 3],
    ['abs(-4)', 4],
    ['min(3, 1, 2)', 1],
    ['max(3, 1, 2)', 3],
    ['sum(1, 2, 3)', 6],
    ['clamp(12, 0, 10)', 10],
    ['clamp(-1, 0, 10)', 0],
    ['clamp(5, 0, 10)', 5],
    ["if(@str > 10, 'strong', 'weak')", 'strong'],
    ['if(false, 1, 2)', 2],
  ] as [string, unknown][])('built-in %s → %j', (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it("calls a plugin's shared functions (specs §8.10)", () => {
    const functions = { carryCapacity: (str: unknown) => Number(str) * 15 };
    expect(run('carryCapacity(@str)', { functions })).toBe(225);
  });

  it('never lets a plugin function replace a built-in', () => {
    const floor: FormulaFunction = () => 99;
    expect(run('floor(1.5)', { functions: { floor } })).toBe(1);
  });

  it('evaluates only the branch it needs', () => {
    expect(run('false and @missing')).toBe(false);
    expect(run('true or @missing')).toBe(true);
    expect(run('true ? 1 : @missing')).toBe(1);
    expect(run('if(false, @missing, 2)')).toBe(2);
  });

  it('reuses a compiled formula', () => {
    const formula = compile('@hp.value * 2');
    expect(evaluate(formula, { data: { hp: { value: 2 } } })).toBe(4);
    expect(evaluate(formula, { data: { hp: { value: 5 } } })).toBe(10);
  });

  it('works without data', () => {
    expect(evaluate('1 + 1')).toBe(2);
  });
});

describe('evaluation errors point at the failing part', () => {
  it.each([
    ['@nope', 'unknown_reference', 1, '@nope does not exist'],
    ['1 + @hp.nope', 'unknown_reference', 5, '@hp.nope does not exist'],
    ['@str.value', 'unknown_reference', 1, '@str.value does not exist'],
    ["@skills['sk9'].rank", 'unknown_reference', 1, "@skills['sk9'].rank does not exist"],
    ['@levels[3]', 'unknown_reference', 1, ''],
    ['@levels[0.5]', 'unknown_reference', 1, ''],
    ['@levels.length', 'unknown_reference', 1, ''],
    ['@constructor', 'unknown_reference', 1, ''],
    ['@__proto__', 'unknown_reference', 1, ''],
    ['@hp.toString', 'unknown_reference', 1, ''],
    ['@hp.constructor', 'unknown_reference', 1, ''],
    ['@hp', 'invalid_value', 1, '@hp is a group of fields; formulas need a number'],
    ['@skills[*]', 'invalid_value', 1, 'is a group of fields'],
    ['@str[*]', 'type_error', 1, '@str[*]: [*] needs a collection'],
    ['@skills[true]', 'type_error', 9, 'An index must be text or a number, not true/false'],
    ['@skills[*].rank + 1', 'type_error', 1, 'Cannot add a list and a number'],
    ["'a' + 1", 'type_error', 1, 'Cannot add text and a number'],
    ["1 - 'a'", 'type_error', 5, 'Expected a number, got text'],
    ["1 < 'a'", 'type_error', 1, 'Cannot order a number and text'],
    ['true < false', 'type_error', 1, 'Cannot order true/false and true/false'],
    ["1 == 'a'", 'type_error', 1, 'Cannot compare a number with text'],
    ['@skills[*].rank == 1', 'type_error', 1, 'Expected a single value, got a list'],
    ['not 1', 'type_error', 5, 'Expected true/false, got a number'],
    ['1 ? 2 : 3', 'type_error', 1, 'Expected true/false'],
    ['1 and true', 'type_error', 1, 'Expected true/false'],
    ['1 / (2 - 2)', 'division_by_zero', 5, 'Cannot divide by zero'],
    ['1 % 0', 'division_by_zero', 5, ''],
    ['2d6 + 1', 'dice_not_allowed', 1, 'Dice can only be used in a roll'],
    ['floor()', 'invalid_arguments', 1, 'floor() takes 1 argument, not 0'],
    ['clamp(1, 2)', 'invalid_arguments', 1, 'clamp() takes 3 arguments, not 2'],
    ['if(true, 1)', 'invalid_arguments', 1, ''],
    ['clamp(1, 5, 2)', 'invalid_arguments', 1, 'clamp() needs its minimum below its maximum'],
    ['min()', 'invalid_arguments', 1, 'min() needs at least one number'],
    ["max(1, 'a')", 'type_error', 8, 'max() needs numbers, got text'],
    ['count(1)', 'type_error', 1, 'count() needs a list, got a number'],
    ['eval(1)', 'unknown_function', 1, 'Unknown function "eval"; available: floor, ceil'],
    ['constructor()', 'unknown_function', 1, ''],
    ['toString()', 'unknown_function', 1, ''],
  ])('%s → %s at column %i', (source, code, column, message) => {
    const error = failure(source);
    expect(error).toMatchObject({ code, line: 1, column });
    expect(error.message).toContain(message);
  });

  it('reports positions on later lines', () => {
    expect(failure('1 +\n  @nope')).toMatchObject({ line: 2, column: 3 });
  });

  it('rejects numbers that overflow', () => {
    const data = { big: Number.MAX_VALUE };
    for (const source of ['@big * 10', '@big + @big', '-@big - @big', 'sum(@big, @big)']) {
      expect(failure(source, { data })).toMatchObject({ code: 'not_finite' });
    }
    expect(failure('9'.repeat(400))).toMatchObject({ code: 'not_finite' });
    expect(failure('@n', { data: { n: Number.NaN } })).toMatchObject({ code: 'invalid_value' });
  });

  it('rejects data a formula cannot use', () => {
    for (const value of [null, undefined, 1n, () => 1, Symbol('x')]) {
      expect(failure('@x', { data: { x: value } })).toMatchObject({ code: 'invalid_value' });
    }
  });

  it('wraps failing plugin functions', () => {
    const functions: Record<string, FormulaFunction> = {
      boom: () => {
        throw new Error('no luck');
      },
      odd: () => {
        // A non-Error throw is still reported.
        const reason: unknown = 'bad';
        throw reason;
      },
      obj: () => ({ a: 1 }),
      nan: () => Number.NaN,
    };
    expect(failure('boom()', { functions })).toMatchObject({
      code: 'function_failed',
      message: 'boom() failed: no luck (line 1, column 1)',
    });
    expect(failure('odd()', { functions }).message).toContain('odd() failed: bad');
    expect(failure('obj()', { functions })).toMatchObject({ code: 'invalid_value' });
    expect(failure('nan()', { functions })).toMatchObject({ code: 'invalid_value' });
    expect(failure('nope()', { functions }).message).toContain('clamp, boom, odd, obj, nan');
  });
});

describe('step limit (specs §8.9)', () => {
  it(`defaults to ${String(DEFAULT_MAX_STEPS)}`, () => {
    const list = Array.from({ length: DEFAULT_MAX_STEPS }, (_, i) => i);
    expect(failure('sum(@list[*])', { data: { list } })).toMatchObject({
      code: 'step_limit',
      message: `The formula takes more than ${String(DEFAULT_MAX_STEPS)} steps (line 1, column 5)`,
    });
    expect(run('sum(@list[*])', { data: { list: list.slice(0, 100) } })).toBe(4950);
  });

  it('counts every node', () => {
    expect(run('1 + 1', { maxSteps: 3 })).toBe(2);
    expect(failure('1 + 1', { maxSteps: 2 })).toMatchObject({ code: 'step_limit', column: 5 });
  });
});

describe('properties', () => {
  const OWN = ['a', 's', 'b', 'list', 'map'];
  const FORBIDDEN = [
    'constructor',
    '__proto__',
    'prototype',
    'toString',
    'valueOf',
    'hasOwnProperty',
    'eval',
    'Function',
    'trap',
  ];

  it('returns a value or a FormulaError for any formula', () => {
    const data = { a: 1, s: 'x', b: true, list: [1, 2], map: { k: { a: 2 } } };
    const tree = formulaTree({
      names: fc.constantFrom(...OWN, 'k', ...FORBIDDEN),
      functions: fc.constantFrom(...BUILTIN_FUNCTIONS, 'shared', ...FORBIDDEN),
    });
    fc.assert(
      fc.property(tree, (ast) => {
        try {
          const value = evaluate({ source: '', ast }, { data, functions: { shared: () => 1 } });
          const values: unknown[] = Array.isArray(value) ? value : [value];
          for (const item of values) expect(['number', 'string', 'boolean']).toContain(typeof item);
        } catch (error) {
          expect(error).toBeInstanceOf(FormulaError);
        }
      }),
      { numRuns: 3000 },
    );
  });

  it('never reaches functions or data outside the whitelist', () => {
    const reached: string[] = [];
    // Anything inherited, or any function the formula is not allowed to call, records itself.
    const trap = Object.fromEntries(
      FORBIDDEN.map((name) => [
        name,
        {
          get() {
            reached.push(name);
            return () => 1;
          },
        },
      ]),
    );
    const trappedPrototype = Object.defineProperties({}, trap);
    const inheriting = (): Record<string, unknown> =>
      Object.create(trappedPrototype) as Record<string, unknown>;
    const data: Record<string, unknown> = Object.assign(inheriting(), {
      a: 1,
      s: 'x',
      b: true,
      list: [1, 2],
      map: Object.assign(inheriting(), { k: { a: 2 } }),
    });
    const called: string[] = [];
    const functions = new Proxy<Record<string, FormulaFunction>>(
      Object.assign(inheriting() as Record<string, FormulaFunction>, { shared: () => 1 }),
      {
        get(target, key, receiver) {
          called.push(String(key));
          return Reflect.get(target, key, receiver) as unknown;
        },
      },
    );
    const tree = formulaTree({
      names: fc.constantFrom(...OWN, 'k', ...FORBIDDEN),
      functions: fc.constantFrom(...BUILTIN_FUNCTIONS, 'shared', ...FORBIDDEN),
    });
    fc.assert(
      fc.property(tree, (ast) => {
        try {
          evaluate({ source: '', ast }, { data, functions });
        } catch (error) {
          expect(error).toBeInstanceOf(FormulaError);
        }
        expect(reached).toEqual([]);
        expect(called.every((name) => name === 'shared')).toBe(true);
      }),
      { numRuns: 3000 },
    );
  });

  it('stays within the step limit', () => {
    fc.assert(
      fc.property(
        formulaTree({ names: fc.constantFrom('list') }),
        fc.integer({ min: 1, max: 50 }),
        (ast, maxSteps) => {
          let steps = 0;
          // Each step reads a node; a data getter counts how often the list is read.
          const data = {
            get list() {
              steps += 1;
              return [1, 2, 3];
            },
          };
          try {
            evaluate({ source: '', ast }, { data, maxSteps });
          } catch (error) {
            expect(error).toBeInstanceOf(FormulaError);
          }
          expect(steps).toBeLessThanOrEqual(maxSteps);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
