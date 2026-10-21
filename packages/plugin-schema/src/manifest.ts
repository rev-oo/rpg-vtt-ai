import { z } from 'zod';

import { LOCALE, PLUGIN_ID, SEMVER, schemaUrl } from './common.js';

const locale = z.string().regex(LOCALE);

/** `plugin.json` (specs §8.3). */
export const manifestSchema = z.strictObject({
  ...schemaUrl,
  id: z.string().regex(PLUGIN_ID),
  name: z.string().min(1).max(100),
  version: z.string().regex(SEMVER),
  /** Only game systems exist in the MVP. */
  kind: z.literal('system'),
  /** The core versions this plugin works with, as a semver range (FR-PLUGIN-03). */
  coreApi: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  author: z.string().max(200).optional(),
  license: z.string().max(100).optional(),
  /** Must match whether a `code/` folder exists (FR-PLUGIN-06). */
  hasCode: z.boolean(),
  locales: z.array(locale).min(1).optional(),
  defaultLocale: locale.optional(),
});
export type Manifest = z.infer<typeof manifestSchema>;
