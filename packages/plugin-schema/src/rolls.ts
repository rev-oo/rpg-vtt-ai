import { z } from 'zod';

import { cssClass, formula, name, schemaUrl, text } from './common.js';

/** Checked in order; the first whose `when` holds wins, and one without `when` always does. */
export const outcomeSchema = z
  .strictObject({
    when: formula
      .optional()
      .describe(
        'A true/false formula that can read `@total` and `@roll`; leave it out for the fallback.',
      ),
    label: text.describe('Shown with the roll; a lang key or literal text.'),
    class: cssClass.optional().describe('A CSS class for the outcome, for `styles/*.css`.'),
  })
  .meta({ title: 'Outcome' });

export const formulaRecipeSchema = z
  .strictObject({
    label: text.optional().describe('The roll name in chat; a lang key or literal text.'),
    formula: formula.describe(
      "What to roll: dice and `@` references to the entity's data, `@derived`, `@args` and `@settings`.",
    ),
    outcomes: z
      .array(outcomeSchema)
      .optional()
      .describe('Checked in order; the first whose `when` is true is shown.'),
    /** A file in `cards/`, without `.json`. */
    card: name.optional().describe('A card in `cards/`, without `.json`, to show the roll with.'),
  })
  .meta({ title: 'Formula recipe' });

/** Rolled by an exported function of `code/server` instead (specs §8.10). */
export const handlerRecipeSchema = z
  .strictObject({
    label: text.optional(),
    handler: name.describe('A handler in `code/server`. Not run yet: rolling it fails.'),
  })
  .meta({ title: 'Handler recipe' });

export const recipeSchema = z.union([formulaRecipeSchema, handlerRecipeSchema]);
export type Recipe = z.infer<typeof recipeSchema>;

/** `rolls.json`: recipes by name (specs §8.7); names are checked by the validator. */
export const rollsSchema = z
  .object(schemaUrl)
  .catchall(recipeSchema)
  .describe(
    'Roll recipes for `rollButton` nodes, each under a name such as `skill` (letters, digits, `_` and `-`).',
  );
export type Rolls = z.infer<typeof rollsSchema>;
