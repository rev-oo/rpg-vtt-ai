import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { documentLayout, readLayer } from '@vtt/plugin-engine';
import type { FieldSchema } from '@vtt/plugin-schema';

import { createYjsStore, DATA_MAP } from '../src/collab/yjs-store.js';

const SCHEMA: FieldSchema = {
  type: 'object',
  properties: {
    str: { type: 'integer', default: 10 },
    hp: {
      type: 'object',
      properties: {
        value: { type: 'integer', default: 10, 'x-counter': true },
        reason: { type: 'string', 'x-layer': 'secret' },
      },
    },
    notes: { type: 'string', 'x-kind': 'longText' },
    skills: {
      type: 'array',
      'x-kind': 'collection',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          dc: { type: 'integer', 'x-layer': 'secret' },
        },
      },
    },
    gmNotes: { type: 'string', 'x-kind': 'longText', 'x-layer': 'secret' },
  },
};
const LAYOUT = documentLayout(SCHEMA);

function setup({ secret = true } = {}) {
  const main = new Y.Doc();
  const secretDoc = secret ? new Y.Doc() : undefined;
  const adjust = vi.fn();
  let ids = 0;
  const store = createYjsStore({
    docs: { main, secret: secretDoc },
    layout: LAYOUT,
    adjust,
    newId: () => `r${String((ids += 1))}`,
  });
  const json = (doc: Y.Doc | undefined, layer: 'main' | 'secret') =>
    doc && readLayer(doc.getMap(DATA_MAP), (layer === 'main' ? LAYOUT.main : LAYOUT.secret) ?? {});
  return {
    store,
    adjust,
    main,
    secretDoc,
    mainJson: () => json(main, 'main'),
    secretJson: () => json(secretDoc, 'secret'),
  };
}

describe('Yjs sheet store (T-0506, specs §9.1, §9.2)', () => {
  it('writes each field to the document of its layer and reads both back', () => {
    const { store, mainJson, secretJson } = setup();
    const changes = vi.fn();
    store.subscribe(changes);
    store.set(['str'], 14);
    store.set(['hp', 'reason'], 'poisoned');
    store.set(['gmNotes'], 'A dragon');
    expect(mainJson()).toEqual({ str: 14 });
    expect(secretJson()).toEqual({ hp: { reason: 'poisoned' }, gmNotes: 'A dragon' });
    expect(store.getSnapshot()).toEqual({
      str: 14,
      hp: { reason: 'poisoned' },
      gmNotes: 'A dragon',
    });
    expect(changes).toHaveBeenCalledTimes(3);
  });

  it('follows remote changes and keeps text fields as Y.Text', () => {
    const { store, main } = setup();
    const remote = new Y.Doc();
    remote.getMap(DATA_MAP).set('notes', new Y.Text('Likes tea.'));
    Y.applyUpdate(main, Y.encodeStateAsUpdate(remote));
    expect(store.getSnapshot()).toMatchObject({ notes: 'Likes tea.' });

    const text = main.getMap(DATA_MAP).get('notes');
    store.set(['notes'], 'Likes coffee.');
    expect(main.getMap(DATA_MAP).get('notes')).toBe(text);
    expect(store.getSnapshot()).toMatchObject({ notes: 'Likes coffee.' });
  });

  it('adds, moves and removes rows across both layers (specs §9.4)', () => {
    const { store, mainJson, secretJson } = setup();
    const climb = store.addRow(['skills'], { name: 'Climb', dc: 12 });
    const swim = store.addRow(['skills'], { name: 'Swim' });
    const main = mainJson()?.skills as Record<string, { name: string; sort: string }>;
    expect(Object.keys(main)).toEqual([climb, swim]);
    expect(main[climb]?.sort.localeCompare(main[swim]?.sort ?? '')).toBe(-1);
    // Secret row fields share the row id; rows without any stay out of the secret document.
    expect(secretJson()).toEqual({ skills: { [climb]: { dc: 12 } } });

    store.moveRow(['skills'], swim, climb);
    const moved = mainJson()?.skills as Record<string, { sort: string }>;
    expect((moved[swim]?.sort ?? '') < (moved[climb]?.sort ?? '')).toBe(true);

    store.removeRow(['skills'], climb);
    expect(Object.keys(mainJson()?.skills as object)).toEqual([swim]);
    expect(secretJson()).toEqual({ skills: {} });
  });

  it('leaves counters to the server and secret fields alone without the secret document', () => {
    const { store, adjust, mainJson } = setup({ secret: false });
    store.adjust(['hp', 'value'], -3);
    expect(adjust).toHaveBeenCalledWith('main', ['hp', 'value'], -3);
    expect(mainJson()).toEqual({});
    // A player has no secret document; such writes go nowhere.
    store.set(['gmNotes'], 'peek');
    expect(store.getSnapshot()).toEqual({});
  });

  it('stops following the documents once destroyed', () => {
    const { store, main } = setup();
    const changes = vi.fn();
    store.subscribe(changes);
    store.destroy();
    main.getMap(DATA_MAP).set('str', 3);
    expect(changes).not.toHaveBeenCalled();
  });
});
