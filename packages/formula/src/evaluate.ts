import type { Dice, Die, Expression, PathSegment, Span } from './ast.js';
import { parseDice } from './dice-text.js';
import {
  customDie,
  DEFAULT_MAX_DICE,
  DiceError,
  MAX_SIDES,
  rollDice,
  standardDie,
  type CustomDie,
  type DiceBudget,
  type DiceRoll,
  type ResolvedDie,
} from './dice.js';
import { FormulaError, type FormulaErrorCode } from './errors.js';
import { parse } from './parser.js';
import { print } from './print.js';
import type { Rng } from './rng.js';

/** What a formula computes. Lists come only from aggregates: `@skills[*].rank`. */
export type Scalar = number | string | boolean;
export type Value = Scalar | readonly Scalar[];

/** A plugin's `shared` function (specs §8.10). It must be pure and return a scalar. */
export type FormulaFunction = (...args: Value[]) => unknown;

export const DEFAULT_MAX_STEPS = 10_000;

export const BUILTIN_FUNCTIONS = [
  'floor',
  'ceil',
  'round',
  'min',
  'max',
  'abs',
  'sum',
  'count',
  'if',
  'clamp',
  'roll',
  'text',
  'signed',
] as const;
export type BuiltinFunction = (typeof BUILTIN_FUNCTIONS)[number];

export interface EvaluationContext {
  /**
   * The roots of `@` references: `@str` reads `data.str`, `@derived.strMod` reads
   * `data.derived.strMod`. Only own properties are read.
   */
  data?: Readonly<Record<string, unknown>>;
  /** Functions beyond the built-in whitelist; they cannot replace a built-in. */
  functions?: Readonly<Record<string, FormulaFunction>>;
  /** Nodes and aggregate elements evaluated before giving up (specs §8.9). */
  maxSteps?: number;
}

/** Rolling mode: dice allowed, server only (specs §8.9). */
export interface RollContext extends EvaluationContext {
  rng: Rng;
  /** The system's custom dice by name, such as `dF` (FR-DICE-03). */
  customDice?: Readonly<Record<string, CustomDie>>;
  /** Dice one roll may use, explosions and rerolls included. */
  maxDice?: number;
}

/** A roll as stored in a chat message (FR-DICE-02, 04). */
export interface RollResult {
  /** The formula as written. */
  expression: string;
  /** The formula with every reference replaced by the value it read: `1d20 + 2 + 3`. */
  resolved: string;
  total: number;
  /** Every dice term, in the order rolled. */
  dice: DiceRoll[];
}

/** Dice state while rolling; absent in pure mode. */
interface Rolling {
  rng: Rng;
  customDice: Readonly<Record<string, CustomDie>>;
  budget: DiceBudget;
  rolls: DiceRoll[];
  /** What each reference evaluated to, for the resolved expression. */
  values: Map<Expression, Value>;
  /** Each dice term with its count and size worked out. */
  dice: Map<Expression, Dice>;
  /** The branch each conditional and `if()` took. */
  branches: Map<Expression, Expression>;
  /** The dice expression each `roll()` rolled. */
  inlined: Map<Expression, Expression>;
}

/** A parsed formula with its source, which error positions refer to. */
export interface Formula {
  source: string;
  ast: Expression;
}

/** Parses once, for formulas evaluated many times (derived values, outcomes). */
export function compile(source: string): Formula {
  return { source, ast: parse(source) };
}

const isBuiltin = (name: string): name is BuiltinFunction =>
  (BUILTIN_FUNCTIONS as readonly string[]).includes(name);

/** How a value reads in an error message. */
function typeName(value: unknown): string {
  if (Array.isArray(value)) return 'a list';
  switch (typeof value) {
    case 'number':
      return 'a number';
    case 'string':
      return 'text';
    case 'boolean':
      return 'true/false';
    case 'undefined':
      return 'nothing';
    case 'object':
      return value === null ? 'nothing' : 'a group of fields';
    default:
      return `a ${typeof value}`;
  }
}

const isScalar = (value: unknown): value is Scalar =>
  (typeof value === 'number' && Number.isFinite(value)) ||
  typeof value === 'string' ||
  typeof value === 'boolean';

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

