import type { FieldSchema, PluginDefinition } from '@vtt/plugin-schema';

export interface EntityType {
  schema: FieldSchema;
  derived?: Record<string, string> | undefined;
  sheet: string;
}

/** The plugin's declaration of an actor or item type, if it has one. */
export function entityType(
  definition: PluginDefinition,
  kind: 'actor' | 'item',
  name: string,
): EntityType | undefined {
  const types: Record<string, EntityType> =
    kind === 'actor' ? definition.actorTypes : definition.itemTypes;
  return Object.hasOwn(types, name) ? types[name] : undefined;
}
