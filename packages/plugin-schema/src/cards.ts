import { z } from 'zod';

import { cssClass, formula, schemaUrl, text } from './common.js';

/** `cards/<name>.json`: a chat card the core renders from a roll (specs §8.11). */
export const cardSchema = z.strictObject({
  ...schemaUrl,
  title: text,
  rows: z.array(
    z.strictObject({
      label: text,
      /** Reads `@roll`, `@total` and the actor's data. */
      value: formula,
      class: cssClass.optional(),
    }),
  ),
  /** Show the matching outcome of the recipe. */
  outcome: z.boolean().optional(),
});
export type Card = z.infer<typeof cardSchema>;
