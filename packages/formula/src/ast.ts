// The formula AST (specs §8.9). Every node keeps the offsets of the source it came from, so
// evaluation errors can point at it.

/** Source offsets: `start` inclusive, `end` exclusive. */
export interface Span {
  start: number;
  end: number;
}

export interface NumberLiteral {
  kind: 'number';
  value: number;
  /** The digits as written, so printing never switches to exponent notation. */
  raw: string;
  span: Span;
}

export interface StringLiteral {
  kind: 'string';
  value: string;
  span: Span;
}

export interface BooleanLiteral {
  kind: 'boolean';
  value: boolean;
  span: Span;
}

/** One step after the root name of a reference: `.field`, `[expr]` or `[*]`. */
export type PathSegment =
  { kind: 'field'; name: string } | { kind: 'index'; index: Expression } | { kind: 'all' };

/** `@name.sub[@args.id].field`, `@collection[*].field` (specs §8.9). */
export interface Reference {
  kind: 'reference';
  name: string;
  path: PathSegment[];
  span: Span;
}

export type UnaryOperator = '-' | 'not';

export interface Unary {
  kind: 'unary';
  operator: UnaryOperator;
  operand: Expression;
  span: Span;
}

export const ARITHMETIC_OPERATORS = ['+', '-', '*', '/', '%'] as const;
export const COMPARISON_OPERATORS = ['<', '<=', '>', '>=', '==', '!='] as const;
export const LOGICAL_OPERATORS = ['and', 'or'] as const;

export type ArithmeticOperator = (typeof ARITHMETIC_OPERATORS)[number];
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];
export type LogicalOperator = (typeof LOGICAL_OPERATORS)[number];
export type BinaryOperator = ArithmeticOperator | ComparisonOperator | LogicalOperator;

export interface Binary {
  kind: 'binary';
  operator: BinaryOperator;
  left: Expression;
  right: Expression;
  span: Span;
}

/** `test ? then : otherwise` */
export interface Conditional {
  kind: 'conditional';
  test: Expression;
  then: Expression;
  otherwise: Expression;
  span: Span;
}

/** A function call; the evaluator decides which names exist (the whitelist). */
export interface Call {
  kind: 'call';
  name: string;
  args: Expression[];
  span: Span;
}

/** The comparison of a reroll or success modifier: `r<2`, `cs>=5`. A bare number is `=`. */
export type DieComparator = '=' | '<' | '<=' | '>' | '>=';
export interface DieComparison {
  comparator: DieComparator;
  value: number;
}

export type DiceModifier =
  | { kind: 'keep' | 'drop'; which: 'highest' | 'lowest'; count: number }
  | { kind: 'explode' }
  | { kind: 'reroll' | 'success' | 'failure'; comparison: DieComparison };

/** `d20`, `4d6kh3`, `(@pool)d6cs>=5`, `4dF` (FR-DICE-01, 03). */
export interface Dice {
  kind: 'dice';
  /** A literal count, an expression in parentheses, or null for a single die. */
  count: Expression | null;
  die: { kind: 'standard'; sides: number } | { kind: 'custom'; name: string };
  modifiers: DiceModifier[];
  span: Span;
}

export type Expression =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | Reference
  | Unary
  | Binary
  | Conditional
  | Call
  | Dice;
