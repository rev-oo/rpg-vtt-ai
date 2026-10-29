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
export const RESERVED_ROOTS = [
  'derived',
  'args',
  'row',
  'settings',
  'total',
  'roll',
  'items',
] as const;

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
  /** `@items.*`: the names item types contribute; only actor formulas read them (ADR-063). */
  items?: ReadonlySet<string> | undefined;
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
    case 'items':
      return scope.data === undefined || onlyName(path, scope.items);
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

/** Whether a field, or anything inside it, is on the secret layer (specs §9.3). */
function holdsSecret(field: FieldSchema): boolean {
  if (field['x-layer'] === 'secret') return true;
  if (field.type === 'object') return Object.values(field.properties ?? {}).some(holdsSecret);
  return field.type === 'array' && field.items !== undefined && holdsSecret(field.items);
}

/** Whether reading `segments` of `schema` can reach a secret value. */
function readsSecret(schema: FieldSchema, segments: readonly PathSegment[]): boolean {
  const [segment, ...rest] = segments;
  if (schema['x-layer'] === 'secret') return true;
  if (!segment) return holdsSecret(schema);
  if (segment.kind === 'field') {
    const properties = schema.type === 'object' ? schema.properties : undefined;
    const field =
      properties && Object.hasOwn(properties, segment.name) ? properties[segment.name] : undefined;
    return field !== undefined && readsSecret(field, rest);
  }
  return schema.type === 'array' && schema.items !== undefined && readsSecret(schema.items, rest);
}

/**
 * The references of a formula that reach secret fields of `schema`, directly or through the
 * derived values it reads (ADR-063). Formulas that do not parse are skipped: they are reported
 * where they are checked.
 */
export function secretReads(
  source: string,
  schema: FieldSchema,
  derived: Readonly<Record<string, string>>,
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (text: string, via: string | undefined) => {
    let tree: Expression;
    try {
      tree = parse(text);
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      return;
    }
    const pending = [tree];
    for (let node = pending.pop(); node; node = pending.pop()) {
      pending.push(...childrenOf(node));
      if (node.kind !== 'reference') continue;
      const [first] = node.path;
      if (node.name === 'derived' && first?.kind === 'field') {
        const next = Object.hasOwn(derived, first.name) ? derived[first.name] : undefined;
        if (next !== undefined && !seen.has(first.name)) {
          seen.add(first.name);
          walk(next, via ?? `@derived.${first.name}`);
        }
      } else if (
        !(RESERVED_ROOTS as readonly string[]).includes(node.name) &&
        readsSecret(schema, [{ kind: 'field', name: node.name }, ...node.path])
      ) {
        found.push(via ?? text.slice(node.span.start, node.span.end));
      }
    }
  };
  walk(source, undefined);
  return [...new Set(found)];
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
