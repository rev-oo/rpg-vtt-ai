import { z } from 'zod';

import { cardSchema } from './cards.js';
import { combatSchema } from './combat.js';
import { diceSchema } from './dice.js';
import { langSchema } from './lang.js';
import { manifestSchema } from './manifest.js';
import { rollsSchema } from './rolls.js';
import { settingsSchema } from './settings.js';
import { sheetSchema } from './sheet.js';
import { actorTypeSchema, itemTypeSchema } from './types.js';

/** Every plugin file kind, with the folder pattern it lives under (specs §8.2). */
export const PLUGIN_FILES = {
  plugin: { schema: manifestSchema, title: 'Plugin manifest (plugin.json)' },
  'actor-type': { schema: actorTypeSchema, title: 'Actor type (types/actors/<type>.json)' },
  'item-type': { schema: itemTypeSchema, title: 'Item type (types/items/<type>.json)' },
  sheet: { schema: sheetSchema, title: 'Sheet layout (sheets/<name>.json)' },
  rolls: { schema: rollsSchema, title: 'Roll recipes (rolls.json)' },
  dice: { schema: diceSchema, title: 'Custom dice (dice.json)' },
  card: { schema: cardSchema, title: 'Chat card (cards/<name>.json)' },
  settings: { schema: settingsSchema, title: 'Table settings (settings.json)' },
  combat: { schema: combatSchema, title: 'Combat (combat.json)' },
  lang: { schema: langSchema, title: 'Translations (lang/<locale>.json)' },
} as const;
export type PluginFileKind = keyof typeof PLUGIN_FILES;

const FILE_PATTERNS: readonly (readonly [RegExp, PluginFileKind])[] = [
  [/^plugin\.json$/, 'plugin'],
  [/^types\/actors\/[^/]+\.json$/, 'actor-type'],
  [/^types\/items\/[^/]+\.json$/, 'item-type'],
  [/^sheets\/[^/]+\.json$/, 'sheet'],
  [/^rolls\.json$/, 'rolls'],
  [/^dice\.json$/, 'dice'],
  [/^cards\/[^/]+\.json$/, 'card'],
  [/^settings\.json$/, 'settings'],
  [/^combat\.json$/, 'combat'],
  [/^lang\/[^/]+\.json$/, 'lang'],
];

/** Which kind a file is, from its path inside the plugin folder (`/`-separated). */
export function pluginFileKind(path: string): PluginFileKind | undefined {
  return FILE_PATTERNS.find(([pattern]) => pattern.test(path))?.[1];
}

/**
 * The JSON Schema of one file kind, for editors (`$schema`) and other tools. They are
 * committed under `schemas/` (`<kind>.schema.json`).
 */
export function pluginJsonSchema(kind: PluginFileKind): Record<string, unknown> {
  const { schema, title } = PLUGIN_FILES[kind];
  return { title, ...z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) };
}