class Evaluator {
  private steps = 0;
  private readonly maxSteps: number;
  private readonly data: Readonly<Record<string, unknown>>;
  private readonly functions: Readonly<Record<string, FormulaFunction>>;

  constructor(
    private readonly source: string,
    context: EvaluationContext,
    private readonly rolling: Rolling | null = null,
  ) {
    this.maxSteps = context.maxSteps ?? DEFAULT_MAX_STEPS;
    this.data = context.data ?? {};
    this.functions = context.functions ?? {};
  }

  private error(code: FormulaErrorCode, detail: string, span: Span): FormulaError {
    return new FormulaError(code, detail, span, this.source);
  }

  private step(span: Span): void {
    this.steps += 1;
    if (this.steps > this.maxSteps) {
      throw this.error(
        'step_limit',
        `The formula takes more than ${String(this.maxSteps)} steps`,
        span,
      );
    }
  }

  private number(node: Expression): number {
    const value = this.evaluate(node);
    if (typeof value !== 'number') {
      throw this.error('type_error', `Expected a number, got ${typeName(value)}`, node.span);
    }
    return value;
  }

  private boolean(node: Expression): boolean {
    const value = this.evaluate(node);
    if (typeof value !== 'boolean') {
      throw this.error('type_error', `Expected true/false, got ${typeName(value)}`, node.span);
    }
    return value;
  }

  private finite(value: number, span: Span): number {
    if (!Number.isFinite(value)) {
      throw this.error('not_finite', 'The result is too large to compute', span);
    }
    return value;
  }

  evaluate(node: Expression): Value {
    this.step(node.span);
    switch (node.kind) {
      case 'number':
        return this.finite(node.value, node.span);
      case 'string':
      case 'boolean':
        return node.value;
      case 'reference': {
        const value = this.reference(node.name, node.path, node.span);
        this.rolling?.values.set(node, value);
        return value;
      }
      case 'unary':
        return node.operator === '-'
          ? this.finite(-this.number(node.operand), node.span)
          : !this.boolean(node.operand);
      case 'conditional':
        return this.branch(node, node.test, node.then, node.otherwise);
      case 'call':
        return this.call(node);
      case 'dice':
        return this.dice(node);
      case 'binary':
        return this.binary(node);
    }
  }

  private dice(node: Dice): number {
    if (!this.rolling) {
      throw this.error(
        'dice_not_allowed',
        'Dice can only be used in a roll, not in a derived value or a condition',
        node.span,
      );
    }
    const { rng, budget, rolls, customDice } = this.rolling;
    const count = node.count ? this.number(node.count) : 1;
    if (!Number.isInteger(count) || count < 0) {
      throw this.error(
        'invalid_dice',
        `The number of dice must be a whole number of 0 or more, not ${String(count)}`,
        node.count?.span ?? node.span,
      );
    }
    const die = node.die.kind === 'sized' ? this.sides(node.die.sides) : node.die;
    const resolved: Dice = {
      ...node,
      count: { kind: 'number', value: count, raw: String(count), span: node.span },
      die,
    };
    this.rolling.dice.set(node, resolved);
    try {
      const roll = rollDice(
        node,
        this.die(die, node.span, customDice),
        count,
        rng,
        budget,
        print(resolved),
      );
      rolls.push(roll);
      return roll.total;
    } catch (error) {
      if (error instanceof DiceError) throw this.error(error.code, error.message, node.span);
      throw error;
    }
  }

  /** A die whose size a formula works out: `d(@item.die)`. */
  private sides(node: Expression): Extract<Die, { kind: 'standard' }> {
    const sides = this.number(node);
    if (!Number.isInteger(sides) || sides < 1 || sides > MAX_SIDES) {
      throw this.error(
        'invalid_dice',
        `A die needs a whole number of sides from 1 to ${String(MAX_SIDES)}, not ${String(sides)}`,
        node.span,
      );
    }
    return { kind: 'standard', sides };
  }

