import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { FormulaError, MAX_DEPTH, parse, positionAt, print } from '../src/index.js';

import { expression, withoutSpans } from './support/ast.js';

/** `parse`, printed back canonically. */
const canonical = (source: string): string => print(parse(source));

describe('parse (specs §8.9)', () => {
  it('reads a roll recipe with references', () => {
    expect(withoutSpans(parse('1d20 + @derived.strMod + @skills[@args.id].rank'))).toEqual({
      kind: 'binary',
      operator: '+',
      left: {
        kind: 'binary',
        operator: '+',
        left: {
          kind: 'dice',
          count: { kind: 'number', value: 1, raw: '1' },
          die: { kind: 'standard', sides: 20 },
          modifiers: [],
        },
        right: { kind: 'reference', name: 'derived', path: [{ kind: 'field', name: 'strMod' }] },
      },
      right: {
        kind: 'reference',
        name: 'skills',
        path: [
          {
            kind: 'index',
            index: { kind: 'reference', name: 'args', path: [{ kind: 'field', name: 'id' }] },
          },
          { kind: 'field', name: 'rank' },
        ],
      },
    });
  });

  it('reads literals, aggregates and calls', () => {
    expect(withoutSpans(parse('@skills[*].rank'))).toEqual({
      kind: 'reference',
      name: 'skills',
      path: [{ kind: 'all' }, { kind: 'field', name: 'rank' }],
    });
    expect(withoutSpans(parse("'it\\'s \\\\ ok'"))).toEqual({
      kind: 'string',
      value: "it's \\ ok",
    });
    expect(withoutSpans(parse('true'))).toEqual({ kind: 'boolean', value: true });
    expect(withoutSpans(parse('2.50'))).toEqual({ kind: 'number', value: 2.5, raw: '2.50' });
    expect(canonical('max( 1 ,2,  min())')).toBe('max(1, 2, min())');
  });

  it.each([
    ['1 + 2 * 3', '1 + 2 * 3'],
    ['(1 + 2) * 3', '(1 + 2) * 3'],
    ['2 - 3 - 4', '2 - 3 - 4'],
    ['2 - (3 - 4)', '2 - (3 - 4)'],
    ['-@a * 2', '-@a * 2'],
    ['-(@a * 2)', '-(@a * 2)'],
    ['@a or @b and @c', '@a or @b and @c'],
    ['(@a or @b) and @c', '(@a or @b) and @c'],
    ['not @a == 1 and @b', 'not @a == 1 and @b'],
    ['(not @a) + 1', '(not @a) + 1'],
    ['@a ? 1 : @b ? 2 : 3', '@a ? 1 : @b ? 2 : 3'],
    ['(@a ? 1 : 2) + 3', '(@a ? 1 : 2) + 3'],
    ['@total >= 15', '@total >= 15'],
    ['((((7))))', '7'],
  ])('respects precedence: %s', (source, printed) => {
    expect(canonical(source)).toBe(printed);
  });

  it('groups operators as the precedence table says', () => {
    const tree = parse('1 + 2 * 3 % 4 < 5 and not 6 or 7 ? 8 : 9');
    expect(print(tree)).toBe('1 + 2 * 3 % 4 < 5 and not 6 or 7 ? 8 : 9');
    expect(tree.kind).toBe('conditional');
  });

  it.each([
    ['d20', 'd20'],
    ['4d6kh3', '4d6kh3'],
    ['2d20kl', '2d20kl1'],
    ['4d6dl1', '4d6dl1'],
    ['4d6dh1', '4d6dh1'],
    ['3d6!', '3d6!'],
    ['2d6r<2', '2d6r<2'],
    ['2d6r1', '2d6r1'],
    ['2d6r=1', '2d6r1'],
    ['10d10cs>=8cf1', '10d10cs>=8cf1'],
    ['5d10!cs>7', '5d10!cs>7'],
    ['4dF', '4dF'],
    ['dF', 'dF'],
    ['4dFcs>=1', '4dFcs>=1'],
    ['(@pool)d6cs>=5', '(@pool)d6cs>=5'],
    ['(@a + 1)d(6)', null],
    ['-2d6', '-2d6'],
  ])('reads dice terms (FR-DICE-01, 03): %s', (source, printed) => {
    if (printed === null) {
      expect(() => parse(source)).toThrow(FormulaError);
    } else {
      expect(canonical(source)).toBe(printed);
    }
  });

  it('reads the parts of a die', () => {
    expect(withoutSpans(parse('(@pool)d6!r<2kh2cs>=5'))).toEqual({
      kind: 'dice',
      count: { kind: 'reference', name: 'pool', path: [] },
      die: { kind: 'standard', sides: 6 },
      modifiers: [
        { kind: 'explode' },
        { kind: 'reroll', comparison: { comparator: '<', value: 2 } },
        { kind: 'keep', which: 'highest', count: 2 },
        { kind: 'success', comparison: { comparator: '>=', value: 5 } },
      ],
    });
    // `!=` after a die compares; it does not explode.
    expect(withoutSpans(parse('2d6!=7'))).toMatchObject({ kind: 'binary', operator: '!=' });
    // A group followed by a die with a space is not a count.
    expect(() => parse('(2) d6')).toThrow('Unexpected "d6"');
  });

  it('keeps dice-like words as names and fields', () => {
    expect(canonical('@dice.d6 + @dF.dF + @d20')).toBe('@dice.d6 + @dF.dF + @d20');
    expect(canonical('dex(1)')).toBe('dex(1)');
  });

  it('records source offsets', () => {
    const source = 'floor((@str - 10) / 2)';
    const tree = parse(source);
    expect(tree.span).toEqual({ start: 0, end: source.length });
    if (tree.kind !== 'call') throw new Error('expected a call');
    const [division] = tree.args;
    if (division?.kind !== 'binary' || division.left.kind !== 'binary') throw new Error('shape');
    // The group includes its parentheses; the reference is just `@str`.
    expect(division.left.span).toEqual({ start: 6, end: 17 });
    expect(division.left.left.span).toEqual({ start: 7, end: 11 });
  });
});

