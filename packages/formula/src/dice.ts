import type { Dice, DiceModifier, DieComparison } from './ast.js';
import type { Rng } from './rng.js';

/** One face of a custom die: what it shows and what it counts as (FR-DICE-03). */
export interface DieFace {
  label: string;
  value: number;
}

/** A plugin die such as Fate's `dF` (specs §8.8). */
export interface CustomDie {
  faces: readonly DieFace[];
}

export const MAX_SIDES = 1_000_000;
/** Dice rolled by one roll, explosions and rerolls included. */
export const DEFAULT_MAX_DICE = 1000;

/** One die as rolled (FR-DICE-04). Only `active` dice count toward the total. */
export interface DieResult {
  value: number;
  /** The face shown, for custom dice. */
  label?: string;
  active: boolean;
  /** Replaced by the next die (`r`). */
  rerolled?: true;
  /** Showed its highest face and added another die (`!`). */
  exploded?: true;
  /** Left out by `kh`, `kl`, `dh` or `dl`. */
  dropped?: true;
  success?: true;
  failure?: true;
}

/** Everything one dice term rolled. */
export interface DiceRoll {
  /** The term with its count resolved, e.g. `3d6kh2`. */
  formula: string;
  count: number;
  die: string;
  results: DieResult[];
  /** The sum of active dice, or successes minus failures when `cs`/`cf` are used. */
  total: number;
}

/** Why a term cannot be rolled; the evaluator turns it into a `FormulaError`. */
export class DiceError extends Error {
  constructor(
    readonly code: 'invalid_dice' | 'too_many_dice',
    message: string,
  ) {
    super(message);
  }
}

/** The faces of a die, as values with optional labels. */
export interface ResolvedDie {
  name: string;
  /** Rolls one face. */
  roll(rng: Rng): { value: number; label?: string };
  highest: number;
}

export function standardDie(sides: number): ResolvedDie {
  if (!Number.isInteger(sides) || sides < 1 || sides > MAX_SIDES) {
    throw new DiceError('invalid_dice', `A die needs between 1 and ${String(MAX_SIDES)} sides`);
  }
  return {
    name: `d${String(sides)}`,
    highest: sides,
    roll: (rng) => ({ value: draw(rng, sides) + 1 }),
  };
}

export function customDie(name: string, die: CustomDie): ResolvedDie {
  const { faces } = die;
  if (faces.length === 0 || faces.length > MAX_SIDES) {
    throw new DiceError('invalid_dice', `The die ${name} has no faces`);
  }
  return {
    name,
    highest: Math.max(...faces.map((face) => face.value)),
    roll: (rng) => {
      const face = faces[draw(rng, faces.length)] ?? { label: '', value: 0 };
      return { value: face.value, label: face.label };
    },
  };
}

/** One RNG draw, checked, since a broken RNG would otherwise corrupt every roll. */
function draw(rng: Rng, n: number): number {
  const value = rng.nextInt(n);
  if (!Number.isInteger(value) || value < 0 || value >= n) {
    throw new RangeError(`The RNG returned ${String(value)} for a range of ${String(n)}`);
  }
  return value;
}

function matches(value: number, { comparator, value: target }: DieComparison): boolean {
  switch (comparator) {
    case '=':
      return value === target;
    case '<':
      return value < target;
    case '<=':
      return value <= target;
    case '>':
      return value > target;
    case '>=':
      return value >= target;
  }
}

type KeepOrDrop = Extract<DiceModifier, { which: unknown }>;
type Compared = Extract<DiceModifier, { comparison: unknown }>;

function comparisonOf(
  modifiers: readonly DiceModifier[],
  kind: Compared['kind'],
): DieComparison | undefined {
  return modifiers.find((modifier): modifier is Compared => modifier.kind === kind)?.comparison;
}

export interface DiceBudget {
  /** Dice that may still be rolled. */
  remaining: number;
}

/**
 * Rolls `count` dice with the term's modifiers. Whatever order they are written in, they apply
 * as: reroll once (`r`), explode (`!`), keep or drop, then count successes and failures.
 */
export function rollDice(
  term: Pick<Dice, 'modifiers'>,
  die: ResolvedDie,
  count: number,
  rng: Rng,
  budget: DiceBudget,
  formula: string,
): DiceRoll {
  const reroll = comparisonOf(term.modifiers, 'reroll');
  const explode = term.modifiers.some((modifier) => modifier.kind === 'explode');
  const keep = term.modifiers.find(
    (modifier): modifier is KeepOrDrop => modifier.kind === 'keep' || modifier.kind === 'drop',
  );
  const success = comparisonOf(term.modifiers, 'success');
  const failure = comparisonOf(term.modifiers, 'failure');

  const results: DieResult[] = [];
  const rollOne = (): DieResult => {
    budget.remaining -= 1;
    if (budget.remaining < 0) {
      throw new DiceError('too_many_dice', 'The roll uses too many dice');
    }
    const face = die.roll(rng);
    const result: DieResult = { value: face.value, active: true };
    if (face.label !== undefined) result.label = face.label;
    return result;
  };

  let pending = count;
  while (pending > 0) {
    pending -= 1;
    let result = rollOne();
    if (reroll && matches(result.value, reroll)) {
      results.push({ ...result, active: false, rerolled: true });
      result = rollOne();
    }
    if (explode && result.value === die.highest) {
      result.exploded = true;
      pending += 1;
    }
    results.push(result);
  }

  if (keep) {
    const active = results.filter((result) => result.active);
    // Highest first; ties keep their rolling order, so results are reproducible.
    const ordered = [...active].sort((a, b) =>
      keep.which === 'highest' ? b.value - a.value : a.value - b.value,
    );
    const chosen = new Set(ordered.slice(0, keep.count));
    for (const result of active) {
      const kept = keep.kind === 'keep' ? chosen.has(result) : !chosen.has(result);
      if (!kept) {
        result.active = false;
        result.dropped = true;
      }
    }
  }

  let total = 0;
  for (const result of results) {
    if (!result.active) continue;
    if (success || failure) {
      if (success && matches(result.value, success)) {
        result.success = true;
        total += 1;
      }
      if (failure && matches(result.value, failure)) {
        result.failure = true;
        total -= 1;
      }
    } else {
      total += result.value;
    }
  }
  return { formula, count, die: die.name, results, total };
}