  private die(
    die: Exclude<Die, { kind: 'sized' }>,
    span: Span,
    customDice: Readonly<Record<string, CustomDie>>,
  ): ResolvedDie {
    if (die.kind === 'standard') return standardDie(die.sides);
    const custom = Object.hasOwn(customDice, die.name) ? customDice[die.name] : undefined;
    if (!custom) {
      const known = Object.keys(customDice);
      throw this.error(
        'unknown_die',
        known.length > 0
          ? `Unknown die "${die.name}"; this system has ${known.join(', ')}`
          : `Unknown die "${die.name}"; this system has no custom dice`,
        span,
      );
    }
    return customDie(die.name, custom);
  }

  private binary(node: Extract<Expression, { kind: 'binary' }>): Value {
    const { operator, left, right, span } = node;
    switch (operator) {
      case 'and':
        return this.boolean(left) && this.boolean(right);
      case 'or':
        return this.boolean(left) || this.boolean(right);
      case '==':
      case '!=': {
        const a = this.scalar(left);
        const b = this.scalar(right);
        if (typeof a !== typeof b) {
          throw this.error('type_error', `Cannot compare ${typeName(a)} with ${typeName(b)}`, span);
        }
        return operator === '==' ? a === b : a !== b;
      }
      case '<':
      case '<=':
      case '>':
      case '>=': {
        const a = this.scalar(left);
        const b = this.scalar(right);
        if (typeof a !== typeof b || typeof a === 'boolean') {
          throw this.error(
            'type_error',
            `Cannot order ${typeName(a)} and ${typeName(b)}; compare two numbers or two texts`,
            span,
          );
        }
        if (operator === '<') return a < b;
        if (operator === '<=') return a <= b;
        if (operator === '>') return a > b;
        return a >= b;
      }
      case '+': {
        const a = this.evaluate(left);
        const b = this.evaluate(right);
        if (typeof a === 'number' && typeof b === 'number') return this.finite(a + b, span);
        // Text joins with text or a number: `@dice + 'd' + @die`.
        if (
          (typeof a === 'string' || typeof b === 'string') &&
          (typeof a === 'string' || typeof a === 'number') &&
          (typeof b === 'string' || typeof b === 'number')
        ) {
          return `${String(a)}${String(b)}`;
        }
        throw this.error(
          'type_error',
          `Cannot add ${typeName(a)} and ${typeName(b)}; add two numbers or join text with text or a number`,
          span,
        );
      }
      default: {
        const a = this.number(left);
        const b = this.number(right);
        if (operator === '-') return this.finite(a - b, span);
        if (operator === '*') return this.finite(a * b, span);
        if (b === 0) throw this.error('division_by_zero', 'Cannot divide by zero', right.span);
        return this.finite(operator === '/' ? a / b : a % b, span);
      }
    }
  }

  private scalar(node: Expression): Scalar {
    const value = this.evaluate(node);
    if (typeof value === 'object') {
      throw this.error('type_error', 'Expected a single value, got a list', node.span);
    }
    return value;
  }

  /**
   * Follows a reference through the data. Only own properties are read, so no formula can
   * reach `constructor`, `__proto__` or anything inherited.
   */
  private reference(name: string, path: PathSegment[], span: Span): Value {
    const { values, many, text } = this.resolve(name, path, span);
    const scalars = values.map((value) => {
      if (isScalar(value)) return value;
      throw this.error(
        'invalid_value',
        `${text()} is ${typeName(value)}; formulas need a number, text or true/false`,
        span,
      );
    });
    const [first] = scalars;
    return many || first === undefined ? scalars : first;
  }

  /** The data a reference points at, before checking that formulas can use it. */
  private resolve(
    name: string,
    path: PathSegment[],
    span: Span,
  ): { values: unknown[]; many: boolean; text: () => string } {
    const text = () => print({ kind: 'reference', name, path, span });
    const missing = () => this.error('unknown_reference', `${text()} does not exist`, span);
    if (!Object.hasOwn(this.data, name)) throw missing();

    let values: unknown[] = [this.data[name]];
    let many = false;
    for (const segment of path) {
      if (segment.kind === 'all') {
        many = true;
        values = values.flatMap((value) => {
          if (isList(value)) return value;
          if (isRecord(value)) return Object.values(value);
          throw this.error('type_error', `${text()}: [*] needs a collection`, span);
        });
        values.forEach(() => {
          this.step(span);
        });
        continue;
      }
      const key = segment.kind === 'field' ? segment.name : this.key(segment.index);
      values = values.map((value) => {
        if (isList(value)) {
          if (typeof key === 'number' && Number.isInteger(key) && key >= 0 && key < value.length) {
            return value[key];
          }
          throw missing();
        }
        if (isRecord(value) && Object.hasOwn(value, String(key))) return value[String(key)];
        throw missing();
      });
    }

    return { values, many, text };
  }

