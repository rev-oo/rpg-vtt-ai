import { z } from 'zod';

import { cssClass, formula, identifier, name, schemaUrl, text } from './common.js';

/** Checked in order; the first whose `when` holds wins, and one without `when` always does. */
export const outcomeSchema = z
  .strictObject({
    when: formula
      .optional()
      .describe(
        'A true/false formula that can read `@total`, `@roll`, `@rolls`, `@let` and `@options`; leave it out for the fallback.',
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

/** The item types a recipe is made with (ADR-063); handler recipes too (T-1610). */
const item = z
  .array(name)
  .min(1)
  .optional()
  .describe(
    'Item types the roll is made with. It is then rolled from an `items` row or an item’s sheet; formulas read the item as `@item`, and server code gets it as `item`.',
  );

/** The actor types a recipe may target (T-1615). */
const target = z
  .array(name)
  .min(1)
  .optional()
  .describe(
    'Actor types the roll may target: it then carries the tokens the roller targets. Its formulas, outcomes and card read the first target as `@target` (its fields, `derived`, `id`, `name` and `type`) and how many there are as `@targets`; `@target` exists only when `@targets > 0`.',
  );

/** The most options one recipe asks for, and choices one option offers (T-1609). */
export const MAX_ROLL_OPTIONS = 10;

/** The keys held while clicking a roll button that pick a choice and roll at once (T-1609). */
export const ROLL_SHORTCUTS = ['shift', 'ctrl'] as const;
export type RollShortcut = (typeof ROLL_SHORTCUTS)[number];

/** A number or a formula worked out before rolling, such as `@item.level`. */
const bound = z.union([z.number(), formula]);

const choiceOption = z
  .strictObject({
    type: z.literal('choice'),
    label: text.describe('What the option asks; a lang key or literal text.'),
    choices: z
      .array(
        z.strictObject({
          value: identifier.describe("Read as `@options.<name>`, such as `'advantage'`."),
          label: text.describe('A lang key or literal text.'),
          key: z
            .enum(ROLL_SHORTCUTS)
            .optional()
            .describe(
              'Holding this key while clicking the button picks this choice and rolls at once, with the other options at their defaults.',
            ),
        }),
      )
      .min(2)
      .max(MAX_ROLL_OPTIONS),
    default: identifier.optional().describe('The value picked at first; the first when left out.'),
  })
  .meta({ title: 'Choice option' });

const numberOption = z
  .strictObject({
    type: z.literal('number'),
    label: text.describe('What the option asks; a lang key or literal text.'),
    default: bound.describe('A whole number, or a formula such as `@item.level`.'),
    minimum: bound.optional().describe('The lowest whole number allowed, or a formula.'),
    maximum: bound.optional().describe('The highest whole number allowed, or a formula.'),
  })
  .meta({ title: 'Number option' });

const diceOption = z
  .strictObject({
    type: z.literal('dice'),
    label: text.describe('What the option asks; a lang key or literal text.'),
    default: z
      .string()
      .max(200)
      .optional()
      .describe('Dice such as `1d4`, or nothing (the default).'),
  })
  .meta({ title: 'Dice option' });

export const rollOptionSchema = z.discriminatedUnion('type', [
  choiceOption,
  numberOption,
  diceOption,
]);
export type RollOption = z.infer<typeof rollOptionSchema>;

export const formulaRecipeSchema = z
  .strictObject({
    label: text.optional().describe('The roll name in chat; a lang key or literal text.'),
    let: z
      .record(identifier, formula)
      .optional()
      .describe(
        'Named values worked out before rolling, in order, without dice. The formulas, outcomes and card read them as `@let.<name>`; each reads the ones before it.',
      ),
    options: z
      .record(identifier, rollOptionSchema)
      .refine((options) => Object.keys(options).length <= MAX_ROLL_OPTIONS, {
        message: `At most ${String(MAX_ROLL_OPTIONS)} options`,
      })
      .optional()
      .describe(
        'What the app asks for when the button is pressed: a choice, a whole number or dice. Formulas, named values, outcomes and the card read them as `@options.<name>`; the server checks them.',
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
    item,
    target,
    then: name
      .optional()
      .describe(
        'A handler in `code/server`, run after the roll is posted. It gets the result, the item and the options, and can step counters, such as spending a spell slot.',
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
    item,
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
