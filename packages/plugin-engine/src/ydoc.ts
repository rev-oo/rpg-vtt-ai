import * as Y from 'yjs';

import type { FieldSchema } from '@vtt/plugin-schema';
import type { DataIssue, DataIssueReason, FieldPath } from '@vtt/shared/api';

import { clampValue, valueIssue } from './check.js';
import { defaultValue, isCollection } from './data.js';
import { fieldLayout, type DocumentLayout, type FieldLayout } from './layout.js';

/** An entity's data, or one layer of it, as JSON (the stored projection, specs §9.6). */
export type LayerData = Record<string, unknown>;

type Fields = Record<string, FieldLayout>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The Yjs value of one field (specs §9.2). Values that do not fit their layout, such as a
 * number where text is expected, stay plain values: repairing them is the store's job (§9.7).
 */
function toYjs(layout: FieldLayout | undefined, value: unknown): unknown {
  if (layout?.kind === 'text' && typeof value === 'string') return new Y.Text(value);
  if (layout?.kind === 'map' && isRecord(value)) return toYMap(layout.fields, value);
  if (layout?.kind === 'collection' && isRecord(value)) {
    const rows = Object.entries(value).map(([id, row]): [string, unknown] => [
      id,
      isRecord(row) ? toYMap(layout.row, row) : row,
    ]);
    return new Y.Map(rows);
  }
  return value;
}

function toYMap(fields: Fields, data: LayerData): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  writeLayer(map, fields, data);
  return map;
}

/**
 * Writes JSON data into a document's `data` map (specs §9.2): text fields become `Y.Text`,
 * objects nested `Y.Map`s and collections `Y.Map`s of rows keyed by id. Keys the layout does
 * not know are kept as plain values.
 */
export function writeLayer(map: Y.Map<unknown>, fields: Fields, data: LayerData): void {
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) map.set(key, toYjs(fields[key], value));
  }
}

function fromYjs(layout: FieldLayout | undefined, value: unknown): unknown {
  if (value instanceof Y.Text) return value.toJSON();
  if (value instanceof Y.Map) {
    if (layout?.kind === 'collection') {
      return Object.fromEntries(
        [...value.entries()].map(([id, row]) => [
          id,
          row instanceof Y.Map ? readLayer(row, layout.row) : fromYjs(undefined, row),
        ]),
      );
    }
    return readLayer(value, layout?.kind === 'map' ? layout.fields : {});
  }
  if (value instanceof Y.AbstractType) return value.toJSON() as unknown;
  return value;
}

/**
 * Creates the shared types every field needs that `map` lacks: the maps of objects and
 * collections and the texts of `longText` and `richText` fields, at every depth outside
 * collection rows. Two clients creating the same missing type at once would each make their
 * own, and one of them, with what was written into it, would be lost; so the server creates
 * them when it loads a document, before clients edit it (specs §9.4).
 */
export function ensureContainers(map: Y.Map<unknown>, fields: Fields): void {
  for (const [key, layout] of Object.entries(fields)) {
    if (layout.kind === 'value') continue;
    let child: unknown = map.get(key);
    if (child === undefined) {
      child = layout.kind === 'text' ? new Y.Text() : new Y.Map<unknown>();
      map.set(key, child);
    }
    if (layout.kind === 'map' && child instanceof Y.Map) ensureContainers(child, layout.fields);
  }
}

/** Reads a document's `data` map back as JSON, the inverse of {@link writeLayer}. */
export function readLayer(map: Y.Map<unknown>, fields: Fields): LayerData {
  return Object.fromEntries(
    [...map.entries()].map(([key, value]) => [key, fromYjs(fields[key], value)]),
  );
}

/**
 * The part of `data` that belongs to `fields`. Keys that neither `fields` nor `other` (the
 * other layer at the same path) know go where `unknown` says, so no data is lost.
 */
function pick(
  fields: Fields | undefined,
  other: Fields | undefined,
  data: LayerData,
  unknown: boolean,
): LayerData {
  const picked: LayerData = {};
  for (const [key, value] of Object.entries(data)) {
    const layout = fields?.[key];
    const elsewhere = other?.[key];
    if (!layout) {
      if (unknown && !elsewhere) picked[key] = value;
      continue;
    }
    if (layout.kind === 'map' && isRecord(value)) {
      picked[key] = pick(
        layout.fields,
        elsewhere?.kind === 'map' ? elsewhere.fields : undefined,
        value,
        unknown,
      );
    } else if (layout.kind === 'collection' && isRecord(value)) {
      const otherRow = elsewhere?.kind === 'collection' ? elsewhere.row : undefined;
      picked[key] = Object.fromEntries(
        Object.entries(value).map(([id, row]) => [
          id,
          isRecord(row) ? pick(layout.row, otherRow, row, unknown) : row,
        ]),
      );
    } else {
      picked[key] = value;
    }
  }
  return picked;
}