  private key(index: Expression): string | number {
    const value = this.evaluate(index);
    if (typeof value === 'string' || typeof value === 'number') return value;
    throw this.error(
      'type_error',
      `An index must be text or a number, not ${typeName(value)}`,
      index.span,
    );
  }

  /** Evaluates the branch `test` picks, and remembers it for the resolved expression. */
  private branch(
    node: Expression,
    test: Expression,
    then: Expression,
    otherwise: Expression,
  ): Value {
    const taken = this.boolean(test) ? then : otherwise;
    this.rolling?.branches.set(node, taken);
    return this.evaluate(taken);
  }

  private call(node: Extract<Expression, { kind: 'call' }>): Value {
    const { name, args, span } = node;
    if (isBuiltin(name)) return this.builtin(node, name);
    const fn = Object.hasOwn(this.functions, name) ? this.functions[name] : undefined;
    if (typeof fn !== 'function') {
      throw this.error(
        'unknown_function',
        `Unknown function "${name}"; available: ${[...BUILTIN_FUNCTIONS, ...Object.keys(this.functions)].join(', ')}`,
        span,
      );
    }
    const values = args.map((arg) => this.evaluate(arg));
    let result: unknown;
    try {
      result = fn(...values);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw this.error('function_failed', `${name}() failed: ${reason}`, span);
    }
    if (!isScalar(result)) {
      throw this.error(
        'invalid_value',
        `${name}() returned ${typeName(result)}; functions must return a number, text or true/false`,
        span,
      );
    }
    return result;
  }

  private arityError(name: string, count: number, given: number, span: Span): FormulaError {
    return this.error(
      'invalid_arguments',
      `${name}() takes ${String(count)} argument${count === 1 ? '' : 's'}, not ${String(given)}`,
      span,
    );
  }

  private one(name: string, args: Expression[], span: Span): Expression {
    const [first] = args;
    if (args.length !== 1 || !first) throw this.arityError(name, 1, args.length, span);
    return first;
  }

  /**
   * `roll(@item.damage)`: rolls a dice expression kept as text, in the same roll. A second
   * argument multiplies every die count, as critical hits do: `roll(@item.damage, 2)`.
   */
  private rollText(node: Extract<Expression, { kind: 'call' }>): number {
    const { args, span } = node;
    const [textArg, timesArg] = args;
    if (!textArg || args.length > 2) {
      throw this.error(
        'invalid_arguments',
        `roll() takes 1 or 2 arguments, not ${String(args.length)}`,
        span,
      );
    }
    if (!this.rolling) {
      throw this.error(
        'dice_not_allowed',
        'roll() can only be used in a roll, not in a derived value or a condition',
        span,
      );
    }
    const text = this.evaluate(textArg);
    if (typeof text !== 'string') {
      throw this.error('type_error', `roll() needs text, got ${typeName(text)}`, textArg.span);
    }
    const times = timesArg ? this.number(timesArg) : 1;
    if (!Number.isInteger(times) || times < 1 || times > MAX_DICE_MULTIPLIER) {
      throw this.error(
        'invalid_arguments',
        `roll() multiplies dice by a whole number from 1 to ${String(MAX_DICE_MULTIPLIER)}, not ${String(times)}`,
        timesArg?.span ?? span,
      );
    }
    try {
      const parsed = parseDice(text);
      const tree = parsed ? multiplyDice(parsed, times) : literal(0, span);
      this.rolling.inlined.set(node, tree);
      const inner = new Evaluator(text, { maxSteps: this.maxSteps - this.steps }, this.rolling);
      const total = inner.number(tree);
      this.steps += inner.steps;
      return total;
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      throw this.error(error.code, `roll('${text}'): ${error.detail}`, span);
    }
  }

