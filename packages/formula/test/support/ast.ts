import fc from 'fast-check';

import type { DiceModifier, Expression, PathSegment } from '../../src/index.js';

/** The AST without source offsets, for comparing trees parsed from different text. */
export function withoutSpans(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSpans);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'span')
      .map(([key, entry]) => [key, withoutSpans(entry)]),
  );
}

const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false']);
const word = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,6}$/);
// Function names never start with `d`, which would read as a die (`d6(…)`).
const functionName = fc
  .stringMatching(/^[a-ce-z_][a-z0-9_]{0,6}$/)
  .filter((name) => !KEYWORDS.has(name));
const span = { start: 0, end: 0 };

const integerRaw = fc.nat({ max: 10_000 }).map(String);
const numberRaw = fc.oneof(
  integerRaw,
  fc
    .tuple(fc.nat({ max: 999 }), fc.stringMatching(/^\d{1,3}$/))
    .map(([a, b]) => `${String(a)}.${b}`),
);
const numberNode = (raw: fc.Arbitrary<string>): fc.Arbitrary<Expression> =>
  raw.map((text) => ({ kind: 'number', value: Number(text), raw: text, span }));

const comparison = fc.record({
  comparator: fc.constantFrom('=', '<', '<=', '>', '>=' as const),
  value: fc.nat({ max: 100 }),
});
const modifiers: fc.Arbitrary<DiceModifier[]> = fc
  .tuple(
    fc.option(
      fc.record({
        kind: fc.constantFrom('keep', 'drop' as const),
        which: fc.constantFrom('highest', 'lowest' as const),
        count: fc.nat({ max: 20 }),
      }),
    ),
    fc.option(fc.constant({ kind: 'explode' as const })),
    fc.option(comparison.map((c) => ({ kind: 'reroll' as const, comparison: c }))),
    fc.option(comparison.map((c) => ({ kind: 'success' as const, comparison: c }))),
    fc.option(comparison.map((c) => ({ kind: 'failure' as const, comparison: c }))),
  )
  .chain((options) =>
    fc.shuffledSubarray(
      options.filter((option): option is DiceModifier => option !== null),
      { minLength: options.filter((option) => option !== null).length },
    ),
  );

export interface TreeOptions {
  /** Names of references and fields; random words by default. */
  names?: fc.Arbitrary<string>;
  /** Names of called functions; random words by default. */
  functions?: fc.Arbitrary<string>;
}

/** Random formula ASTs, with every node kind and dice modifier. */
export const formulaTree = ({
  names = word,
  functions = functionName,
}: TreeOptions = {}): fc.Arbitrary<Expression> =>
  fc.letrec<{
    expression: Expression;
    segment: PathSegment;
  }>((tie) => ({
    expression: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      numberNode(numberRaw),
      fc.string({ maxLength: 8 }).map((value) => ({ kind: 'string', value, span })),
      fc.boolean().map((value) => ({ kind: 'boolean', value, span })),
      fc.record({
        kind: fc.constant('reference'),
        name: names,
        path: fc.array(tie('segment'), { maxLength: 3 }),
        span: fc.constant(span),
      }),
      fc.record({
        kind: fc.constant('unary'),
        operator: fc.constantFrom('-', 'not' as const),
        operand: tie('expression'),
        span: fc.constant(span),
      }),
      fc.record({
        kind: fc.constant('binary'),
        operator: fc.constantFrom(
          '+',
          '-',
          '*',
          '/',
          '%',
          '<',
          '<=',
          '>',
          '>=',
          '==',
          '!=',
          'and',
          'or' as const,
        ),
        left: tie('expression'),
        right: tie('expression'),
        span: fc.constant(span),
      }),
      fc.record({
        kind: fc.constant('conditional'),
        test: tie('expression'),
        then: tie('expression'),
        otherwise: tie('expression'),
        span: fc.constant(span),
      }),
      fc.record({
        kind: fc.constant('call'),
        name: functions,
        args: fc.array(tie('expression'), { maxLength: 3 }),
        span: fc.constant(span),
      }),
      fc.record({
        kind: fc.constant('dice'),
        count: fc.oneof(fc.constant(null), numberNode(integerRaw), tie('expression')),
        die: fc.oneof(
          fc.integer({ min: 1, max: 1000 }).map((sides) => ({ kind: 'standard' as const, sides })),
          fc
            .stringMatching(/^d[A-Z][A-Z0-9]{0,3}$/)
            .map((name) => ({ kind: 'custom' as const, name })),
        ),
        modifiers,
        span: fc.constant(span),
      }),
    ) as fc.Arbitrary<Expression>,
    segment: fc.oneof(
      names.map((name) => ({ kind: 'field' as const, name })),
      tie('expression').map((index) => ({ kind: 'index' as const, index })),
      fc.constant({ kind: 'all' as const }),
    ),
  })).expression;

export const expression = formulaTree();
