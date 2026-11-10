import { evaluate, FormulaError, isDiceText, type FormulaFunction } from '@vtt/formula';
import type { FieldSchema } from '@vtt/plugin-schema';
import type { DataIssueReason } from '@vtt/shared/api';

function lengthIssue(field: FieldSchema, length: number): DataIssueReason | undefined {
  if (field.minLength !== undefined && length < field.minLength) return 'minLength';
  if (field.maxLength !== undefined && length > field.maxLength) return 'maxLength';
  return undefined;
}

/** A number field's bounds, worked out. */
export interface Bounds {
  minimum?: number;
  maximum?: number;
}

/**
 * A field's bounds that are numbers. A counter's formula bounds (T-1610) need the entity, so
 * checks without it leave them out; `fieldBounds` works them out.
 */
export function staticBounds(field: FieldSchema): Bounds {
  return {
    ...(typeof field.minimum === 'number' && { minimum: field.minimum }),
    ...(typeof field.maximum === 'number' && { maximum: field.maximum }),
  };
}

/**
 * A field's bounds with its formulas worked out against `scope`: the entity's data, `@derived`,
 * `@items` and `@settings` (T-1610). A formula that fails, or gives no number, bounds nothing.
 */
export function fieldBounds(
  field: FieldSchema,
  scope: Readonly<Record<string, unknown>>,
  functions: Readonly<Record<string, FormulaFunction>> = {},
): Bounds {
  const bound = (source: number | string | undefined): number | undefined => {
    if (typeof source !== 'string') return source;
    try {
      const value = evaluate(source, { data: scope, functions });
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    } catch (error) {
      if (error instanceof FormulaError) return undefined;
      throw error;
    }
  };
  const minimum = bound(field.minimum);
  const maximum = bound(field.maximum);
  return {
    ...(minimum !== undefined && { minimum }),
    ...(maximum !== undefined && { maximum }),
  };
}

function rangeIssue(field: FieldSchema, value: number): DataIssueReason | undefined {
  const { minimum, maximum } = staticBounds(field);
  if (minimum !== undefined && value < minimum) return 'minimum';
  if (maximum !== undefined && value > maximum) return 'maximum';
  return undefined;
}

/**
 * Why a plain JSON value does not fit its field (specs §8.4), or `undefined` when it does.
 * Objects and collections live as maps in documents; here they are checked by type only.
 */
export function valueIssue(field: FieldSchema, value: unknown): DataIssueReason | undefined {
  if (field.enum && !field.enum.includes(value as string | number)) return 'enum';
  switch (field.type) {
    case 'string':
      if (typeof value !== 'string') return 'type';
      if (field.format === 'dice' && !isDiceText(value)) return 'format';
      return lengthIssue(field, value.length);
    case 'integer':
      return Number.isSafeInteger(value) ? rangeIssue(field, value as number) : 'type';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? rangeIssue(field, value)
        : 'type';
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'type';
    case 'array': {
      if (!Array.isArray(value)) return 'type';
      const items = field.items;
      const inner = items && value.some((item) => valueIssue(items, item) !== undefined);
      return inner ? 'type' : lengthIssue(field, value.length);
    }
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? undefined
        : 'type';
  }
}

/** `value` kept within the field's bounds (FR-SHEET-08, 09), its static ones by default. */
export function clampValue(
  field: FieldSchema,
  value: number,
  { minimum, maximum }: Bounds = staticBounds(field),
): number {
  const rounded = field.type === 'integer' ? Math.round(value) : value;
  return Math.min(maximum ?? Infinity, Math.max(minimum ?? -Infinity, rounded));
}
