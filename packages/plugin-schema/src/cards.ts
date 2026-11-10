import { z } from 'zod';

import { cssClass, formula, schemaUrl, text } from './common.js';

/** The most actions one card offers (T-1615). */
export const MAX_CARD_ACTIONS = 4;

/** `cards/<name>.json`: a chat card the core renders from a roll (specs §8.11). */
export const cardSchema = z
  .strictObject({
    ...schemaUrl,
    title: text.describe('A lang key or literal text.'),
    rows: z.array(
      z
        .strictObject({
          label: text.describe('A lang key or literal text.'),
          /** Reads `@roll`, `@total` and the actor's data. */
          value: formula.describe(
            "Reads `@total`, `@roll` (`expression`, `resolved`, `total`, `natural`, `dice`), the recipe's `@rolls` and `@let`, and the entity's data. It cannot roll dice.",
          ),
          class: cssClass.optional(),
        })
        .meta({ title: 'Card row' }),
    ),
    /** Buttons that step a counter of each target (T-1615). */
    apply: z
      .array(
        z
          .strictObject({
            label: text.describe('The button, such as "Apply damage"; a lang key or literal text.'),
            field: z
              .string()
              .min(1)
              .max(200)
              .describe(
                'The path of a counter (`x-counter`) of each type the recipe targets, such as `hp.value`.',
              ),
            amount: formula.describe(
              'How much to step the counter by, worked out when the roll is made: negative lowers it, such as `-@rolls.damage.total`. It reads what rows read.',
            ),
          })
          .meta({ title: 'Card action' }),
      )
      .max(MAX_CARD_ACTIONS)
      .optional()
      .describe(
        'Buttons the card shows by each target of the roll, for those who may edit it; each steps a counter of the target once. Only for recipes with `target`.',
      ),
    /** Show the matching outcome of the recipe. */
    outcome: z.boolean().optional().describe("Shows the recipe's outcome."),
  })
  .describe('How a recipe roll shows in chat.');
export type Card = z.infer<typeof cardSchema>;