  private three(
    name: string,
    args: Expression[],
    span: Span,
  ): [Expression, Expression, Expression] {
    const [first, second, third] = args;
    if (args.length !== 3 || !first || !second || !third) {
      throw this.arityError(name, 3, args.length, span);
    }
    return [first, second, third];
  }

  /** Every argument as numbers, lists flattened: `max(@a, @skills[*].rank)`. */
  private numbers(name: string, args: Expression[]): number[] {
    return args.flatMap((arg) => {
      const value = this.evaluate(arg);
      const list = typeof value === 'object' ? value : [value];
      return list.map((item) => {
        if (typeof item === 'number') return item;
        throw this.error('type_error', `${name}() needs numbers, got ${typeName(item)}`, arg.span);
      });
    });
  }

  private builtin(node: Extract<Expression, { kind: 'call' }>, name: BuiltinFunction): Value {
    const { args, span } = node;
    switch (name) {
      case 'floor':
      case 'ceil':
      case 'round':
      case 'abs': {
        return Math[name](this.number(this.one(name, args, span)));
      }
      case 'clamp': {
        const [value, min, max] = this.three(name, args, span);
        const [x, low, high] = [this.number(value), this.number(min), this.number(max)];
        if (low > high) {
          throw this.error(
            'invalid_arguments',
            'clamp() needs its minimum below its maximum',
            span,
          );
        }
        return Math.min(Math.max(x, low), high);
      }
      case 'if': {
        const [test, then, otherwise] = this.three(name, args, span);
        // Only the chosen branch runs, as with `?:`.
        return this.branch(node, test, then, otherwise);
      }
      case 'roll':
        return this.rollText(node);
      case 'text':
        return String(this.scalar(this.one(name, args, span)));
      case 'signed': {
        const value = this.number(this.one(name, args, span));
        return value >= 0 ? `+${String(value)}` : String(value);
      }
      case 'min':
      case 'max': {
        const values = this.numbers(name, args);
        if (values.length === 0) {
          throw this.error('invalid_arguments', `${name}() needs at least one number`, span);
        }
        return Math[name](...values);
      }
      case 'sum':
        return this.finite(
          this.numbers(name, args).reduce((total, value) => total + value, 0),
          span,
        );
      case 'count': {
        const first = this.one(name, args, span);
        // `count(@skills[*])` counts entries, which are groups of fields rather than values.
        if (first.kind === 'reference' && first.path.at(-1)?.kind === 'all') {
          this.step(first.span);
          return this.resolve(first.name, first.path, first.span).values.length;
        }
        const value = this.evaluate(first);
        if (typeof value !== 'object') {
          throw this.error('type_error', `count() needs a list, got ${typeName(value)}`, span);
        }
        return value.length;
      }
    }
  }
}

/**
 * Evaluates a formula in pure mode (specs §8.9): no dice, only whitelisted functions,
 * references read from `context.data`, and at most `maxSteps` steps. Throws a
 * `FormulaError` with the position of the failing part.
 */
export function evaluate(formula: Formula | string, context: EvaluationContext = {}): Value {
  const { source, ast } = typeof formula === 'string' ? compile(formula) : formula;
  return new Evaluator(source, context).evaluate(ast);
}

/**
 * Evaluates a formula in rolling mode (server only): dice are rolled with `context.rng`, and
 * the result lists every die. The total must be a number.
 */
export function roll(formula: Formula | string, context: RollContext): RollResult {
  const { source, ast } = typeof formula === 'string' ? compile(formula) : formula;
  const rolling: Rolling = {
    rng: context.rng,
    customDice: context.customDice ?? {},
    budget: { remaining: context.maxDice ?? DEFAULT_MAX_DICE },
    rolls: [],
    values: new Map(),
    dice: new Map(),
    branches: new Map(),
    inlined: new Map(),
  };
  const total = new Evaluator(source, context, rolling).evaluate(ast);
  if (typeof total !== 'number') {
    throw new FormulaError(
      'type_error',
      `A roll must add up to a number, not ${typeName(total)}`,
      ast.span,
      source,
    );
  }
  return {
    expression: source,
    resolved: print(substitute(ast, rolling)),
    total,
    dice: rolling.rolls,
  };
}

