import { z } from 'zod';

import { formula, identifier, name, schemaUrl, text } from './common.js';

export const FIELD_TYPES = ['string', 'integer', 'number', 'boolean', 'object', 'array'] as const;
export const FIELD_KINDS = ['longText', 'collection', 'richText', 'image'] as const;

/**
 * Keywords of full JSON Schema that the subset leaves out (specs §8.4); the validator names
 * them instead of reporting an unknown key.
 */
export const UNSUPPORTED_KEYWORDS = [
  '$ref',
  'allOf',
  'oneOf',
  'anyOf',
  'not',
  'patternProperties',
  'if',
  'then',
  'else',
] as const;

/** One field of an actor or item schema: the JSON Schema subset of specs §8.4. */
export interface FieldSchema {
  type: (typeof FIELD_TYPES)[number];
  description?: string | undefined;
  default?: unknown;
  enum?: (string | number)[] | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  required?: string[] | undefined;
  properties?: Record<string, FieldSchema> | undefined;
  items?: FieldSchema | undefined;
  'x-kind'?: (typeof FIELD_KINDS)[number] | undefined;
  'x-counter'?: boolean | undefined;
  'x-layer'?: 'secret' | undefined;
}

export const fieldSchema: z.ZodType<FieldSchema> = z.lazy(() =>
  z
    .strictObject({
      type: z.enum(FIELD_TYPES),
      description: z.string().max(2000).optional(),
      default: z
        .unknown()
        .optional()
        .describe('The value new entities start with; it must fit the field.'),
      enum: z
        .array(z.union([z.string(), z.number()]))
        .min(1)
        .optional()
        .describe('The allowed values; a `select` input offers them.'),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      minLength: z.int().min(0).optional(),
      maxLength: z.int().min(0).optional(),
      required: z.array(identifier).optional(),
      /** Field names are identifiers, so formulas can reference them. */
      properties: z
        .record(identifier, fieldSchema)
        .optional()
        .describe('The fields of an `object`, by name.'),
      items: fieldSchema
        .optional()
        .describe('The rows of an `array`; an `object` for a collection.'),
      'x-kind': z
        .enum(FIELD_KINDS)
        .optional()
        .describe(
          'How the core stores and edits the field: `longText` and `richText` are shared text that several people edit at once, `collection` is a list of rows with ids, `image` is a picture URL.',
        ),
      'x-counter': z
        .boolean()
        .optional()
        .describe(
          'A number changed in steps; steps from several people at once add up instead of overwriting each other.',
        ),
      'x-layer': z
        .literal('secret')
        .optional()
        .describe('Only the GM and assistants see the field; it never reaches players.'),
    })
    .meta({ title: 'Field' }),
);

/** The data of a type: always an object at the top. */
const typeData = z
  .strictObject({
    type: z.literal('object'),
    properties: z.record(identifier, fieldSchema),
    required: z.array(identifier).optional(),
    description: z.string().max(2000).optional(),
  })
  .meta({ title: 'Data schema' });

const typeBase = {
  ...schemaUrl,
  label: text.describe('The type name players see; a lang key or literal text.'),
  /** A file in `sheets/`, without `.json`. */
  sheet: name.describe('The sheet in `sheets/`, without `.json`.'),
  schema: typeData.describe("The entity's data: an object whose properties are fields."),
  /** Values computed from the data and never stored (specs §8.4). */
  derived: z
    .record(identifier, formula)
    .optional()
    .describe(
      'Values computed from the data and never stored, by name. Formulas read them as `@derived.<name>`.',
    ),
};

/** `types/actors/<type>.json` (specs §8.4). */
export const actorTypeSchema = z
  .strictObject({
    ...typeBase,
    /** Who may create actors of this type (FR-ENT-01). */
    controlledBy: z
      .enum(['player', 'gm'])
      .describe('Who may create actors of the type: players too, or only the GM.'),
  })
  .describe('An actor type, such as a character or an NPC.');
export type ActorType = z.infer<typeof actorTypeSchema>;

/** `types/items/<type>.json` (specs §8.4). */
export const itemTypeSchema = z
  .strictObject(typeBase)
  .describe('An item type, such as a weapon or a spell.');
export type ItemType = z.infer<typeof itemTypeSchema>;
