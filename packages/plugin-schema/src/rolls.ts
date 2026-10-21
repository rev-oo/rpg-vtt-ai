import { z } from 'zod';

import { cssClass, formula, name, schemaUrl, text } from './common.js';

/** Checked in order; the first whose `when` holds wins, and one without `when` always does. */
export const outcomeSchema = z.strictObject({
  when: formula.optional(),
  label: text,
  class: cssClass.optional(),
});

export const formulaRecipeSchema = z.strictObject({
  label: text.optional(),
  formula,
  outcomes: z.array(outcomeSchema).optional(),
  /** A file in `cards/`, without `.json`. */
  card: name.optional(),
});

/** Rolled by an exported function of `code/server` instead (specs §8.10). */
export const handlerRecipeSchema = z.strictObject({
  label: text.optional(),
  handler: name,
});

export const recipeSchema = z.union([formulaRecipeSchema, handlerRecipeSchema]);
export type Recipe = z.infer<typeof recipeSchema>;

/** `rolls.json`: recipes by name (specs §8.7); names are checked by the validator. */
export const rollsSchema = z.object(schemaUrl).catchall(recipeSchema);
export type Rolls = z.infer<typeof rollsSchema>;
