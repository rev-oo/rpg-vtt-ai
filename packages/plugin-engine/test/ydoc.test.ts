import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { FieldSchema } from '@vtt/plugin-schema';

import {
  copyInto,
  documentLayout,
  mergeLayers,
  plainText,
  readLayer,
  replaceRichText,
  richTextOf,
  splitLayers,
  withoutSecrets,
  writeLayer,
} from '../src/index.js';

/** A schema with every kind of field (specs §8.4), and secret fields at several depths. */
const SCHEMA: FieldSchema = {
  type: 'object',
  properties: {
    level: { type: 'integer' },
    speed: { type: 'number' },
    name: { type: 'string' },
    alive: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
    portrait: { type: 'string', 'x-kind': 'image' },
    notes: { type: 'string', 'x-kind': 'longText' },
    bio: { type: 'string', 'x-kind': 'richText' },
    hp: {
      type: 'object',
      properties: {
        value: { type: 'integer', 'x-counter': true },
        max: { type: 'integer' },
        reason: { type: 'string', 'x-layer': 'secret' },
      },
    },
    skills: {
      type: 'array',
      'x-kind': 'collection',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          rank: { type: 'integer' },
          note: { type: 'string', 'x-kind': 'longText' },
          dc: { type: 'integer', 'x-layer': 'secret' },
        },
      },
    },
    gmNotes: { type: 'string', 'x-kind': 'longText', 'x-layer': 'secret' },
  },
};

const DATA = {
  level: 3,
  speed: 7.5,
  name: 'Ayla',
  alive: true,
  tags: ['brave', 'tall'],
  portrait: 'img/ayla.png',
  notes: 'Likes tea.',
  bio: 'Born in Elm.\n\nRaised by wolves.',
  hp: { value: 4, max: 12, reason: 'Poisoned' },
  skills: {
    s1: { name: 'Climb', rank: 2, note: 'Ropes', dc: 15, sort: 'i' },
    s2: { name: 'Swim', rank: 0, note: '', dc: 10, sort: 'r' },
  },
  gmNotes: 'Secretly a dragon',
};

const layout = documentLayout(SCHEMA);

/** Writes a layer into a fresh document, then copies the document through its binary state. */
function roundTrip(fields: Parameters<typeof writeLayer>[1], data: Record<string, unknown>) {
  const doc = new Y.Doc();
  writeLayer(doc.getMap('data'), fields, data);
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return { doc, data: readLayer(copy.getMap('data'), fields) };
}

