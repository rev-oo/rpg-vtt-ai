import { z } from 'zod';

import { schemaUrl, text } from './common.js';

/** A face: its label, a number, or both. */
export const faceSchema = z.union([
  z.string().max(20),
  z.number(),
  z.strictObject({ label: z.string().max(20), value: z.number() }),
]);

/** A custom die (specs §8.8, FR-DICE-03). */
export const dieSchema = z.strictObject({
  label: text.optional(),
  faces: z.array(faceSchema).min(1).max(1000),
  /** What text faces count as, e.g. `{ "-": -1, " ": 0, "+": 1 }` for Fate. */
  values: z.record(z.string().max(20), z.number()).optional(),
});
export type Die = z.infer<typeof dieSchema>;

/** `dice.json`: dice by name, such as `dF` (names checked by the validator, ADR-017). */
export const diceSchema = z.object(schemaUrl).catchall(dieSchema);
export type DiceFile = z.infer<typeof diceSchema>;
