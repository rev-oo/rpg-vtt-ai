import { z } from 'zod';

import { name, schemaUrl, text } from './common.js';

/** The most entries one pack may hold. */
export const MAX_PACK_ENTRIES = 1000;

/** One compendium entry: an actor or item of the plugin's own types (FR-PLUGIN-09, ADR-051, ADR-060). */
export const packEntrySchema = z
  .strictObject({
    id: name.describe(
      'Stable within the pack and across versions: copies remember it, so the compendium marks entries a table already has.',
    ),
    kind: z.enum(['actor', 'item']).describe('An actor or an item.'),
    type: name.describe('An actor or item type of this plugin.'),
    name: z.string().trim().min(1).max(100).describe('The name it gets in the table.'),
    data: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Its data, checked against the type’s schema; what it leaves out takes the defaults. Collections are lists of rows, as in defaults.',
      ),
  })
  .describe('A compendium entry.');
export type PackEntry = z.infer<typeof packEntrySchema>;

/** `packs/<name>.json`: entries members browse and copy into a table (FR-PLUGIN-09). */
export const packSchema = z
  .strictObject({
    ...schemaUrl,
    label: text.describe('The pack’s name in the compendium; a lang key or text.'),
    entries: z.array(packEntrySchema).max(MAX_PACK_ENTRIES),
  })
  .describe('A compendium pack: actors and items members browse and copy into a table.');
export type Pack = z.infer<typeof packSchema>;
