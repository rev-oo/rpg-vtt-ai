import { z } from 'zod';

import { cssClass, fieldPath, formula, identifier, name, schemaUrl, text } from './common.js';

/** The most actions one card offers (T-1617). */
export const MAX_CARD_ACTIONS = 6;

const when = formula
  .optional()
  .describe(
    'A true/false formula worked out when the roll is made, reading what rows read; the card offers the action only when it is true.',
  );

const applyAction = z
  .strictObject({
    label: text.describe("The button's text; a lang key or literal text."),
    field: fieldPath.describe(
      'A counter (`x-counter`) of the actor it is applied to, such as `hp.value`.',
    ),
    amount: formula.describe(
      'How far to step the counter, worked out when the roll is made and rounded as `round()` does: `-@rolls.damage.total` takes damage away, `@total` heals. It reads what rows read.',
    ),
    when,
  })
  .meta({
    title: 'Apply action',
    description:
      'Steps a counter of the actor of the token the clicker has selected, within its bounds, if they may edit that actor.',
  });

const rollAction = z
  .strictObject({
    label: text.describe("The button's text; a lang key or literal text."),
    roll: name.describe(
      'A recipe in `rolls.json`, rolled for the actor `for` names, if the clicker may roll for it. Only a `roller` action may name a recipe made with an item: it rolls with the item the card was rolled with.',
    ),
    for: z
      .enum(['selected', 'roller'])
      .optional()
      .describe(
        'Whom it rolls for: `selected` (the default), the actor of the token the clicker has selected, such as a saving throw; `roller`, the actor that made this roll, such as the damage of a hit.',
      ),
    args: z
      .record(identifier, formula)
      .optional()
      .describe(
        'Values the recipe reads as `@args.<name>`, worked out when this card is rolled, such as `{ "dc": "@derived.spellDc" }`.',
      ),
    when,
  })
  .meta({
    title: 'Roll action',
    description:
      'Rolls another recipe for the selected token, such as the saving throw a spell asks for, or for the actor that rolled the card, such as the damage of an attack.',
  });

export const cardActionSchema = z.union([applyAction, rollAction]);
export type CardAction = z.infer<typeof cardActionSchema>;

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
    /** Show the matching outcome of the recipe. */
    outcome: z.boolean().optional().describe("Shows the recipe's outcome."),
    actions: z
      .array(cardActionSchema)
      .max(MAX_CARD_ACTIONS)
      .optional()
      .describe(
        'Buttons under the card. An apply action steps a counter of the token the clicker has selected on the map, such as taking damage; a roll action rolls a recipe for that token, such as a saving throw, or for the actor that rolled the card, such as the damage of a hit.',
      ),
  })
  .describe('How a recipe roll shows in chat.');
export type Card = z.infer<typeof cardSchema>;
