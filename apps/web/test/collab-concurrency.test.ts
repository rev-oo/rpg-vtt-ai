import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { collectionRows, documentLayout, ensureMaps } from '@vtt/plugin-engine';
import type { FieldSchema } from '@vtt/plugin-schema';
import type { SheetStore } from '@vtt/sheet-renderer';

import { createYjsStore, DATA_MAP } from '../src/collab/yjs-store.js';

const SCHEMA: FieldSchema = {
  type: 'object',
  properties: {
    skills: {
      type: 'array',
      'x-kind': 'collection',
      items: { type: 'object', properties: { name: { type: 'string' } } },
    },
  },
};
const LAYOUT = documentLayout(SCHEMA);
const PATH = ['skills'];

/** The document as the server loads it: every map already exists (ADR-034). */
const SERVER = new Y.Doc();
ensureMaps(SERVER.getMap(DATA_MAP), LAYOUT.main);

/** One client: its synced copy and a store over it, with its own row ids. */
function client(name: string) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(SERVER));
  let counter = 0;
  const store = createYjsStore({
    docs: { main: doc },
    layout: LAYOUT,
    adjust: () => undefined,
    newId: () => `${name}${String((counter += 1))}`,
  });
  return { doc, store };
}

/** Exchanges every missing update between two documents, as the server relays them. */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

const rowIds = (store: SheetStore) =>
  collectionRows(store.getSnapshot().skills).map((row) => row.id);

type Op =
  | { kind: 'add' }
  | { kind: 'remove'; pick: number }
  | { kind: 'move'; pick: number; before: number | null }
  | { kind: 'sync' };

const op: fc.Arbitrary<Op> = fc.oneof(
  { arbitrary: fc.constant({ kind: 'add' } as const), weight: 3 },
  { arbitrary: fc.record({ kind: fc.constant('remove' as const), pick: fc.nat() }), weight: 1 },
  {
    arbitrary: fc.record({
      kind: fc.constant('move' as const),
      pick: fc.nat(),
      before: fc.option(fc.nat(), { nil: null }),
    }),
    weight: 4,
  },
  { arbitrary: fc.constant({ kind: 'sync' } as const), weight: 1 },
);

describe('collections under concurrent edits (FR-SHEET-06, T-0508)', () => {
  it('never duplicates or loses rows, and both clients converge', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.boolean(), op), { maxLength: 60 }), (steps) => {
        const a = client('a');
        const b = client('b');
        const added = new Set<string>();
        const removed = new Set<string>();

        for (const [first, step] of steps) {
          const { store } = first ? a : b;
          const ids = rowIds(store);
          const at = (index: number) => ids[index % Math.max(ids.length, 1)];
          if (step.kind === 'sync') sync(a.doc, b.doc);
          else if (step.kind === 'add') added.add(store.addRow(PATH, { name: 'x' }));
          else {
            const id = at(step.pick);
            if (id === undefined) continue;
            if (step.kind === 'remove') {
              store.removeRow(PATH, id);
              removed.add(id);
            } else {
              const before = step.before === null ? null : (at(step.before) ?? null);
              if (before !== id) store.moveRow(PATH, id, before);
            }
          }
        }
        sync(a.doc, b.doc);

        const final = rowIds(a.store);
        expect(rowIds(b.store)).toEqual(final);
        expect(new Set(final).size).toBe(final.length);
        expect(new Set(final)).toEqual(new Set([...added].filter((id) => !removed.has(id))));
      }),
      { numRuns: 300 },
    );
  });

  it('keeps a moved row once when both clients move it at the same time', () => {
    const a = client('a');
    const b = client('b');
    const ids = ['Climb', 'Swim', 'Sneak'].map((name) => a.store.addRow(PATH, { name }));
    sync(a.doc, b.doc);
    const [climb, swim, sneak] = ids;
    if (!climb || !swim || !sneak) throw new Error('rows missing');

    a.store.moveRow(PATH, sneak, climb);
    b.store.moveRow(PATH, sneak, null);
    b.store.addRow(PATH, { name: 'Jump' });
    sync(a.doc, b.doc);

    expect(rowIds(a.store)).toEqual(rowIds(b.store));
    expect(rowIds(a.store).filter((id) => id === sneak)).toHaveLength(1);
    expect(rowIds(a.store)).toHaveLength(4);
  });
});
