import { z } from 'zod';

import { LOCALE, PLUGIN_ID, SEMVER, schemaUrl } from './common.js';

const locale = z.string().regex(LOCALE).meta({ title: 'Locale' });

/** `plugin.json` (specs §8.3). */
export const manifestSchema = z
  .strictObject({
    ...schemaUrl,
    id: z
      .string()
      .regex(PLUGIN_ID)
      .meta({ title: 'Plugin id' })
      .describe(
        'Unique on the instance, and the name of the plugin folder. Do not change it once tables use the plugin.',
      ),
    name: z.string().min(1).max(100).describe('The name admins and GMs see.'),
    version: z
      .string()
      .regex(SEMVER)
      .meta({ title: 'Version' })
      .describe('The plugin version, such as `1.0.0`.'),
    /** Only game systems exist in the MVP. */
    kind: z.literal('system').describe('Only game systems exist for now.'),
    /** The core versions this plugin works with, as a semver range (FR-PLUGIN-03). */
    coreApi: z
      .string()
      .min(1)
      .max(100)
      .describe(
        'The core API versions the plugin works with, as a semver range such as `^0.1.0`. A server outside the range lists the plugin as unusable.',
      ),
    description: z.string().max(2000).optional().describe('Shown on the plugin admin page.'),
    author: z.string().max(200).optional(),
    license: z.string().max(100).optional(),
    /** Must match whether a `code/` folder exists (FR-PLUGIN-06). */
    hasCode: z
      .boolean()
      .describe(
        'True exactly when the plugin has a `code/` folder. Admins must acknowledge code before enabling the plugin.',
      ),
    locales: z
      .array(locale)
      .min(1)
      .optional()
      .describe('The languages in `lang/`. Each needs its `lang/<locale>.json`.'),
    defaultLocale: locale
      .optional()
      .describe(
        "The language whose text shows when the viewer's language lacks a key; one of `locales`. Defaults to the first of `locales`, then `en`.",
      ),
  })
  .describe('The plugin manifest. Every plugin has one, at the root of its folder.');
export type Manifest = z.infer<typeof manifestSchema>;