/**
 * Splits an entity's data between its documents (specs §9.1). Data the layout does not
 * know, such as fields of an older plugin version, stays in `main`; `secret` is undefined
 * when the type has no secret fields.
 */
export function splitLayers(
  layout: DocumentLayout,
  data: LayerData,
): { main: LayerData; secret: LayerData | undefined } {
  return {
    main: pick(layout.main, layout.secret, data, true),
    secret: layout.secret && pick(layout.secret, layout.main, data, false),
  };
}

/** Joins the layers of an entity back into one JSON value, the inverse of {@link splitLayers}. */
export function mergeLayers(main: LayerData, secret: LayerData | undefined): LayerData {
  if (!secret) return main;
  const merged: LayerData = { ...main };
  for (const [key, value] of Object.entries(secret)) {
    const current = merged[key];
    merged[key] = isRecord(current) && isRecord(value) ? mergeLayers(current, value) : value;
  }
  return merged;
}

/** Whether a document value has the shape its field lives in (specs §9.2). */
function shapeIssue(field: FieldSchema, value: unknown): DataIssueReason | undefined {
  const layout = fieldLayout(field);
  if (layout.kind === 'map' || layout.kind === 'collection') {
    return value instanceof Y.Map ? undefined : 'type';
  }
  if (layout.kind === 'text') {
    return value instanceof Y.Text ? valueIssue(field, value.toJSON()) : 'type';
  }
  return value instanceof Y.AbstractType ? 'type' : valueIssue(field, value);
}

/**
 * Replaces what does not fit `schema` in a document's `data` map with the field's default
 * (specs §9.7), at every depth and in every collection row, and lists what it replaced.
 * Rows that are not maps are removed. Missing fields and keys the schema does not know are
 * left alone. Call it inside a transaction.
 */
export function repairLayer(
  map: Y.Map<unknown>,
  schema: FieldSchema,
  path: FieldPath = [],
): DataIssue[] {
  const issues: DataIssue[] = [];
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const value = map.get(name);
    if (value === undefined) continue;
    const at = [...path, name];
    const reason = shapeIssue(field, value);
    if (reason) {
      writeLayer(map, { [name]: fieldLayout(field) }, { [name]: defaultValue(field) });
      issues.push({ path: at, reason });
    } else if (value instanceof Y.Map && isCollection(field)) {
      for (const [id, row] of [...value.entries()]) {
        if (row instanceof Y.Map)
          issues.push(...repairLayer(row, field.items ?? field, [...at, id]));
        else {
          value.delete(id);
          issues.push({ path: [...at, id], reason: 'type' });
        }
      }
    } else if (value instanceof Y.Map) {
      issues.push(...repairLayer(value, field, at));
    }
  }
  return issues;
}

/** The field a path names under `schema`, with the map that holds it. */
function counterAt(
  map: Y.Map<unknown>,
  schema: FieldSchema,
  path: FieldPath,
): { parent: Y.Map<unknown>; key: string; field: FieldSchema } | undefined {
  const [key, ...rest] = path;
  const field =
    key !== undefined && Object.hasOwn(schema.properties ?? {}, key)
      ? schema.properties?.[key]
      : undefined;
  if (!key || !field) return undefined;
  if (rest.length === 0) return { parent: map, key, field };
  const child = map.get(key);
  if (!(child instanceof Y.Map)) return undefined;
  if (!isCollection(field)) return counterAt(child, field, rest);
  const [rowId, ...inRow] = rest;
  const row: unknown = rowId === undefined ? undefined : child.get(rowId);
  return row instanceof Y.Map && field.items ? counterAt(row, field.items, inRow) : undefined;
}

/**
 * Adds `delta` to an `x-counter` field of a document's `data` map (specs §9.5), within the
 * field's bounds. A missing or invalid current value counts as the field's default. Returns
 * `undefined` when the path does not name a counter. Call it inside a transaction.
 */
export function adjustCounter(
  map: Y.Map<unknown>,
  schema: FieldSchema,
  path: FieldPath,
  delta: number,
): { value: number; clamped: boolean } | undefined {
  const target = counterAt(map, schema, path);
  if (!target?.field['x-counter']) return undefined;
  const { parent, key, field } = target;
  if (field.type !== 'integer' && field.type !== 'number') return undefined;
  const current: unknown = parent.get(key);
  const start =
    typeof current === 'number' && !valueIssue(field, current)
      ? current
      : Number(defaultValue(field));
  const value = clampValue(field, start + delta);
  parent.set(key, value);
  return { value, clamped: value !== start + delta };
}