describe('JSON ↔ Yjs mapping (specs §9.2, T-0504)', () => {
  it('splits data between the main and secret documents', () => {
    const { main, secret } = splitLayers(layout, DATA);
    expect(main).toEqual({
      ...DATA,
      hp: { value: 4, max: 12 },
      skills: {
        s1: { name: 'Climb', rank: 2, note: 'Ropes', sort: 'i' },
        s2: { name: 'Swim', rank: 0, note: '', sort: 'r' },
      },
      gmNotes: undefined,
    });
    expect(main).not.toHaveProperty('gmNotes');
    // Secret parts keep their paths; collection rows share their ids.
    expect(secret).toEqual({
      hp: { reason: 'Poisoned' },
      skills: { s1: { dc: 15 }, s2: { dc: 10 } },
      gmNotes: 'Secretly a dragon',
    });
    expect(mergeLayers(main, secret)).toEqual(DATA);
  });

  it('round-trips every field kind through Yjs', () => {
    const { main, secret } = splitLayers(layout, DATA);
    const mainDoc = roundTrip(layout.main, main);
    const secretDoc = roundTrip(layout.secret ?? {}, secret ?? {});
    expect(mainDoc.data).toEqual(main);
    expect(secretDoc.data).toEqual(secret);
    expect(mergeLayers(mainDoc.data, secretDoc.data)).toEqual(DATA);
  });

  it('uses Y.Text for text, nested maps for objects and keyed maps for collections', () => {
    const map = roundTrip(layout.main, splitLayers(layout, DATA).main).doc.getMap('data');
    expect(map.get('notes')).toBeInstanceOf(Y.Text);
    // Rich text is the editor's blocks, one paragraph per line (ADR-037).
    const bio = map.get('bio');
    if (!(bio instanceof Y.XmlFragment)) throw new Error('bio is not a fragment');
    expect(bio.toJSON()).toBe(
      '<paragraph>Born in Elm.</paragraph><paragraph></paragraph><paragraph>Raised by wolves.</paragraph>',
    );
    // Images, scalars and plain arrays are plain values.
    expect(map.get('portrait')).toBe('img/ayla.png');
    expect(map.get('tags')).toEqual(['brave', 'tall']);
    expect(map.get('hp')).toBeInstanceOf(Y.Map);
    const skills = map.get('skills');
    if (!(skills instanceof Y.Map)) throw new Error('skills is not a map');
    const row: unknown = skills.get('s1');
    if (!(row instanceof Y.Map)) throw new Error('row is not a map');
    expect(row.get('note')).toBeInstanceOf(Y.Text);
    expect(row.get('sort')).toBe('i');
  });

  it('merges concurrent edits of one text field', () => {
    const a = new Y.Doc();
    writeLayer(a.getMap('data'), layout.main, { notes: 'tea' });
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const text = (doc: Y.Doc) => doc.getMap('data').get('notes') as Y.Text;
    text(a).insert(0, 'Likes ');
    text(b).insert(3, ' and cake');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readLayer(a.getMap('data'), layout.main)).toEqual({ notes: 'Likes tea and cake' });
    expect(readLayer(b.getMap('data'), layout.main)).toEqual({ notes: 'Likes tea and cake' });
  });

  it('reads rich text as plain text, blocks on their own lines', () => {
    const doc = new Y.Doc();
    const fragment = doc.getMap('data').set('bio', new Y.XmlFragment());
    const heading = new Y.XmlElement('heading');
    heading.setAttribute('level', '2');
    heading.insert(0, [new Y.XmlText('Past')]);
    const paragraph = new Y.XmlElement('paragraph');
    const bold = new Y.XmlText();
    paragraph.insert(0, [bold, new Y.XmlElement('hardBreak'), new Y.XmlText('wolves')]);
    bold.insert(0, 'Born ');
    bold.insert(5, 'in Elm', { bold: true });
    const list = new Y.XmlElement('bulletList');
    const item = new Y.XmlElement('listItem');
    const inItem = new Y.XmlElement('paragraph');
    inItem.insert(0, [new Y.XmlText('tea')]);
    item.insert(0, [inItem]);
    list.insert(0, [item]);
    fragment.insert(0, [heading, paragraph, list]);
    expect(plainText(fragment)).toBe('Past\nBorn in Elm\nwolves\ntea');
    expect(readLayer(doc.getMap('data'), layout.main)).toEqual({
      bio: 'Past\nBorn in Elm\nwolves\ntea',
    });
    replaceRichText(fragment, 'a\nb');
    expect(fragment.toJSON()).toBe('<paragraph>a</paragraph><paragraph>b</paragraph>');
    expect(plainText(richTextOf(''))).toBe('');
  });

  it('keeps values that do not fit the layout, and keys it does not know', () => {
    const odd = {
      notes: 42,
      hp: 'full',
      skills: { s1: 'not a row' },
      removedField: { kept: true },
    };
    const { main, secret } = splitLayers(layout, odd);
    expect(main).toEqual(odd);
    expect(secret).toEqual({ hp: 'full', skills: { s1: 'not a row' } });
    expect(roundTrip(layout.main, main).data).toEqual(odd);
  });

  it('removes secret fields from a schema at every depth', () => {
    const stripped = withoutSecrets(SCHEMA);
    expect(Object.keys(stripped.properties ?? {})).not.toContain('gmNotes');
    expect(Object.keys(stripped.properties?.hp?.properties ?? {})).toEqual(['value', 'max']);
    expect(Object.keys(stripped.properties?.skills?.items?.properties ?? {})).toEqual([
      'name',
      'rank',
      'note',
    ]);
    // What remains is the main document's layout.
    expect(documentLayout(stripped)).toEqual({ main: layout.main, secret: undefined });
  });

  it('has no secret document for a type without secret fields', () => {
    const plain = documentLayout({ type: 'object', properties: { level: { type: 'integer' } } });
    expect(splitLayers(plain, { level: 1 })).toEqual({ main: { level: 1 }, secret: undefined });
    expect(mergeLayers({ level: 1 }, undefined)).toEqual({ level: 1 });
  });
});

describe('copyInto() (ADR-053)', () => {
  function sheet() {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    doc.transact(() => {
      map.set('str', 12);
      map.set('tags', ['a']);
      const notes = new Y.Text();
      map.set('notes', notes);
      notes.insert(0, 'old notes');
      const bio = new Y.XmlFragment();
      map.set('bio', bio);
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText('old bio')]);
      bio.insert(0, [p]);
      const rows = new Y.Map();
      map.set('skills', rows);
      const row = new Y.Map();
      rows.set('r1', row);
      row.set('name', 'Climb');
      map.set('gone', true);
    });
    return { doc, map };
  }

  it('copies a document without its history, and puts it back in place', () => {
    const live = sheet();
    const copy = new Y.Doc();
    copyInto(copy.getMap('data'), live.map);
    expect(copy.getMap('data').toJSON()).toEqual(live.map.toJSON());

    // The sheet moves on; restoring the copy brings it back.
    const notes = live.map.get('notes') as Y.Text;
    const bio = live.map.get('bio') as Y.XmlFragment;
    live.doc.transact(() => {
      live.map.set('str', 3);
      live.map.delete('gone');
      live.map.set('extra', 1);
      notes.insert(notes.length, ' and new');
      bio.delete(0, bio.length);
      (live.map.get('skills') as Y.Map<unknown>).set('r2', new Y.Map());
    });
    copyInto(live.map, copy.getMap('data'));
    expect(live.map.toJSON()).toEqual(copy.getMap('data').toJSON());
    expect(live.map.get('extra')).toBeUndefined();
    // Editors bound to the texts keep them.
    expect(live.map.get('notes')).toBe(notes);
    expect(live.map.get('bio')).toBe(bio);
    expect(bio.toJSON()).toContain('old bio');
  });
});
