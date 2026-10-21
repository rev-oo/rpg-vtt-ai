import { z } from 'zod';

// A roll as stored in a chat message (FR-CHAT-04, FR-DICE-04). The server copies
// `@vtt/formula`'s RollResult into it; its fields are the formula package's (ADR-017).

const flag = z.literal(true).optional();

/** One die: only `active` dice count toward the total. */
export const dieResultSchema = z.object({
  value: z.number(),
  /** The face shown, for custom dice. */
  label: z.string().optional(),
  active: z.boolean(),
  rerolled: flag,
  exploded: flag,
  dropped: flag,
  success: flag,
  failure: flag,
});
export type DieResult = z.infer<typeof dieResultSchema>;

/** One dice term, such as `4d6kh3`, with its count resolved. */
export const diceRollSchema = z.object({
  formula: z.string(),
  count: z.number().int(),
  die: z.string(),
  results: z.array(dieResultSchema),
  total: z.number(),
});
export type DiceRoll = z.infer<typeof diceRollSchema>;

export const rollSchema = z.object({
  /** The formula as typed. */
  expression: z.string(),
  /** The formula with references replaced by the values they read (FR-DICE-02). */
  resolved: z.string(),
  total: z.number(),
  dice: z.array(diceRollSchema),
});
export type Roll = z.infer<typeof rollSchema>;
