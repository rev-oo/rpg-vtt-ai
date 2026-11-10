import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { FieldSchema, PluginDefinition } from '@vtt/plugin-schema';

import {
  adjustCounter,
  createRules,
  documentLayout,
  fieldBounds,
  readLayer,
  setField,
  staticBounds,
  valueIssue,
  writeLayer,
} from '../src/index.js';

import { CHARACTER, PLUGIN, scripted } from './fixtures.js';

// T-1610: a counter's bounds may be formulas, worked out against the entity on every step.

const SCHEMA: FieldSchema = {
  type: 'object',
  properties: {
    level: { type: 'integer', default: 1, minimum: 1, maximum: 20 },
    name: { type: 'string', default: '', maxLength: 5 },
    notes: { type: 'string', 'x-kind': 'longText', default: '' },
    hp: {
      type: 'object',
      properties: {
        value: { type: 'integer', default: 5, minimum: 0, maximum: '@hp.max', 'x-counter': true },
        max: { type: 'integer', default: 8 },
      },
    },
    skills: {
      type: 'array',
      'x-kind': 'collection',
      items: { type: 'object', properties: { rank: { type: 'integer', default: 0 } } },
    },
  },
};
const HP: FieldSchema = { type: 'integer', minimum: '@floor', maximum: '@hp.max - 1' };

function dataMap(data: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Doc().getMap('data');
  writeLayer(map, documentLayout(SCHEMA).main, data);
  return map;
}

describe('formula bounds (T-1610)', () => {
  it('works formulas out against the entity, and leaves out those that fail', () => {
    expect(fieldBounds(HP, { floor: 2, hp: { max: 9 } })).toEqual({ minimum: 2, maximum: 8 });
    expect(fieldBounds(HP, { hp: { max: 9 } })).toEqual({ maximum: 8 });
    expect(fieldBounds({ type: 'integer', maximum: "'ten'" }, {})).toEqual({});
    expect(staticBounds(HP)).toEqual({});
    // Without the entity, checks hold only the bounds that are numbers.
    expect(valueIssue(HP, 1000)).toBeUndefined();
  });

  it('keeps a counter within the bounds it is given', () => {
    const map = dataMap({ hp: { value: 5, max: 8 } });
    const boundsOf = (field: FieldSchema) => fieldBounds(field, { hp: { max: 8 } });
    expect(adjustCounter(map, SCHEMA, ['hp', 'value'], 10, boundsOf)).toEqual({
      value: 8,
      clamped: true,
    });
    // Without them, a formula bound holds nothing.
    expect(adjustCounter(map, SCHEMA, ['hp', 'value'], 10)).toEqual({ value: 18, clamped: false });
  });

  it("reads the entity's data, derived values and settings through the rules", () => {
    const plugin: PluginDefinition = {
      ...PLUGIN,
      actorTypes: {
        character: {
          ...CHARACTER,
          schema: {
            ...CHARACTER.schema,
            properties: {
              ...CHARACTER.schema.properties,
              hp: {
                type: 'object',
                properties: {
                  value: {
                    type: 'integer',
                    default: 10,
                    minimum: '-@derived.strMod',
                    maximum: '@hp.max + @settings.bonus',
                    'x-counter': true,
                  },
                  max: { type: 'integer', default: 10 },
                },
              },
            },
          },
        },
      },
    };
    const rules = createRules(plugin, { settings: { bonus: 2 } });
    const boundsOf = rules.counterBounds('actor', 'character', { str: 16, hp: { max: 12 } });
    const value = plugin.actorTypes.character?.schema.properties.hp?.properties?.value;
    expect(value && boundsOf(value)).toEqual({ minimum: -3, maximum: 14 });
    expect(boundsOf({ type: 'integer', minimum: 0 })).toEqual({ minimum: 0 });
  });
});

describe('setField (T-1610)', () => {
  it('sets plain fields that are not counters, when the value fits', () => {
    const map = dataMap({ hp: { value: 5 }, skills: { s1: { rank: 1 } } });
    expect(setField(map, SCHEMA, ['level'], 3)).toBeUndefined();
    expect(setField(map, SCHEMA, ['name'], 'Mira')).toBeUndefined();
    expect(setField(map, SCHEMA, ['skills', 's1', 'rank'], 4)).toBeUndefined();
    expect(readLayer(map, documentLayout(SCHEMA).main)).toMatchObject({
      level: 3,
      name: 'Mira',
      skills: { s1: { rank: 4 } },
    });
  });

  it('refuses counters, shared text, containers and values that do not fit', () => {
    const map = dataMap({ hp: { value: 5 }, skills: {} });
    expect(setField(map, SCHEMA, ['hp', 'value'], 3)).toBe('counter');
    expect(setField(map, SCHEMA, ['notes'], 'x')).toBe('not_plain');
    expect(setField(map, SCHEMA, ['hp'], 3)).toBe('not_plain');
    expect(setField(map, SCHEMA, ['level'], 30)).toBe('maximum');
    expect(setField(map, SCHEMA, ['level'], 'high')).toBe('type');
    expect(setField(map, SCHEMA, ['name'], 'Mirabel')).toBe('maxLength');
    expect(setField(map, SCHEMA, ['skills', 'missing', 'rank'], 1)).toBe('not_a_field');
    expect(setField(map, SCHEMA, ['nope'], 1)).toBe('not_a_field');
  });
});

describe('recipe results (T-1610)', () => {
  it('carry the options @options read, for the code that runs next', () => {
    const rules = createRules(PLUGIN);
    const result = rules.roll('aimed', {
      type: 'character',
      data: {},
      rng: scripted(5, 17, 2),
      options: { mode: 'advantage' },
    });
    expect(result.options).toEqual({ mode: 'advantage', level: 6, bonus: '' });
  });
});