describe('syntax errors give a line and column', () => {
  it.each([
    ['', 'unexpected_end', 1, 1],
    ['1 +', 'unexpected_end', 1, 4],
    ['1 + * 2', 'unexpected_token', 1, 5],
    ['1 2', 'unexpected_token', 1, 3],
    ['floor(1', 'unexpected_end', 1, 8],
    ['floor(1 2)', 'unexpected_token', 1, 9],
    ['@a ? 1', 'unexpected_end', 1, 7],
    ["'abc", 'unterminated_string', 1, 1],
    ["'a\\x'", 'invalid_escape', 1, 3],
    ['1 +\n  # 2', 'unexpected_character', 2, 3],
    ['!@a', 'unexpected_character', 1, 1],
    ['@ a', 'unexpected_character', 1, 1],
    ['@a.', 'unexpected_end', 1, 4],
    ['@a.1', 'unexpected_token', 1, 4],
    ['@a[1', 'unexpected_end', 1, 5],
    ['str + 1', 'unknown_name', 1, 1],
    ['and 1', 'unexpected_token', 1, 1],
    [')', 'unexpected_token', 1, 1],
    ['1 < 2 < 3', 'chained_comparison', 1, 7],
    ['1 == 2 != 3', 'chained_comparison', 1, 8],
    ['4d6kh1kl1', 'duplicate_modifier', 1, 7],
    ['2d6!!', 'duplicate_modifier', 1, 5],
    ['2d6x', 'unexpected_token', 1, 4],
    ['1 +\r\n\t(2', 'unexpected_end', 2, 4],
  ])('%j → %s at %i:%i', (source, code, line, column) => {
    const error = (() => {
      try {
        parse(source);
      } catch (caught) {
        return caught;
      }
      throw new Error('expected a syntax error');
    })();
    expect(error).toBeInstanceOf(FormulaError);
    expect(error).toMatchObject({ code, line, column });
    expect((error as Error).message).toMatch(
      new RegExp(`\\(line ${String(line)}, column ${String(column)}\\)$`),
    );
  });

  it('words errors for people', () => {
    expect(() => parse('str + 1')).toThrow(
      'Unknown name "str"; references start with "@", as in @str (line 1, column 1)',
    );
    expect(() => parse('!@a')).toThrow('Unexpected character "!"; use "not" for negation');
    expect(() => parse('floor(1')).toThrow('Expected ")", but the formula ends');
    expect(() => parse('1 < 2 < 3')).toThrow('Comparisons cannot be chained; join them with "and"');
    expect(() => parse('4d6kh1kl1')).toThrow('A die can have only one keep or drop modifier');
    expect(() => parse('2d6r1r2')).toThrow('The modifier "r" appears twice');
  });

  it(`refuses formulas deeper than ${String(MAX_DEPTH)}`, () => {
    const nested = (depth: number) => `${'('.repeat(depth)}1${')'.repeat(depth)}`;
    const chain = (terms: number) => Array.from({ length: terms }, () => '1').join(' + ');
    expect(canonical(nested(MAX_DEPTH - 1))).toBe('1');
    expect(parse(chain(MAX_DEPTH)).kind).toBe('binary');
    for (const source of [nested(MAX_DEPTH + 1), chain(MAX_DEPTH + 2), `${'-'.repeat(10_000)}1`]) {
      expect(() => parse(source)).toThrow('The formula is too long or nested too deeply');
      expect(() => parse(source)).toThrow(expect.objectContaining({ code: 'too_deep' }));
    }
  });

  it('locates offsets', () => {
    expect(positionAt('ab\ncd', 0)).toEqual({ line: 1, column: 1 });
    expect(positionAt('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
    expect(positionAt('ab', 99)).toEqual({ line: 1, column: 3 });
  });
});

describe('properties', () => {
  it('round-trips: parse(print(ast)) is ast', () => {
    fc.assert(
      fc.property(expression, (tree) => {
        const printed = print(tree);
        expect(withoutSpans(parse(printed))).toEqual(withoutSpans(tree));
        expect(print(parse(printed))).toBe(printed);
      }),
      { numRuns: 2000 },
    );
  });

  it('fails only with a FormulaError inside the source', () => {
    const alphabet = fc.constantFrom(
      ..."0123456789dDF@.[]*()+-/%<>=!?:,' \n\\abkhlrcsfnotu_".split(''),
    );
    fc.assert(
      fc.property(
        fc.array(alphabet, { maxLength: 40 }).map((chars) => chars.join('')),
        (source) => {
          try {
            parse(source);
          } catch (error) {
            expect(error).toBeInstanceOf(FormulaError);
            const { span } = error as FormulaError;
            expect(span.start).toBeGreaterThanOrEqual(0);
            expect(span.end).toBeLessThanOrEqual(source.length);
          }
        },
      ),
      { numRuns: 5000 },
    );
  });
});
