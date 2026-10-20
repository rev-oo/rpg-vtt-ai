import type { Dice, Expression, PathSegment, Span } from './ast.js';
import {
  customDie,
  DEFAULT_MAX_DICE,
  DiceError,
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

/** A roll's total and every die behind it (FR-DICE-04). */
export interface RollResult {
  total: number;
  dice: DiceRoll[];
}

/** Dice state while rolling; absent in pure mode. */
interface Rolling {
  rng: Rng;
  customDice: Readonly<Record<string, CustomDie>>;
  budget: DiceBudget;
  rolls: DiceRoll[];
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
      case 'reference':
        return this.reference(node.name, node.path, node.span);
      case 'unary':
        return node.operator === '-'
          ? this.finite(-this.number(node.operand), node.span)
          : !this.boolean(node.operand);
      case 'conditional':
        return this.boolean(node.test) ? this.evaluate(node.then) : this.evaluate(node.otherwise);
      case 'call':
        return this.call(node.name, node.args, node.span);
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
    const resolved: Dice = {
      ...node,
      count: { kind: 'number', value: count, raw: String(count), span: node.span },
    };
    try {
      const die = this.die(node, customDice);
      const roll = rollDice(node, die, count, rng, budget, print(resolved));
      rolls.push(roll);
      return roll.total;
    } catch (error) {
      if (error instanceof DiceError) throw this.error(error.code, error.message, node.span);
      throw error;
    }
  }

  private die({ die, span }: Dice, customDice: Readonly<Record<string, CustomDie>>): ResolvedDie {
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
        if (typeof a === 'string' && typeof b === 'string') return a + b;
        if (typeof a === 'number' && typeof b === 'number') return this.finite(a + b, span);
        throw this.error(
          'type_error',
          `Cannot add ${typeName(a)} and ${typeName(b)}; add two numbers or join two texts`,
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

  private call(name: string, args: Expression[], span: Span): Value {
    if (isBuiltin(name)) return this.builtin(name, args, span);
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

  private builtin(name: BuiltinFunction, args: Expression[], span: Span): Value {
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
        return this.boolean(test) ? this.evaluate(then) : this.evaluate(otherwise);
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
  return { total, dice: rolling.rolls };
}
