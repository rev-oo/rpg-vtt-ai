import { z } from 'zod';

import { cardSchema } from './cards.js';
import { combatSchema } from './combat.js';
import { dieSchema } from './dice.js';
import { langSchema } from './lang.js';
import { manifestSchema } from './manifest.js';
import { packSchema } from './packs.js';
import { recipeSchema } from './rolls.js';
import { settingSchema } from './settings.js';
import { sheetSchema } from './sheet.js';
import { actorTypeSchema, itemTypeSchema } from './types.js';
import type { PluginDefinition } from './validate/validate.js';

/**
 * A validated plugin as the server sends it to the web app (`GET /systems/:id`, ADR-025).
 * It checks the shape only; the cross-file rules ran on the server when it scanned.
 */
export const pluginDefinitionSchema: z.ZodType<PluginDefinition> = z.object({
  manifest: manifestSchema,
  actorTypes: z.record(z.string(), actorTypeSchema),
  itemTypes: z.record(z.string(), itemTypeSchema),
  sheets: z.record(z.string(), sheetSchema),
  rolls: z.record(z.string(), recipeSchema),
  dice: z.record(z.string(), dieSchema),
  cards: z.record(z.string(), cardSchema),
  settings: z.record(z.string(), settingSchema),
  combat: combatSchema.optional(),
  packs: z.record(z.string(), packSchema).optional(),
  lang: z.record(z.string(), langSchema),
  styles: z.array(z.string()),
});
