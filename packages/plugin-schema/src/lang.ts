import { z } from 'zod';

/** `lang/<locale>.json`: flat keys to text (FR-PLUGIN-05). */
export const langSchema = z.record(z.string().min(1).max(200), z.string());
export type Lang = z.infer<typeof langSchema>;
