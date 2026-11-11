import { evaluate, FormulaError, type FormulaFunction, type Value } from '@vtt/formula';
import type { Card, CardAction } from '@vtt/plugin-schema';

import { formatValue } from './values.js';

export interface ResolvedCardRow {
  label: string;
  /** The row's value as text; empty when its formula failed. */
  value: string;
  class?: string;
  /** Why the value could not be computed. */
  error?: string;
}

/** A scalar a recipe reads as `@args.<name>`. */
export type CardActionArg = string | number | boolean;

/**
 * A card action worked out when the roll was made (T-1617): the counter step to apply to the
 * token the clicker has selected, or the recipe to roll with its arguments, for that token or,
 * with `for: 'roller'`, for the actor that rolled the card.
 */
export type ResolvedCardAction = { label: string; error?: string } & (
  | { kind: 'apply'; field: string; amount: number }
  | { kind: 'roll'; roll: string; args: Record<string, CardActionArg>; for?: 'roller' }
);

/** A card with its rows computed, ready for the core renderer or a custom component. */
export interface ResolvedCard {
  /** The file in `cards/`, which a custom card component of the same name overrides. */
  name: string;
  title: string;
  rows: ResolvedCardRow[];
  /** Whether the card shows the recipe's outcome. */
  outcome: boolean;
  /** The actions whose `when` held, in order; absent when the card declares none. */
  actions?: ResolvedCardAction[];
}

type Evaluate = (source: string) => Value;

/** Why a formula failed, or its value. */
function attempt(run: () => Value): { value: Value } | { error: string } {
  try {
    return { value: run() };
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    return { error: error.message };
  }
}

/**
 * One action, or `null` when its `when` is not true. An amount or argument that fails, or is
 * not of the kind it needs, leaves the action shown with its error, so the card can say why.
 */
function resolveAction(action: CardAction, run: Evaluate): ResolvedCardAction | null {
  if (action.when !== undefined) {
    const shown = attempt(() => run(action.when ?? ''));
    if (!('value' in shown) || shown.value !== true) return null;
  }
  const { label } = action;
  if ('field' in action) {
    const amount = attempt(() => run(action.amount));
    if ('error' in amount)
      return { kind: 'apply', label, field: action.field, amount: 0, error: amount.error };
    if (typeof amount.value !== 'number' || !Number.isFinite(amount.value))
      return {
        kind: 'apply',
        label,
        field: action.field,
        amount: 0,
        error: `Expected a number, got ${formatValue(amount.value)}`,
      };
    return { kind: 'apply', label, field: action.field, amount: Math.round(amount.value) };
  }
  const base = {
    kind: 'roll' as const,
    label,
    roll: action.roll,
    ...(action.for === 'roller' && { for: action.for }),
  };
  const args: Record<string, CardActionArg> = {};
  for (const [name, source] of Object.entries(action.args ?? {})) {
    const result = attempt(() => run(source));
    if ('error' in result) return { ...base, args: {}, error: result.error };
    if (typeof result.value === 'object')
      return {
        ...base,
        args: {},
        error: `Expected text, a number or true/false, got ${formatValue(result.value)}`,
      };
    args[name] = result.value;
  }
  return { ...base, args };
}

/**
 * Computes a card's rows (specs §8.11) in pure mode. `data` is what the rows may read: the
 * actor's data, `derived`, `settings`, `args`, `total` and `roll`. A row whose formula fails
 * keeps its label and carries the error, so one bad row does not hide the roll. Actions are
 * worked out the same way (T-1617).
 */
export function resolveCard(
  name: string,
  card: Card,
  data: Readonly<Record<string, unknown>>,
  functions: Readonly<Record<string, FormulaFunction>> = {},
): ResolvedCard {
  const run: Evaluate = (source) => evaluate(source, { data, functions });
  return {
    name,
    title: card.title,
    outcome: card.outcome === true,
    ...(card.actions && {
      actions: card.actions
        .map((action) => resolveAction(action, run))
        .filter((action) => action !== null),
    }),
    rows: card.rows.map((row) => {
      const base = { label: row.label, ...(row.class !== undefined && { class: row.class }) };
      try {
        return { ...base, value: formatValue(evaluate(row.value, { data, functions })) };
      } catch (error) {
        if (!(error instanceof FormulaError)) throw error;
        return { ...base, value: '', error: error.message };
      }
    }),
  };
}
