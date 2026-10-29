import {
  compile,
  evaluate,
  FormulaError,
  type Formula,
  type FormulaFunction,
  type Value,
} from '@vtt/formula';
import type { Combine, Contribution, ItemType } from '@vtt/plugin-schema';

import { withDefaults } from './data.js';
import { computeDerived, type FormulaFailure } from './derived.js';

/** One item an actor holds: its type and stored or live data (ADR-063). */
export interface HeldItem {
  type: string;
  data: Readonly<Record<string, unknown>>;
}

/** What `@items` reads: each contributed name combined over an actor's items. */
export interface ItemTotals {
  values: Record<string, Value>;
  /** Names whose formula failed on some item; that item is left out of the total. */
  errors: Record<string, FormulaFailure>;
}

interface Total {
  combine: Combine;
  formulas: Map<string, Formula | FormulaFailure>;
  value: Value;
}

const start = (contribution: Contribution, combine: Combine): Value => {
  if (combine === 'any') return false;
  if (combine === 'max' || combine === 'min') return contribution.default ?? 0;
  return 0;
};

/** `value` folded into `total`, or a message when it has the wrong type for the combine. */
function fold(combine: Combine, total: Value, value: Value): Value | string {
  if (combine === 'any' || combine === 'count') {
    if (typeof value !== 'boolean') return `${combine} needs true or false, not ${typeof value}`;
    if (combine === 'any') return total === true || value;
    return Number(total) + (value ? 1 : 0);
  }
  if (typeof value !== 'number') return `${combine} needs a number, not ${typeof value}`;
  const current = Number(total);
  if (combine === 'sum') return current + value;
  return combine === 'max' ? Math.max(current, value) : Math.min(current, value);
}

/**
 * The totals of every name the item types contribute, over `items` (FR-PLUGIN-15, ADR-063).
 * Each contribution is worked out from its item's own data, with defaults filled in, and its
 * derived values. With no item, a total is 0 (`sum`, `count`), false (`any`) or its default
 * (`max`, `min`). An item whose type the system no longer declares contributes nothing, and an
 * item whose formula fails is left out of that total and reported.
 */
export function itemTotals(
  itemTypes: Readonly<Record<string, ItemType>>,
  items: readonly HeldItem[],
  {
    settings = {},
    functions = {},
  }: {
    settings?: Readonly<Record<string, Value>>;
    functions?: Readonly<Record<string, FormulaFunction>>;
  } = {},
): ItemTotals {
  const totals = new Map<string, Total>();
  for (const [typeName, type] of Object.entries(itemTypes)) {
    for (const [name, contribution] of Object.entries(type.contributes ?? {})) {
      // The validator makes every type agree on the combine; the first one sets it.
      const combine = contribution.combine ?? 'sum';
      const total = totals.get(name) ?? {
        combine,
        formulas: new Map(),
        value: start(contribution, combine),
      };
      let compiled: Formula | FormulaFailure;
      try {
        compiled = compile(contribution.formula);
      } catch (error) {
        if (!(error instanceof FormulaError)) throw error;
        compiled = { code: error.code, message: error.message };
      }
      total.formulas.set(typeName, compiled);
      totals.set(name, total);
    }
  }

  const errors: Record<string, FormulaFailure> = {};
  for (const item of items) {
    const type = Object.hasOwn(itemTypes, item.type) ? itemTypes[item.type] : undefined;
    if (!type?.contributes) continue;
    const data = withDefaults(type.schema, item.data);
    const derived = computeDerived(type.derived ?? {}, data, { settings, functions });
    const scope = { ...data, derived: derived.values, settings };
    for (const [name, total] of totals) {
      const formula = total.formulas.get(item.type);
      if (!formula) continue;
      if (!('ast' in formula)) {
        errors[name] ??= formula;
        continue;
      }
      try {
        const next = fold(
          total.combine,
          total.value,
          evaluate(formula, { data: scope, functions }),
        );
        // Totals are numbers or booleans, so a string is fold's complaint.
        if (typeof next === 'string') errors[name] ??= { code: 'type_mismatch', message: next };
        else total.value = next;
      } catch (error) {
        if (!(error instanceof FormulaError)) throw error;
        errors[name] ??= { code: error.code, message: error.message };
      }
    }
  }
  return {
    values: Object.fromEntries([...totals].map(([name, total]) => [name, total.value])),
    errors,
  };
}
