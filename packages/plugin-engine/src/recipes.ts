import {
  evaluate,
  FormulaError,
  roll,
  type CustomDie,
  type FormulaFunction,
  type Rng,
  type RollResult,
  type Value,
} from '@vtt/formula';
import type { Card, Recipe } from '@vtt/plugin-schema';

import { resolveCard, type ResolvedCard } from './cards.js';
import type { FormulaFailure } from './derived.js';
import { EngineError } from './errors.js';
import type { OptionValue } from './options.js';
import { formatValue } from './values.js';

export interface RecipeOutcome {
  /** Its position in `outcomes`. */
  index: number;
  label: string;
  class?: string;
}

/** A problem that did not stop the roll: a broken outcome or card. */
export interface RecipeProblem extends FormulaFailure {
  /** `outcomes[1].when`, `card`. */
  at: string;
}

/** What a roll recipe produced (specs §8.7): the roll, its outcome and its card. */
export interface RecipeResult {
  recipe: string;
  label?: string;
  /** The first roll, which `@total` and `@roll` read. */
  roll: RollResult;
  /** Every roll in order: one, or one per named formula (T-1608). */
  rolls: RollResult[];
  /** The first outcome that matched, or null when none did or there are none. */
  outcome: RecipeOutcome | null;
  /** The resolved card; absent when the recipe has none or names one the plugin lacks. */
  card?: ResolvedCard;
  problems: RecipeProblem[];
  /** What `@options` read: the options asked for, the rest at their defaults (T-1609). */
  options?: Record<string, OptionValue>;
}

export interface RecipeContext {
  /** The actor's data with `derived`, `settings` and `args` (see `rollScope`). */
  scope: Readonly<Record<string, unknown>>;
  rng: Rng;
  cards: Readonly<Record<string, Card>>;
  customDice?: Readonly<Record<string, CustomDie>>;
  functions?: Readonly<Record<string, FormulaFunction>>;
}

type FormulaRecipe = Extract<Recipe, { formula: unknown }>;

/** The first die of the first d20 term that counts: a natural 20 is `@roll.natural == 20`. */
function natural(result: RollResult): number | undefined {
  const d20 = result.dice.find((term) => term.die === 'd20');
  return d20?.results.find((die) => die.active)?.value;
}

/**
 * `@roll` and `@rolls.<name>` (T-1608): the formula as written and as rolled, the total, the
 * natural d20, and each dice term with the values that count (`@roll.dice[0].kept[*]`).
 */
const rollValues = (result: RollResult): Record<string, unknown> => {
  const kept = natural(result);
  return {
    expression: result.expression,
    resolved: result.resolved,
    total: result.total,
    ...(kept !== undefined && { natural: kept }),
    dice: result.dice.map((term) => ({
      formula: term.formula,
      die: term.die,
      total: term.total,
      kept: term.results.filter((die) => die.active).map((die) => die.value),
    })),
  };
};

/** A recipe's named values, worked out in order without dice; each reads those before it. */
function letValues(
  lets: Readonly<Record<string, string>>,
  scope: Readonly<Record<string, unknown>>,
  functions: Readonly<Record<string, FormulaFunction>>,
): Record<string, Value> {
  const values: Record<string, Value> = {};
  for (const [name, source] of Object.entries(lets)) {
    values[name] = evaluate(source, { data: { ...scope, let: values }, functions });
  }
  return values;
}

/**
 * Rolls a formula recipe, then picks its outcome: outcomes are checked in order, the first
 * whose `when` is true wins, and one without `when` always matches (specs §8.7). A `when`
 * that fails or is not true or false does not match and is listed in `problems`.
 *
 * Throws a `FormulaError` when the recipe's formula cannot be rolled.
 */
