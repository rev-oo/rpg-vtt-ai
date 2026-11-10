import { z } from 'zod';

import { schemaUrl, text } from './common.js';

/** Who sets a setting, and where its value is kept (ADR-075). */
export const SETTING_SCOPES = ['instance', 'table', 'user'] as const;
export type SettingScope = (typeof SETTING_SCOPES)[number];

const common = {
  label: text.describe('A lang key or literal text.'),
  description: text.optional().describe('Help shown under the option.'),
  scope: z
    .enum(SETTING_SCOPES)
    .optional()
    .describe(
      'Who sets the option: `table` (the default), the GM in table settings; `instance`, admins on the Plugins page, for every table; `user`, each member for themselves. Formulas read only `table` options.',
    ),
};

/** One option of a plugin, set per table, per instance or per user (specs §8.12, ADR-075). */
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
        enumLabels: z
          .record(z.string(), text)
          .optional()
          .describe(
            'What the form shows for each `enum` value: a lang key or text, by value. The stored value stays the plain value.',
          ),
        format: z
          .literal('colour')
          .optional()
          .describe(
            'A colour, written `#rrggbb` and picked with a colour picker; it cannot have an `enum`.',
          ),
        maxLength: z.int().min(1).optional(),
      })
      .describe('Text, a choice with `enum`, or a colour with `format`.'),
  ])
  .meta({ title: 'Setting' });
export type Setting = z.infer<typeof settingSchema>;

/** A colour as a `colour` setting stores it: `#rrggbb` (T-1611). */
export const COLOUR = /^#[0-9a-f]{6}$/i;

/** A setting's scope; `table` when it declares none. */
export const settingScope = (setting: Pick<Setting, 'scope'>): SettingScope =>
  setting.scope ?? 'table';

/** The settings of one scope, by name. */
export function settingsOfScope(
  settings: Readonly<Record<string, Setting>>,
  scope: SettingScope,
): Record<string, Setting> {
  return Object.fromEntries(
    Object.entries(settings).filter(([, setting]) => settingScope(setting) === scope),
  );
}

/** `settings.json`: options by name (checked by the validator). */
export const settingsSchema = z
  .object(schemaUrl)
  .catchall(settingSchema)
  .describe(
    'Options under identifiers such as `startingHp`, set per table (the default), per instance or per user. Formulas read table options as `@settings.<name>`.',
  );
export type Settings = z.infer<typeof settingsSchema>;
