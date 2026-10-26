import { z } from 'zod';

/** `lang/<locale>.json`: flat keys to text (FR-PLUGIN-05). */
export const langSchema = z
  .record(z.string().min(1).max(200), z.string())
  .describe('Texts by lang key, such as `"field.str": "Strength"`. The file name is the locale.');
export type Lang = z.infer<typeof langSchema>;
