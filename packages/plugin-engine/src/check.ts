import type { FieldSchema } from '@vtt/plugin-schema';
import type { DataIssueReason } from '@vtt/shared/api';

function lengthIssue(field: FieldSchema, length: number): DataIssueReason | undefined {
  if (field.minLength !== undefined && length < field.minLength) return 'minLength';
  if (field.maxLength !== undefined && length > field.maxLength) return 'maxLength';
  return undefined;
}

function rangeIssue(field: FieldSchema, value: number): DataIssueReason | undefined {
  if (field.minimum !== undefined && value < field.minimum) return 'minimum';
  if (field.maximum !== undefined && value > field.maximum) return 'maximum';
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
      return typeof value === 'string' ? lengthIssue(field, value.length) : 'type';
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

/** `value` moved by `delta` and kept within the field's bounds (FR-SHEET-08, 09). */
export function clampValue(field: FieldSchema, value: number): number {
  const rounded = field.type === 'integer' ? Math.round(value) : value;
  return Math.min(field.maximum ?? Infinity, Math.max(field.minimum ?? -Infinity, rounded));
}
