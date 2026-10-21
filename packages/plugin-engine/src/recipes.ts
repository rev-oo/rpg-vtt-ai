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
  roll: RollResult;
  /** The first outcome that matched, or null when none did or there are none. */
  outcome: RecipeOutcome | null;
  /** The resolved card; absent when the recipe has none or names one the plugin lacks. */
  card?: ResolvedCard;
  problems: RecipeProblem[];
}

export interface RecipeContext {
  /** The actor's data with `derived`, `settings` and `args` (see `rollScope`). */
  scope: Readonly<Record<string, unknown>>;
  rng: Rng;
  cards: Readonly<Record<string, Card>>;
  customDice?: Readonly<Record<string, CustomDie>>;
  functions?: Readonly<Record<string, FormulaFunction>>;
}

type FormulaRecipe = Extract<Recipe, { formula: string }>;

/** `@roll.*` in outcomes and cards: the roll without its dice. */
const rollValues = (result: RollResult): Record<string, Value> => ({
  expression: result.expression,
  resolved: result.resolved,
  total: result.total,
});

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
  { scope, rng, cards, customDice = {}, functions = {} }: RecipeContext,
): RecipeResult {
  const result = roll(recipe.formula, { data: scope, rng, customDice, functions });
  const problems: RecipeProblem[] = [];
  const after = { ...scope, total: result.total, roll: rollValues(result) };

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
  result: Pick<RecipeResult, 'recipe' | 'label' | 'roll' | 'outcome' | 'card'>,
  {
    hasTemplate,
    translate = (text) => text,
  }: { hasTemplate: (card: string) => boolean; translate?: Translate },
): ChatCardView {
  if (result.card && hasTemplate(result.card.name)) return { kind: 'card', card: result.card };
  const { roll: rolled, outcome } = result;
  const title = translate(result.label ?? result.recipe);
  const math =
    rolled.resolved === String(rolled.total)
      ? String(rolled.total)
      : `${rolled.resolved} = ${String(rolled.total)}`;
  const suffix = outcome ? ` (${translate(outcome.label)})` : '';
  return { kind: 'text', text: `${title}: ${math}${suffix}` };
}
