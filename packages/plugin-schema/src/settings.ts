import { z } from 'zod';

import { schemaUrl, text } from './common.js';

const common = { label: text, description: text.optional() };

/** One per-table option (specs §8.12, FR-ADMIN-04). */
export const settingSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...common, type: z.literal('boolean'), default: z.boolean() }),
  z.strictObject({
    ...common,
    type: z.literal('integer'),
    default: z.int(),
    minimum: z.int().optional(),
    maximum: z.int().optional(),
  }),
  z.strictObject({
    ...common,
    type: z.literal('number'),
    default: z.number(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  }),
  z.strictObject({
    ...common,
    type: z.literal('string'),
    default: z.string(),
    enum: z.array(z.string()).min(1).optional(),
    maxLength: z.int().min(1).optional(),
  }),
]);
export type Setting = z.infer<typeof settingSchema>;

/** `settings.json`: options by name (checked by the validator). */
export const settingsSchema = z.object(schemaUrl).catchall(settingSchema);
export type Settings = z.infer<typeof settingsSchema>;
