import { evaluate, FormulaError, type FormulaFunction } from '@vtt/formula';
import type { Card } from '@vtt/plugin-schema';

import { formatValue } from './values.js';

export interface ResolvedCardRow {
  label: string;
  /** The row's value as text; empty when its formula failed. */
  value: string;
  class?: string;
  /** Why the value could not be computed. */
  error?: string;
}

/** A card's action with its amount worked out (T-1615): it steps `field` of each target. */
export interface ResolvedCardAction {
  label: string;
  field: string;
  /** A whole number; 0 when its formula failed. */
  amount: number;
  /** Why the amount could not be worked out; the action is not offered. */
  error?: string;
}

/** A card with its rows computed, ready for the core renderer or a custom component. */
export interface ResolvedCard {
  /** The file in `cards/`, which a custom card component of the same name overrides. */
  name: string;
  title: string;
  rows: ResolvedCardRow[];
  /** Whether the card shows the recipe's outcome. */
  outcome: boolean;
  /** What the card offers to do to the roll's targets (T-1615). */
  apply?: ResolvedCardAction[];
}

/** An action's amount: a formula that must give a whole number. */
function actionAmount(
  source: string,
  data: Readonly<Record<string, unknown>>,
  functions: Readonly<Record<string, FormulaFunction>>,
): { amount: number; error?: string } {
  try {
    const value = evaluate(source, { data, functions });
    if (typeof value === 'number' && Number.isInteger(value)) return { amount: value };
    return { amount: 0, error: `Expected a whole number, got ${formatValue(value)}` };
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    return { amount: 0, error: error.message };
  }
}

/**
 * Computes a card's rows (specs §8.11) in pure mode. `data` is what the rows may read: the
 * actor's data, `derived`, `settings`, `args`, `total` and `roll`. A row whose formula fails
 * keeps its label and carries the error, so one bad row does not hide the roll.
 */
export function resolveCard(
  name: string,
  card: Card,
  data: Readonly<Record<string, unknown>>,
  functions: Readonly<Record<string, FormulaFunction>> = {},
): ResolvedCard {
  return {
    name,
    title: card.title,
    outcome: card.outcome === true,
    ...(card.apply && {
      apply: card.apply.map(({ label, field, amount }) => ({
        label,
        field,
        ...actionAmount(amount, data, functions),
      })),
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
