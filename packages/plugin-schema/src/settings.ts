import { z } from 'zod';

import { schemaUrl, text } from './common.js';

const common = {
  label: text.describe('A lang key or literal text.'),
  description: text.optional().describe('Help shown under the option.'),
};

/** One per-table option (specs §8.12, FR-ADMIN-04). */
export const settingSchema = z
  .discriminatedUnion('type', [
    z
      .strictObject({ ...common, type: z.literal('boolean'), default: z.boolean() })
      .describe('A checkbox.'),
    z
      .strictObject({
        ...common,
        type: z.literal('integer'),
        default: z.int(),
        minimum: z.int().optional(),
        maximum: z.int().optional(),
      })
      .describe('A whole number.'),
    z
      .strictObject({
        ...common,
        type: z.literal('number'),
        default: z.number(),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
      })
      .describe('A number.'),
    z
      .strictObject({
        ...common,
        type: z.literal('string'),
        default: z.string(),
        enum: z.array(z.string()).min(1).optional().describe('Offers these values to pick from.'),
        maxLength: z.int().min(1).optional(),
      })
      .describe('Text, or a choice with `enum`.'),
  ])
  .meta({ title: 'Setting' });
export type Setting = z.infer<typeof settingSchema>;

/** `settings.json`: options by name (checked by the validator). */
export const settingsSchema = z
  .object(schemaUrl)
  .catchall(settingSchema)
  .describe(
    'Options each table sets on its settings page, each under an identifier such as `startingHp`. Formulas read them as `@settings.<name>`.',
  );
export type Settings = z.infer<typeof settingsSchema>;
