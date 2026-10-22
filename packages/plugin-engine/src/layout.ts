import type { FieldSchema, PluginDefinition } from '@vtt/plugin-schema';

import { isCollection } from './data.js';

/**
 * How one field lives in an actor's live document (specs §9.2), without depending on Yjs:
 * - `value`: a plain JSON value in its parent map (scalars, images, plain arrays);
 * - `text`: a `Y.Text` (`longText`), or a `Y.XmlFragment` of the editor's blocks (`richText`);
 * - `map`: a nested `Y.Map` of fields;
 * - `collection`: a `Y.Map` keyed by row id, each row a `Y.Map` with a `sort` key (§9.4).
 */
export type FieldLayout =
  | { kind: 'value'; type: FieldSchema['type'] }
  | { kind: 'text'; rich: boolean }
  | { kind: 'map'; fields: Record<string, FieldLayout> }
  | { kind: 'collection'; row: Record<string, FieldLayout> };

/**
 * The `data` maps of an actor's documents (§9.1): `main` for everyone with access, `secret`
 * for GMs and assistants. `secret` is undefined when no field has `x-layer: "secret"`.
 */
export interface DocumentLayout {
  main: Record<string, FieldLayout>;
  secret: Record<string, FieldLayout> | undefined;
}

type Fields = Record<string, FieldLayout>;

function layoutOf(
  field: FieldSchema,
  fields: (schema: FieldSchema | undefined) => Fields,
): FieldLayout {
  if (isCollection(field)) return { kind: 'collection', row: fields(field.items) };
  if (field.type === 'object') return { kind: 'map', fields: fields(field) };
  if (field['x-kind'] === 'longText' || field['x-kind'] === 'richText') {
    return { kind: 'text', rich: field['x-kind'] === 'richText' };
  }
  return { kind: 'value', type: field.type };
}

/** How a field lives in a document, with everything under it. */
export function fieldLayout(field: FieldSchema): FieldLayout {
  return layoutOf(field, (child) =>
    Object.fromEntries(
      Object.entries(child?.properties ?? {}).map(([name, inner]) => [name, fieldLayout(inner)]),
    ),
  );
}

/** A map or collection that still holds fields after splitting. */
const holdsFields = (layout: FieldLayout): boolean =>
  (layout.kind === 'map' && Object.keys(layout.fields).length > 0) ||
  (layout.kind === 'collection' && Object.keys(layout.row).length > 0);

/**
 * Splits a type's schema into its documents. A secret field goes to the secret document at
 * the same path, with everything under it; maps and collection rows that hold secret fields
 * appear in both documents, each with its own fields, and collection rows share their ids.
 */
export function documentLayout(schema: FieldSchema): DocumentLayout {
  // `main` skips secret fields, `secret` keeps only them and their parents, `all` keeps all.
  const split = (parent: FieldSchema | undefined, mode: 'main' | 'secret' | 'all'): Fields => {
    const fields: Fields = {};
    for (const [name, field] of Object.entries(parent?.properties ?? {})) {
      const isSecret = field['x-layer'] === 'secret';
      let layout: FieldLayout | undefined;
      if (mode === 'all' || (mode === 'secret' && isSecret)) {
        layout = layoutOf(field, (child) => split(child, 'all'));
      } else if (mode === 'main' && !isSecret) {
        layout = layoutOf(field, (child) => split(child, 'main'));
      } else if (mode === 'secret') {
        const inner = layoutOf(field, (child) => split(child, 'secret'));
        if (holdsFields(inner)) layout = inner;
      }
      if (layout) fields[name] = layout;
    }
    return fields;
  };
  const secret = split(schema, 'secret');
  return {
    main: split(schema, 'main'),
    secret: Object.keys(secret).length > 0 ? secret : undefined,
  };
}

/**
 * A type's schema without its secret fields (specs §9.1): what a player's view of the type
 * declares. Formulas run against it cannot reach secret fields, not even their defaults.
 */
export function withoutSecrets(schema: FieldSchema): FieldSchema {
  const { properties, items, ...rest } = schema;
  const kept =
    properties &&
    Object.fromEntries(
      Object.entries(properties)
        .filter(([, field]) => field['x-layer'] !== 'secret')
        .map(([name, field]) => [name, withoutSecrets(field)]),
    );
  return {
    ...rest,
    ...(kept && { properties: kept }),
    ...(items && { items: withoutSecrets(items) }),
  };
}

/** A plugin as a player sees it: every actor and item type {@link withoutSecrets}. */
export function playerDefinition(plugin: PluginDefinition): PluginDefinition {
  const strip = <T extends { schema: FieldSchema }>(types: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(types).map(([name, type]) => [
        name,
        { ...type, schema: withoutSecrets(type.schema) },
      ]),
    );
  return { ...plugin, actorTypes: strip(plugin.actorTypes), itemTypes: strip(plugin.itemTypes) };
}

/**
 * The part of a type's schema that holds secret fields (specs §9.1): every secret field with
 * everything under it, and the objects and collections on the way to one. `undefined` when
 * the type has no secret fields.
 */
export function onlySecrets(schema: FieldSchema): FieldSchema | undefined {
  if (!schema.properties && !schema.items) return undefined;
  const kept: Record<string, FieldSchema> = {};
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    if (field['x-layer'] === 'secret') kept[name] = field;
    else if (field.items) {
      const items = onlySecrets(field.items);
      if (items) kept[name] = { ...field, items, default: undefined };
    } else {
      const inner = onlySecrets(field);
      if (inner) kept[name] = inner;
    }
  }
  if (Object.keys(kept).length === 0) return undefined;
  return { ...schema, properties: kept, required: undefined, default: undefined };
}

/** The schema of each of a type's documents (specs §9.1). */
export function layerSchemas(schema: FieldSchema): {
  main: FieldSchema;
  secret: FieldSchema | undefined;
} {
  return { main: withoutSecrets(schema), secret: onlySecrets(schema) };
}
