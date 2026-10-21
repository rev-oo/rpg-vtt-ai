import { z } from 'zod';

import { formula, IDENTIFIER, identifier, name, schemaUrl, text } from './common.js';

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
  z.strictObject({
    type: z.enum(FIELD_TYPES),
    description: z.string().max(2000).optional(),
    default: z.unknown().optional(),
    enum: z
      .array(z.union([z.string(), z.number()]))
      .min(1)
      .optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    minLength: z.int().min(0).optional(),
    maxLength: z.int().min(0).optional(),
    required: z.array(identifier).optional(),
    /** Field names are identifiers, so formulas can reference them. */
    properties: z.record(z.string().regex(IDENTIFIER), fieldSchema).optional(),
    items: fieldSchema.optional(),
    'x-kind': z.enum(FIELD_KINDS).optional(),
    'x-counter': z.boolean().optional(),
    'x-layer': z.literal('secret').optional(),
  }),
);

/** The data of a type: always an object at the top. */
const typeData = z.strictObject({
  type: z.literal('object'),
  properties: z.record(z.string().regex(IDENTIFIER), fieldSchema),
  required: z.array(identifier).optional(),
  description: z.string().max(2000).optional(),
});

const typeBase = {
  ...schemaUrl,
  label: text,
  /** A file in `sheets/`, without `.json`. */
  sheet: name,
  schema: typeData,
  /** Values computed from the data and never stored (specs §8.4). */
  derived: z.record(z.string().regex(IDENTIFIER), formula).optional(),
};

/** `types/actors/<type>.json` (specs §8.4). */
export const actorTypeSchema = z.strictObject({
  ...typeBase,
  /** Who may create actors of this type (FR-ENT-01). */
  controlledBy: z.enum(['player', 'gm']),
});
export type ActorType = z.infer<typeof actorTypeSchema>;

/** `types/items/<type>.json` (specs §8.4). */
export const itemTypeSchema = z.strictObject(typeBase);
export type ItemType = z.infer<typeof itemTypeSchema>;
