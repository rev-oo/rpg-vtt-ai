import { z } from 'zod';

import { cssClass, formula, identifier, name, schemaUrl, text } from './common.js';

/** Checked in order; the first whose `when` holds wins, and one without `when` always does. */
export const outcomeSchema = z
  .strictObject({
    when: formula
      .optional()
      .describe(
        'A true/false formula that can read `@total`, `@roll`, `@rolls` and `@let`; leave it out for the fallback.',
      ),
    label: text.describe('Shown with the roll; a lang key or literal text.'),
    class: cssClass.optional().describe('A CSS class for the outcome, for `styles/*.css`.'),
  })
  .meta({ title: 'Outcome' });

/** The most formulas one recipe rolls (T-1608). */
export const MAX_RECIPE_ROLLS = 10;

/** The actor types a recipe is for (T-1608); every type when left out. */
const actors = z
  .array(name)
  .min(1)
  .optional()
  .describe(
    'The actor types that may roll it. The validator checks it against these only, sheets of other types cannot show its buttons, and the server refuses it for other actors.',
  );

export const formulaRecipeSchema = z
  .strictObject({
    label: text.optional().describe('The roll name in chat; a lang key or literal text.'),
    let: z
      .record(identifier, formula)
      .optional()
      .describe(
        'Named values worked out before rolling, in order, without dice. The formulas, outcomes and card read them as `@let.<name>`; each reads the ones before it.',
      ),
    formula: z
      .union([
        formula,
        z
          .record(identifier, formula)
          .refine(
            (rolls) => {
              const count = Object.keys(rolls).length;
              return count >= 1 && count <= MAX_RECIPE_ROLLS;
            },
            { message: `Between 1 and ${String(MAX_RECIPE_ROLLS)} formulas` },
          )
          .meta({ title: 'Named formulas' }),
      ])
      .describe(
        "What to roll: dice and `@` references to the entity's data, `@derived`, `@args` and `@settings`. Or several formulas by name, rolled in order into one message; each reads those before it as `@rolls.<name>`.",
      ),
    outcomes: z
      .array(outcomeSchema)
      .optional()
      .describe('Checked in order; the first whose `when` is true is shown.'),
    /** A file in `cards/`, without `.json`. */
    card: name.optional().describe('A card in `cards/`, without `.json`, to show the roll with.'),
    item: z
      .array(name)
      .min(1)
      .optional()
      .describe(
        'Item types the roll is made with. It is then rolled from an `items` row or an item’s sheet, and reads the item as `@item`.',
      ),
    actors,
  })
  .meta({ title: 'Formula recipe' });

/** Rolled by an exported function of `code/server` instead (specs §8.10). */
export const handlerRecipeSchema = z
  .strictObject({
    label: text.optional(),
    handler: name.describe(
      'A handler in `code/server`, run on the server when the recipe is rolled.',
    ),
    actors,
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
