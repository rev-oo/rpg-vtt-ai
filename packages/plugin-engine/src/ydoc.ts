import * as Y from 'yjs';

import type { DocumentLayout, FieldLayout } from './layout.js';

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