/** A literal for a value read during a roll. */
function literal(value: Scalar, span: Span): Expression {
  if (typeof value === 'number') return { kind: 'number', value, raw: String(value), span };
  if (typeof value === 'string') return { kind: 'string', value, span };
  return { kind: 'boolean', value, span };
}

/** The most `roll()` may multiply a dice expression's counts by. */
export const MAX_DICE_MULTIPLIER = 10;

/** A dice expression with every die count multiplied by `times`: `1d8 + 2` to `2d8 + 2`. */
function multiplyDice(node: Expression, times: number): Expression {
  if (times === 1) return node;
  switch (node.kind) {
    case 'dice': {
      const count: Expression = node.count
        ? {
            kind: 'binary',
            operator: '*',
            left: node.count,
            right: literal(times, node.span),
            span: node.span,
          }
        : literal(times, node.span);
      return { ...node, count };
    }
    case 'unary':
      return { ...node, operand: multiplyDice(node.operand, times) };
    case 'binary':
      return {
        ...node,
        left: multiplyDice(node.left, times),
        right: multiplyDice(node.right, times),
      };
    default:
      return node;
  }
}

/** Functions that always give a number. */
const NUMERIC_FUNCTIONS: ReadonlySet<string> = new Set([
  'floor',
  'ceil',
  'round',
  'min',
  'max',
  'abs',
  'sum',
  'count',
  'clamp',
]);

/** Whether a resolved node can only be a number, so adding zero to it changes nothing. */
function isNumeric(node: Expression): boolean {
  switch (node.kind) {
    case 'number':
    case 'dice':
      return true;
    case 'unary':
      return node.operator === '-';
    case 'binary':
      return (
        ['+', '-', '*', '/', '%'].includes(node.operator) &&
        isNumeric(node.left) &&
        isNumeric(node.right)
      );
    case 'call':
      return NUMERIC_FUNCTIONS.has(node.name);
    default:
      return false;
  }
}

const isZero = (node: Expression): boolean => node.kind === 'number' && node.value === 0;

/**
 * The tree as it was rolled (FR-DICE-02): references replaced by the values they read, dice
 * counts and sizes worked out, each conditional and `if()` replaced by the branch it took,
 * each `roll()` by the dice it rolled, and `+ 0` left out. A list passed to a function is
 * spread into its arguments: `sum(@skills[*].rank)` becomes `sum(1, 3)`. Parts that were
 * not evaluated, such as the right side of `false and …`, keep their references.
 */
function substitute(node: Expression, rolling: Rolling): Expression {
  const recurse = (child: Expression) => substitute(child, rolling);
  const replaced = rolling.branches.get(node) ?? rolling.inlined.get(node);
  if (replaced) return recurse(replaced);
  switch (node.kind) {
    case 'reference': {
      const value = rolling.values.get(node);
      if (value === undefined || typeof value === 'object') {
        return {
          ...node,
          path: node.path.map((segment) =>
            segment.kind === 'index' ? { ...segment, index: recurse(segment.index) } : segment,
          ),
        };
      }
      return literal(value, node.span);
    }
    case 'unary':
      return { ...node, operand: recurse(node.operand) };
    case 'binary': {
      const left = recurse(node.left);
      const right = recurse(node.right);
      if (node.operator === '+' || node.operator === '-') {
        if (isZero(right) && isNumeric(left)) return left;
        if (node.operator === '+' && isZero(left) && isNumeric(right)) return right;
      }
      return { ...node, left, right };
    }
    case 'conditional':
      return {
        ...node,
        test: recurse(node.test),
        then: recurse(node.then),
        otherwise: recurse(node.otherwise),
      };
    case 'call':
      return {
        ...node,
        args: node.args.flatMap((arg) => {
          const value = arg.kind === 'reference' ? rolling.values.get(arg) : undefined;
          return typeof value === 'object'
            ? value.map((item) => literal(item, arg.span))
            : [recurse(arg)];
        }),
      };
    case 'dice': {
      const resolved = rolling.dice.get(node);
      if (resolved) return resolved;
      return {
        ...node,
        count: node.count && recurse(node.count),
        die: node.die.kind === 'sized' ? { ...node.die, sides: recurse(node.die.sides) } : node.die,
      };
    }
    default:
      return node;
  }
}
