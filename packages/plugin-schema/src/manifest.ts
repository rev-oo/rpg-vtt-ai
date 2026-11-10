import { z } from 'zod';

import { PLUGIN_KINDS } from '@vtt/shared/api';

import { LOCALE, PLUGIN_ID, SEMVER, schemaUrl, text } from './common.js';

const locale = z.string().regex(LOCALE).meta({ title: 'Locale' });

/** The name of an overlay or panel, as `code/client` exports it. */
const frameName = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
  .meta({ title: 'Frame name' });

/** A module's overlays and panels (ADR-077), declared so the app knows them before any code runs. */
export const moduleFramesSchema = z
  .strictObject({
    overlays: z
      .record(
        frameName,
        z.strictObject({
          interactive: z
            .boolean()
            .optional()
            .describe('True when the overlay takes the pointer; otherwise clicks pass through it.'),
        }),
      )
      .optional()
      .describe('Overlays over the table page, by the name `code/client` exports them under.'),
    panels: z
      .record(
        frameName,
        z.strictObject({
          title: text.describe("The panel's title: a lang key or literal text."),
        }),
      )
      .optional()
      .describe('Panels in the table workspace, by the name `code/client` exports them under.'),
  })
  .meta({ title: 'Module frames' });
export type ModuleFrames = z.infer<typeof moduleFramesSchema>;

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
    /** A game system, or a module that extends any table (FR-PLUGIN-16, ADR-075). */
    kind: z
      .enum(PLUGIN_KINDS)
      .describe(
        '`system` for a game system, which a table is created with; `module` for an add-on that GMs add to any table, whatever its system (themes, overlays, panels).',
      ),
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
    /** Credit the plugin's content needs, such as CC-BY's (T-1614). */
    attribution: z
      .strictObject({
        text: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .describe('The credit, as it must read; shown as written, in every language.'),
        url: z
          .string()
          .max(500)
          .regex(/^https?:\/\/[^\s/?#]+[^\s]*$/)
          .optional()
          .describe('A web page for the source or its licence, linked from the credit.'),
      })
      .optional()
      .describe(
        "Credit for the plugin's content, such as a CC-BY licence asks for. Shown on the Plugins page and with each compendium entry from its packs.",
      ),
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
    /** Declared, so the app needs no probe frame to list them (T-1612). */
    frames: moduleFramesSchema
      .optional()
      .describe(
        "A module's overlays and panels. Each must be exported by `code/client` under the same name; only modules with code have them.",
      ),
  })
  .describe('The plugin manifest. Every plugin has one, at the root of its folder.');
export type Manifest = z.infer<typeof manifestSchema>;
