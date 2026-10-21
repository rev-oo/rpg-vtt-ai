import {
  BUILTIN_FUNCTIONS,
  childrenOf,
  type Expression,
  FormulaError,
  parse,
  type PathSegment,
} from '@vtt/formula';

import type { FieldSchema } from '../types.js';

import type { PluginIssue } from './issues.js';

/** Reference roots formulas get from the core rather than from the actor's data. */
export const RESERVED_ROOTS = ['derived', 'args', 'row', 'settings', 'total', 'roll'] as const;

/** What `@` references may name in one place a formula appears. */
export interface FormulaScope {
  /** Names the scope in messages: `actor type "character"`. */
  label: string;
  /**
   * The data schema. Undefined when the formula is not tied to a type (an unused sheet, or
   * one whose type is broken): then data and derived references go unchecked.
   */
  data?: FieldSchema | undefined;
  /** `@derived.*` names; undefined where derived values are not available. */
  derived?: ReadonlySet<string> | undefined;
  /** The row schema of the enclosing `list` (`@row.*`); `unchecked` when it is unknown. */
  row?: FieldSchema | 'unchecked' | undefined;
  /** `@args.*`: any key, since arguments come from roll buttons. */
  args?: boolean;
  /** `@total` and `@roll.*`: in outcomes and cards. */
  roll?: boolean;
  settings: ReadonlySet<string>;
}

export interface FormulaRules {
  /** Dice only belong to roll formulas; the rest run in pure mode (specs §8.9). */
  dice: boolean;
  customDice: ReadonlySet<string>;
  /** A plugin with code may call its shared functions, which the validator cannot list. */
  anyFunction: boolean;
}

export type Report = (code: PluginIssue['code'], params?: PluginIssue['params']) => void;

const BUILTINS: ReadonlySet<string> = new Set(BUILTIN_FUNCTIONS);

/**
 * Whether `segments` lead somewhere in `schema`. Collection rows also have an `id`
 * (specs §9.4).
 */
function resolvesIn(schema: FieldSchema, segments: readonly PathSegment[], isRow = false): boolean {
  const [segment, ...rest] = segments;
  if (!segment) return true;
  if (segment.kind === 'field') {
    if (isRow && segment.name === 'id' && rest.length === 0) return true;
    const properties = schema.type === 'object' ? schema.properties : undefined;
    const field =
      properties && Object.hasOwn(properties, segment.name) ? properties[segment.name] : undefined;
    return field !== undefined && resolvesIn(field, rest);
  }
  return (
    schema.type === 'array' && schema.items !== undefined && resolvesIn(schema.items, rest, true)
  );
}

const onlyName = (path: readonly PathSegment[], names: ReadonlySet<string> | undefined): boolean =>
  path.length === 1 && path[0]?.kind === 'field' && names?.has(path[0].name) === true;

function referenceExists(name: string, path: readonly PathSegment[], scope: FormulaScope): boolean {
  switch (name) {
    case 'derived':
      return scope.data === undefined || onlyName(path, scope.derived);
    case 'settings':
      return onlyName(path, scope.settings);
    case 'args':
      return scope.args === true && path.length > 0;
    case 'row':
      return (
        scope.row === 'unchecked' || (scope.row !== undefined && resolvesIn(scope.row, path, true))
      );
    case 'total':
      return scope.roll === true && path.length === 0;
    case 'roll':
      return scope.roll === true;
    default:
      return scope.data === undefined || resolvesIn(scope.data, [{ kind: 'field', name }, ...path]);
  }
}

/**
 * Parses one formula and checks its references, functions and dice. Returns the names of
 * the derived values it reads, or undefined when it does not parse.
 */
export function checkFormula(
  source: string,
  scope: FormulaScope,
  rules: FormulaRules,
  report: Report,
): string[] | undefined {
  let tree: Expression;
  try {
    tree = parse(source);
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    report('invalid_formula', { detail: error.detail, line: error.line, column: error.column });
    return undefined;
  }

  const derived: string[] = [];
  let diceReported = false;
  const pending = [tree];
  for (let node = pending.pop(); node; node = pending.pop()) {
    pending.push(...childrenOf(node));
    if (node.kind === 'reference') {
      const [first] = node.path;
      if (node.name === 'derived' && first?.kind === 'field') derived.push(first.name);
      if (!referenceExists(node.name, node.path, scope)) {
        report('unknown_reference', {
          reference: source.slice(node.span.start, node.span.end),
          scope: scope.label,
        });
      }
    } else if (node.kind === 'call') {
      if (!rules.anyFunction && !BUILTINS.has(node.name))
        report('unknown_function', { name: node.name });
    } else if (node.kind === 'dice') {
      if (!rules.dice && !diceReported) {
        report('dice_not_allowed');
        diceReported = true;
      }
      if (node.die.kind === 'custom' && !rules.customDice.has(node.die.name)) {
        report('unknown_die', { name: node.die.name });
      }
    }
  }
  return derived;
}

/** The first cycle among derived values, as names in order (`a → b → a`), if any. */
export function findCycle(graph: ReadonlyMap<string, readonly string[]>): string[] | undefined {
  const done = new Set<string>();
  const visit = (name: string, trail: string[]): string[] | undefined => {
    const seen = trail.indexOf(name);
    if (seen >= 0) return [...trail.slice(seen), name];
    if (done.has(name)) return undefined;
    for (const next of graph.get(name) ?? []) {
      if (!graph.has(next)) continue;
      const cycle = visit(next, [...trail, name]);
      if (cycle) return cycle;
    }
    done.add(name);
    return undefined;
  };
  for (const name of graph.keys()) {
    const cycle = visit(name, []);
    if (cycle) return cycle;
  }
  return undefined;
}
