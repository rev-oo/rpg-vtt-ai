import * as Y from 'yjs';

import type { FieldSchema, MigrationStep } from '@vtt/plugin-schema';
import type { DataIssue } from '@vtt/shared/api';

import { cloneJson } from './data.js';
import { documentLayout, type FieldLayout } from './layout.js';
import { repairLayer, splitLayers, writeLayer, type LayerData } from './ydoc.js';

// Plugin data migrations (FR-PLUGIN-12, ADR-072): declarative steps run on an entity's data as
// JSON, in the stored form (collections are maps of rows keyed by id).

/** A value on a step's way that is not an object. */
class MigrationStepError extends Error {
  constructor(
    /** The path the step got stuck on: a value on the way is not an object. */
    readonly path: string,
  ) {
    super(`"${path}" is not an object, so the step cannot reach inside it.`);
    this.name = 'MigrationStepError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One place a path reaches: the object that holds the field, and the field's name. */
interface Slot {
  parent: Record<string, unknown>;
  key: string;
  /** The row, for paths through a collection, so a move stays in it. */
  rows: string[];
}

/**
 * Every place `segments` reaches in `data`, one per collection row at each `*`. Objects on the
 * way are created when `create` is set; otherwise a missing one reaches nothing. A value on the
 * way that is not an object fails the step.
 */
function slots(
  data: Record<string, unknown>,
  segments: readonly string[],
  create: boolean,
  done: string[] = [],
  rows: string[] = [],
): Slot[] {
  const [key, ...rest] = segments;
  if (key === undefined) return [];
  if (rest.length === 0) return [{ parent: data, key, rows }];
  if (key === '*') {
    // Each row of the collection, by id; rows that are not objects are not rows.
    return Object.entries(data).flatMap(([id, row]) =>
      isRecord(row) ? slots(row, rest, create, [...done, id], [...rows, id]) : [],
    );
  }
  let child = data[key];
  if (child === undefined) {
    if (!create) return [];
    child = {};
    data[key] = child;
  }
  if (!isRecord(child)) throw new MigrationStepError([...done, key].join('.'));
  return slots(child, rest, create, [...done, key], rows);
}

/** The slot of `to` in the same collection rows as a slot of the step's path. */
function sameRowSlot(
  data: Record<string, unknown>,
  to: readonly string[],
  rows: readonly string[],
): Slot | undefined {
  let row = 0;
  const segments = to.map((segment) => (segment === '*' ? (rows[row++] ?? '*') : segment));
  return slots(data, segments, true)[0];
}

/** Runs one step on `data`, in place. */
function runStep(data: Record<string, unknown>, step: MigrationStep): void {
  const path = step.path.split('.');
  switch (step.op) {
    case 'rename':
    case 'move': {
      const to = step.op === 'rename' ? [...path.slice(0, -1), step.to] : step.to.split('.');
      for (const slot of slots(data, path, false)) {
        if (!Object.hasOwn(slot.parent, slot.key)) continue;
        const value = slot.parent[slot.key];
        Reflect.deleteProperty(slot.parent, slot.key);
        const target = sameRowSlot(data, to, slot.rows);
        // The moved value replaces what is there: a schema may already have made the field.
        if (target) target.parent[target.key] = value;
      }
      return;
    }
    case 'setDefault':
      for (const slot of slots(data, path, true)) {
        if (slot.parent[slot.key] === undefined) slot.parent[slot.key] = cloneJson(step.value);
      }
      return;
    case 'drop':
      for (const slot of slots(data, path, false)) Reflect.deleteProperty(slot.parent, slot.key);
      return;
  }
}

/**
 * Runs `steps` on an entity's data, those for its `kind` and `type` only, and returns the
 * new data; `data` is not changed. Throws {@link MigrationStepFailure} at a failing step.
 */
export function runMigrationSteps(
  data: Readonly<LayerData>,
  steps: readonly MigrationStep[],
  entity: { kind: 'actor' | 'item'; type: string },
): LayerData {
  const result = cloneJson(data) as LayerData;
  steps.forEach((step, index) => {
    if (step.kind !== entity.kind || step.type !== entity.type) return;
    try {
      runStep(result, step);
    } catch (error) {
      if (error instanceof MigrationStepError) throw new MigrationStepFailure(index, error.path);
      throw error;
    }
  });
  return result;
}

/** A step that failed, with its index in its file. */
export class MigrationStepFailure extends Error {
  constructor(
    readonly step: number,
    readonly path: string,
  ) {
    super(`Step ${String(step + 1)} cannot reach inside "${path}": it is not an object.`);
    this.name = 'MigrationStepFailure';
  }
}

/**
 * What the store would repair in `data` under `schema` (specs §9.7): values that do not fit
 * their fields, at every depth and in every collection row. A migration whose result has any
 * fails instead, so it never loses values to defaults (ADR-072). Missing fields and keys the
 * schema does not know are fine: defaults fill in the first, and the second stay (ADR-029).
 */
export function dataIssues(schema: FieldSchema, data: Readonly<LayerData>): DataIssue[] {
  const layout = documentLayout(schema);
  const layers = splitLayers(layout, data);
  const check = (fields: Record<string, FieldLayout> | undefined, part: LayerData | undefined) => {
    if (!fields || !part) return [];
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>('data');
    const issues = doc.transact(() => {
      writeLayer(map, fields, part);
      return repairLayer(map, schema);
    });
    doc.destroy();
    return issues;
  };
  return [...check(layout.main, layers.main), ...check(layout.secret, layers.secret)];
}
