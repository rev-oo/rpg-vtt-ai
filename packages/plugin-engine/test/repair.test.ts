import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { FieldSchema } from '@vtt/plugin-schema';

import {
  adjustCounter,
  documentLayout,
  ensureContainers,
  layerSchemas,
  readLayer,
  repairLayer,
  valueIssue,
  writeLayer,
} from '../src/index.js';

const SCHEMA: FieldSchema = {
  type: 'object',
  properties: {
    level: { type: 'integer', default: 1, minimum: 1, maximum: 20 },
    speed: { type: 'number', default: 9 },
    stance: { type: 'string', enum: ['calm', 'angry'], default: 'calm' },
    alive: { type: 'boolean', default: true },
    notes: { type: 'string', 'x-kind': 'longText', default: '', maxLength: 10 },
    hp: {
      type: 'object',
      properties: {
        value: { type: 'integer', default: 10, minimum: 0, maximum: 12, 'x-counter': true },
        max: { type: 'integer', default: 10 },
        reason: { type: 'string', 'x-layer': 'secret' },
      },
    },
    skills: {
      type: 'array',
      'x-kind': 'collection',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'integer', default: 0, 'x-counter': true },
          name: { type: 'string', maxLength: 5 },
        },
      },
    },
    gmNotes: { type: 'string', 'x-layer': 'secret' },
  },
};
const { main: MAIN } = documentLayout(SCHEMA);

/** A document's `data` map holding `data`, written as a client would. */
function dataMap(data: Record<string, unknown>): Y.Map<unknown> {
  const doc = new Y.Doc();
  const map = doc.getMap('data');
  writeLayer(map, MAIN, data);
  return map;
}

describe('valueIssue', () => {
  it('names the rule a value breaks', () => {
    const fields = SCHEMA.properties ?? {};
    const check = (name: string, value: unknown) => {
      const field = fields[name];
      return field && valueIssue(field, value);
    };
    expect(check('level', 3)).toBeUndefined();
    expect(check('level', 2.5)).toBe('type');
    expect(check('level', 0)).toBe('minimum');
    expect(check('level', 21)).toBe('maximum');
    expect(check('speed', Number.NaN)).toBe('type');
    expect(check('stance', 'sleepy')).toBe('enum');
    expect(check('alive', 'yes')).toBe('type');
    expect(check('notes', 'x'.repeat(11))).toBe('maxLength');
  });
});

describe('repairLayer (specs §9.7)', () => {
  it('replaces invalid values with defaults at every depth and lists them', () => {
    const map = dataMap({
      level: 99,
      speed: 'fast',
      stance: 'calm',
      alive: false,
      notes: 'far too long',
      hp: { value: 5, max: 'ten' },
      skills: { s1: { rank: 2, name: 'Climbing' }, s2: { rank: 1, name: 'Swim' } },
      extra: 'kept',
    });
    const issues = map.doc?.transact(() => repairLayer(map, SCHEMA));
    expect(issues).toEqual([
      { path: ['level'], reason: 'maximum' },
      { path: ['speed'], reason: 'type' },
      { path: ['notes'], reason: 'maxLength' },
      { path: ['hp', 'max'], reason: 'type' },
      { path: ['skills', 's1', 'name'], reason: 'maxLength' },
    ]);
    expect(readLayer(map, MAIN)).toEqual({
      level: 1,
      speed: 9,
      stance: 'calm',
      alive: false,
      notes: '',
      hp: { value: 5, max: 10 },
      skills: { s1: { rank: 2, name: '' }, s2: { rank: 1, name: 'Swim' } },
      extra: 'kept',
    });
    // The repaired text field is a text again.
    expect(map.get('notes')).toBeInstanceOf(Y.Text);
  });

  it('rebuilds values of the wrong shape and drops rows that are not maps', () => {
    const map = new Y.Doc().getMap('data');
    map.set('notes', 'plain');
    map.set('hp', 7);
    map.set('skills', new Y.Map<unknown>([['bad', 3]]));
    expect(repairLayer(map, SCHEMA)).toEqual([
      { path: ['notes'], reason: 'type' },
      { path: ['hp'], reason: 'type' },
      { path: ['skills', 'bad'], reason: 'type' },
    ]);
    expect(map.get('notes')).toBeInstanceOf(Y.Text);
    expect(map.get('hp')).toBeInstanceOf(Y.Map);
    expect(readLayer(map, MAIN)).toMatchObject({ hp: { value: 10, max: 10 }, skills: {} });
  });

  it('leaves valid and missing fields alone', () => {
    const map = dataMap({ level: 3, hp: { value: 0 } });
    expect(repairLayer(map, SCHEMA)).toEqual([]);
    expect(readLayer(map, MAIN)).toEqual({ level: 3, hp: { value: 0 } });
  });
});

describe('adjustCounter (specs §9.5)', () => {
  it('adds deltas to counters, within their bounds', () => {
    const map = dataMap({ hp: { value: 5 }, skills: { s1: { rank: 1 } } });
    expect(adjustCounter(map, SCHEMA, ['hp', 'value'], -3)).toEqual({ value: 2, clamped: false });
    expect(adjustCounter(map, SCHEMA, ['hp', 'value'], -3)).toEqual({ value: 0, clamped: true });
    expect(adjustCounter(map, SCHEMA, ['hp', 'value'], 20)).toEqual({ value: 12, clamped: true });
    expect(adjustCounter(map, SCHEMA, ['skills', 's1', 'rank'], 2)).toEqual({
      value: 3,
      clamped: false,
    });
    expect(readLayer(map, MAIN)).toEqual({ hp: { value: 12 }, skills: { s1: { rank: 3 } } });
  });

  it('starts from the default when the value is missing or invalid', () => {
    const map = dataMap({ hp: { value: 'many' } });
    expect(adjustCounter(map, SCHEMA, ['hp', 'value'], -1)).toEqual({ value: 9, clamped: false });
  });

  it('refuses paths that are not counters', () => {
    const map = dataMap({ hp: { value: 5 }, skills: {} });
    for (const path of [
      ['level'],
      ['hp'],
      ['hp', 'max'],
      ['hp', 'value', 'deeper'],
      ['skills', 'missing', 'rank'],
      ['constructor'],
      ['nope'],
    ]) {
      expect(adjustCounter(map, SCHEMA, path, 1), path.join('.')).toBeUndefined();
    }
  });
});

describe('layerSchemas', () => {
  it('splits a schema between the documents', () => {
    const { main, secret } = layerSchemas(SCHEMA);
    expect(Object.keys(main.properties ?? {})).not.toContain('gmNotes');
    expect(Object.keys(main.properties?.hp?.properties ?? {})).toEqual(['value', 'max']);
    expect(Object.keys(secret?.properties ?? {})).toEqual(['hp', 'gmNotes']);
    expect(secret?.properties?.hp?.properties).toEqual({
      reason: { type: 'string', 'x-layer': 'secret' },
    });
    expect(layerSchemas({ type: 'object', properties: { a: { type: 'integer' } } }).secret).toBe(
      undefined,
    );
  });
});

describe('ensureContainers (specs §9.4)', () => {
  it('creates missing maps and texts, keeping what is there', () => {
    const map = dataMap({ hp: { value: 3 } });
    const hp = map.get('hp');
    ensureContainers(map, MAIN);
    expect(map.get('hp')).toBe(hp);
    expect(map.get('skills')).toBeInstanceOf(Y.Map);
    expect(map.get('notes')).toBeInstanceOf(Y.Text);
    expect(readLayer(map, MAIN)).toEqual({ hp: { value: 3 }, skills: {}, notes: '' });
  });
});