export function rollRecipe(
  name: string,
  recipe: FormulaRecipe,
  { scope: entity, rng, cards, customDice = {}, functions = {} }: RecipeContext,
): RecipeResult {
  const scope = recipe.let ? { ...entity, let: letValues(recipe.let, entity, functions) } : entity;
  // One formula, or several by name rolled in order; each reads those before it (T-1608).
  const named = typeof recipe.formula === 'string' ? undefined : Object.entries(recipe.formula);
  const rolls: RollResult[] = [];
  const rolled: Record<string, unknown> = {};
  for (const [name, source] of named ?? [['', recipe.formula]]) {
    if (typeof source !== 'string') continue;
    const data = named ? { ...scope, rolls: rolled } : scope;
    const result = roll(source, { data, rng, customDice, functions });
    rolls.push(result);
    if (named) rolled[name] = rollValues(result);
  }
  const [result] = rolls;
  if (!result) throw new EngineError('unknown_recipe', `The roll "${name}" has no formula`);
  const problems: RecipeProblem[] = [];
  const after = {
    ...scope,
    ...(named && { rolls: rolled }),
    total: result.total,
    roll: rollValues(result),
  };

  let outcome: RecipeOutcome | null = null;
  for (const [index, candidate] of (recipe.outcomes ?? []).entries()) {
    let matches = true;
    if (candidate.when !== undefined) {
      try {
        const value = evaluate(candidate.when, { data: after, functions });
        matches = value === true;
        if (typeof value !== 'boolean') {
          problems.push({
            at: `outcomes[${String(index)}].when`,
            code: 'type_error',
            message: `Expected true/false, got ${formatValue(value)}`,
          });
        }
      } catch (error) {
        if (!(error instanceof FormulaError)) throw error;
        problems.push({
          at: `outcomes[${String(index)}].when`,
          code: error.code,
          message: error.message,
        });
        matches = false;
      }
    }
    if (matches) {
      outcome = {
        index,
        label: candidate.label,
        ...(candidate.class !== undefined && { class: candidate.class }),
      };
      break;
    }
  }

  let card: ResolvedCard | undefined;
  if (recipe.card !== undefined) {
    const definition = Object.hasOwn(cards, recipe.card) ? cards[recipe.card] : undefined;
    if (definition) card = resolveCard(recipe.card, definition, after, functions);
    else {
      problems.push({
        at: 'card',
        code: 'missing_card',
        message: `There is no card named "${recipe.card}"`,
      });
    }
  }

  return {
    recipe: name,
    ...(recipe.label !== undefined && { label: recipe.label }),
    roll: result,
    rolls,
    outcome,
    ...(card && { card }),
    problems,
  };
}

/** Plugin texts are lang keys or literal text; this turns them into what the user reads. */
export type Translate = (text: string) => string;

/** How a recipe roll shows in chat: its card, or plain text. */
export type ChatCardView = { kind: 'card'; card: ResolvedCard } | { kind: 'text'; text: string };

/**
 * Picks how to show a recipe roll (FR-CHAT-06). The card is used while its template still
 * exists, as a card file or a custom component; otherwise, as when the plugin was disabled
 * after the roll, the roll falls back to plain text: `Skill: 1d20 + 3 = 17 (Success)`.
 */
export function chatCardView(
  result: Pick<RecipeResult, 'recipe' | 'label' | 'rolls' | 'outcome' | 'card'>,
  {
    hasTemplate,
    translate = (text) => text,
  }: { hasTemplate: (card: string) => boolean; translate?: Translate },
): ChatCardView {
  if (result.card && hasTemplate(result.card.name)) return { kind: 'card', card: result.card };
  const { rolls, outcome } = result;
  const title = translate(result.label ?? result.recipe);
  const math = rolls
    .map((rolled) =>
      rolled.resolved === String(rolled.total)
        ? String(rolled.total)
        : `${rolled.resolved} = ${String(rolled.total)}`,
    )
    .join('; ');
  const suffix = outcome ? ` (${translate(outcome.label)})` : '';
  return { kind: 'text', text: `${title}: ${math}${suffix}` };
}
