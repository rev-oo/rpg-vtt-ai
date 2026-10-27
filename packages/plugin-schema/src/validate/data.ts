import type { FieldSchema } from '../types.js';

import { RESERVED_ROOTS } from './formulas.js';
import type { JsonPath, PluginIssue } from './issues.js';

type Add = (code: PluginIssue['code'], path: JsonPath, params?: PluginIssue['params']) => void;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const TYPE_CHECKS: Record<FieldSchema['type'], (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  integer: (value) => Number.isInteger(value),
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  boolean: (value) => typeof value === 'boolean',
  object: isRecord,
  array: Array.isArray,
};

/** Why `value` cannot be the default of `field`, if it cannot. */
function defaultProblem(field: FieldSchema, value: unknown): PluginIssue['params'] | undefined {
  if (!TYPE_CHECKS[field.type](value)) return { reason: 'type', expected: field.type };
  if (field.enum && !field.enum.some((option) => option === value)) {
    return {
      reason: 'enum',
      values: field.enum.map((option) => JSON.stringify(option)).join(', '),
    };
  }
  const size =
    typeof value === 'string' ? value.length : typeof value === 'number' ? value : undefined;
  const [low, high] =
    typeof value === 'string' ? [field.minLength, field.maxLength] : [field.minimum, field.maximum];
  const origin = typeof value === 'string' ? 'string' : 'number';
  if (size !== undefined && low !== undefined && size < low)
    return { reason: 'too_small', origin, minimum: low };
  if (size !== undefined && high !== undefined && size > high)
    return { reason: 'too_big', origin, maximum: high };
  return undefined;
}

function checkField(field: FieldSchema, path: JsonPath, add: Add): void {
  if (field.default !== undefined) {
    const problem = defaultProblem(field, field.default);
    if (problem) add('invalid_default', [...path, 'default'], problem);
  }
  const kind = field['x-kind'];
  const kindFits =
    kind === undefined ||
    (kind === 'collection'
      ? field.type === 'array' && field.items?.type === 'object'
      : field.type === 'string');
  if (!kindFits)
    add('invalid_annotation', [...path, 'x-kind'], {
      key: `x-kind "${kind}"`,
      type: field.type,
    });
  if (field['x-counter'] === true && field.type !== 'integer' && field.type !== 'number') {
    add('invalid_annotation', [...path, 'x-counter'], { key: 'x-counter', type: field.type });
  }
  for (const [name, child] of Object.entries(field.properties ?? {})) {
    checkField(child, [...path, 'properties', name], add);
  }
  if (field.items) checkField(field.items, [...path, 'items'], add);
}

/**
 * Checks a type's data schema beyond its shape: defaults fit their fields, annotations fit
 * their types, and no top-level field takes a name formulas reserve.
 */
export function checkDataSchema(schema: FieldSchema, add: Add): void {
  for (const name of Object.keys(schema.properties ?? {})) {
    if ((RESERVED_ROOTS as readonly string[]).includes(name)) {
      add('reserved_name', ['schema', 'properties', name], { name });
    }
  }
  checkField(schema, ['schema'], add);
}

/**
 * Checks entity data written by hand, such as a pack entry's, against its type's schema
 * (ADR-051): types, bounds and enums like defaults, unknown keys, and collections given as
 * lists of rows. What it leaves out takes the defaults, so nothing is required.
 */
export function checkData(field: FieldSchema, value: unknown, path: JsonPath, add: Add): void {
  if (field.type === 'object') {
    if (!isRecord(value)) {
      add('invalid_value', path, { reason: 'type', expected: 'object' });
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const declared = field.properties && Object.hasOwn(field.properties, key);
      const property = declared ? field.properties?.[key] : undefined;
      if (!property) add('unknown_key', [...path, key], { key });
      else checkData(property, child, [...path, key], add);
    }
    return;
  }
  if (field.type === 'array') {
    if (!Array.isArray(value)) {
      add('invalid_value', path, { reason: 'type', expected: 'array' });
      return;
    }
    const { items } = field;
    if (items) {
      value.forEach((item: unknown, index) => {
        checkData(items, item, [...path, index], add);
      });
    }
    return;
  }
  const problem = defaultProblem(field, value);
  if (problem) add('invalid_value', path, problem);
}
