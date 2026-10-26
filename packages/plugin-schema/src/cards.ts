import { z } from 'zod';

import { cssClass, formula, schemaUrl, text } from './common.js';

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
            "Reads `@total`, `@roll.expression`, `@roll.resolved` and the entity's data. It cannot roll dice.",
          ),
          class: cssClass.optional(),
        })
        .meta({ title: 'Card row' }),
    ),
    /** Show the matching outcome of the recipe. */
    outcome: z.boolean().optional().describe("Shows the recipe's outcome."),
  })
  .describe('How a recipe roll shows in chat.');
export type Card = z.infer<typeof cardSchema>;
