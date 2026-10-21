import { describe, expect, it } from 'vitest';

import {
  createRules,
  documentLayout,
  EngineError,
  settingValues,
  toCustomDie,
} from '../src/index.js';

import { CHARACTER, PLUGIN, scripted } from './fixtures.js';

describe('settingValues() (specs §8.12)', () => {
  it('keeps stored values that fit and falls back to defaults', () => {
    const definitions = {
      ...PLUGIN.settings,
      crit: { type: 'boolean' as const, label: 'x', default: true },
      mode: { type: 'string' as const, label: 'x', default: 'a', enum: ['a', 'b'] },
      name: { type: 'string' as const, label: 'x', default: '', maxLength: 3 },
      scale: { type: 'number' as const, label: 'x', default: 1.5 },
    };
    expect(settingValues(definitions)).toEqual({
      bonus: 1,
      crit: true,
      mode: 'a',
      name: '',
      scale: 1.5,
    });
    expect(
      settingValues(definitions, {
        bonus: 4,
        crit: false,
        mode: 'b',
        name: 'abc',
        scale: 0.5,
        old: 1,
      }),
    ).toEqual({ bonus: 4, crit: false, mode: 'b', name: 'abc', scale: 0.5 });
    expect(
      settingValues(definitions, {
        bonus: 9,
        crit: 'yes',
        mode: 'c',
        name: 'abcd',
        scale: Infinity,
      }),
    ).toEqual({ bonus: 1, crit: true, mode: 'a', name: '', scale: 1.5 });
    expect(settingValues(definitions, { bonus: 2.5 }).bonus).toBe(1);
  });
});

describe('toCustomDie() (specs §8.8)', () => {
  it('maps faces to labels and values', () => {
    expect(
      toCustomDie({
        faces: ['-', ' ', '+', '3', 'blank', 7, { label: 'skull', value: -2 }],
        values: { '-': -1, '+': 1 },
      }),
    ).toEqual({
      faces: [
        { label: '-', value: -1 },
        { label: ' ', value: 0 },
        { label: '+', value: 1 },
        { label: '3', value: 3 },
        { label: 'blank', value: 0 },
        { label: '7', value: 7 },
        { label: 'skull', value: -2 },
      ],
    });
  });
});

describe('documentLayout() (specs §9.2)', () => {
  it('describes the live documents, with secret fields apart', () => {
    const layout = documentLayout(CHARACTER.schema);
    expect(layout.main).toEqual({
      str: { kind: 'value', type: 'integer' },
      dex: { kind: 'value', type: 'integer' },
      hp: {
        kind: 'map',
        fields: {
          value: { kind: 'value', type: 'integer' },
          max: { kind: 'value', type: 'integer' },
        },
      },
      skills: {
        kind: 'collection',
        row: { name: { kind: 'value', type: 'string' }, rank: { kind: 'value', type: 'integer' } },
      },
      tags: { kind: 'value', type: 'array' },
      notes: { kind: 'text', rich: false },
      portrait: { kind: 'value', type: 'string' },
      alive: { kind: 'value', type: 'boolean' },
    });
    expect(layout.secret).toEqual({
      skills: { kind: 'collection', row: { secretBonus: { kind: 'value', type: 'integer' } } },
      gmNotes: { kind: 'text', rich: false },
    });
  });

  it('keeps everything under a secret field secret, and has no secret document without one', () => {
    const layout = documentLayout({
      type: 'object',
      properties: {
        plot: {
          type: 'object',
          'x-layer': 'secret',
          properties: {
            twist: { type: 'string', 'x-kind': 'richText' },
            deeper: { type: 'string', 'x-layer': 'secret' },
          },
        },
      },
    });
    expect(layout.main).toEqual({});
    expect(layout.secret).toEqual({
      plot: {
        kind: 'map',
        fields: { twist: { kind: 'text', rich: true }, deeper: { kind: 'value', type: 'string' } },
      },
    });
    expect(documentLayout({ type: 'object', properties: {} }).secret).toBeUndefined();
  });
});

describe('createRules()', () => {
  const rules = createRules(PLUGIN, { settings: { bonus: 3 } });

  it('applies the table settings', () => {
    expect(rules.settings).toEqual({ bonus: 3 });
  });

  it('gives new entities their defaults, per kind', () => {
    expect(rules.defaults('item', 'weapon')).toEqual({ damage: '1d6' });
    expect(rules.defaults('actor', 'character').str).toBe(14);
  });

  it('computes derived values on data with defaults filled in', () => {
    expect(rules.derived('actor', 'character', { str: 18 }).values).toEqual({
      attack: 7,
      strMod: 4,
      skillTotal: 2,
    });
    expect(rules.derived('item', 'weapon', {}).values).toEqual({});
  });

  it('describes documents per type', () => {
    expect(rules.layout('item', 'weapon')).toEqual({
      main: { damage: { kind: 'value', type: 'string' } },
      secret: undefined,
    });
  });

  it('rolls recipes against the actor, with derived values, settings and custom dice', () => {
    const result = rules.roll('skill', {
      type: 'character',
      data: { str: 16 },
      args: { id: 'd0' },
      rng: scripted(12),
    });
    expect(result.roll).toMatchObject({ resolved: '1d20 + 3 + 2', total: 17 });
    expect(result.outcome?.label).toBe('outcome.success');

    const fate = rules.roll('fate', { type: 'character', data: {}, rng: scripted(1, 2, 3, 3) });
    expect(fate.roll.total).toBe(1);
    expect(fate.roll.dice[0]?.results.map((die) => die.label)).toEqual(['-', ' ', '+', '+']);
  });

  it('refuses unknown types and recipes, and handler recipes', () => {
    const request = { type: 'character', data: {}, rng: scripted() };
    expect(() => rules.roll('nope', request)).toThrow(EngineError);
    expect(() => rules.roll('attack', request)).toThrow(
      expect.objectContaining({ code: 'handler_recipe' }),
    );
    expect(() => rules.roll('plain', { ...request, type: 'dragon' })).toThrow(
      expect.objectContaining({ code: 'unknown_type' }),
    );
    expect(() => rules.defaults('item', 'character')).toThrow(/no item type "character"/);
    expect(() => rules.roll('toString', request)).toThrow(
      expect.objectContaining({ code: 'unknown_recipe' }),
    );
  });

  it('works without settings or functions', () => {
    expect(createRules(PLUGIN).settings).toEqual({ bonus: 1 });
  });
});
