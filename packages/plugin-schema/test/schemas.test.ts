import { describe, expect, it } from 'vitest';

import {
  actorTypeSchema,
  cardSchema,
  combatSchema,
  diceSchema,
  fieldSchema,
  langSchema,
  manifestSchema,
  rollsSchema,
  settingsSchema,
  sheetNode,
} from '../src/index.js';

const manifest = {
  id: 'tiny-d20',
  name: 'Tiny D20',
  version: '1.0.0',
  kind: 'system',
  coreApi: '^0.1.0',
  hasCode: false,
};

const actorType = {
  label: 'type.character',
  controlledBy: 'player',
  sheet: 'character',
  schema: { type: 'object', properties: { str: { type: 'integer', default: 10 } } },
};

describe('manifestSchema', () => {
  it('accepts the minimal manifest', () => {
    expect(manifestSchema.safeParse(manifest).success).toBe(true);
  });

  it.each([
    ['an id with capitals', { id: 'Tiny' }],
    ['an id ending in a hyphen', { id: 'tiny-' }],
    ['a version that is not semver', { version: '1.0' }],
    ['another kind', { kind: 'module' }],
    ['a bad locale', { locales: ['english'] }],
    ['an unknown key', { homepage: 'x' }],
  ])('rejects %s', (_, change) => {
    expect(manifestSchema.safeParse({ ...manifest, ...change }).success).toBe(false);
  });

  it('accepts prerelease versions and locales', () => {
    const result = manifestSchema.safeParse({
      ...manifest,
      version: '2.1.0-beta.1',
      locales: ['en', 'pt-BR'],
      defaultLocale: 'pt-BR',
    });
    expect(result.success).toBe(true);
  });
});

describe('actor and item types', () => {
  it('accepts nested objects, collections and annotations', () => {
    const result = actorTypeSchema.safeParse({
      ...actorType,
      schema: {
        type: 'object',
        properties: {
          hp: {
            type: 'object',
            properties: { value: { type: 'integer', 'x-counter': true } },
            required: ['value'],
          },
          skills: {
            type: 'array',
            'x-kind': 'collection',
            items: { type: 'object', properties: { name: { type: 'string' } } },
          },
          gmNotes: { type: 'string', 'x-kind': 'longText', 'x-layer': 'secret' },
        },
      },
      derived: { strMod: 'floor((@str - 10) / 2)' },
    });
    expect(result.success).toBe(true);
  });

  it.each(['$ref', 'allOf', 'oneOf', 'anyOf', 'not', 'patternProperties', 'if', 'then'])(
    'rejects the unsupported keyword %s',
    (keyword) => {
      const field = { type: 'integer', [keyword]: {} };
      expect(fieldSchema.safeParse(field).success).toBe(false);
    },
  );

  it('rejects field names formulas cannot reference', () => {
    const schema = { type: 'object', properties: { 'hit-points': { type: 'integer' } } };
    expect(actorTypeSchema.safeParse({ ...actorType, schema }).success).toBe(false);
  });

  it('requires an object at the top and who controls the actor', () => {
    expect(actorTypeSchema.safeParse({ ...actorType, schema: { type: 'string' } }).success).toBe(
      false,
    );
    expect(actorTypeSchema.safeParse({ ...actorType, controlledBy: 'anyone' }).success).toBe(false);
  });
});

describe('sheetNode', () => {
  it('accepts every built-in node', () => {
    const layout = {
      type: 'column',
      children: [
        { type: 'row', gap: 'sm', wrap: true, children: [] },
        { type: 'grid', columns: 3, children: [{ type: 'text', text: 'hello' }] },
        { type: 'tabs', tabs: [{ label: 'tab.a', children: [] }] },
        { type: 'section', title: 's', collapsible: true, children: [] },
        { type: 'field', path: 'hp.value', input: 'counter', visibleIf: '@hp.max > 0' },
        { type: 'longText', path: 'notes' },
        { type: 'list', path: 'skills', item: { type: 'field', path: 'name' } },
        { type: 'rollButton', roll: 'skill', label: 'r', args: { id: '@row.id', bonus: 2 } },
        { type: 'derived', key: 'strMod', format: 'signed' },
        { type: 'image', path: 'portrait', size: 'lg' },
        { type: 'custom:hpBar', props: { max: 10 }, class: 'bar' },
      ],
    };
    expect(sheetNode.safeParse(layout).error).toBeUndefined();
  });

  it.each([
    ['an unknown node', { type: 'video' }],
    ['a custom node without a name', { type: 'custom:' }],
    ['a field path with brackets', { type: 'field', path: 'skills[0]' }],
    ['grid columns out of range', { type: 'grid', columns: 13, children: [] }],
    ['tabs without a tab', { type: 'tabs', tabs: [] }],
    ['an unknown prop', { type: 'text', text: 'a', color: 'red' }],
  ])('rejects %s', (_, node) => {
    expect(sheetNode.safeParse(node).success).toBe(false);
  });
});

describe('rolls, dice, cards, settings, combat and lang', () => {
  it('accepts formula and handler recipes', () => {
    const rolls = {
      skill: {
        formula: '1d20',
        outcomes: [{ when: '@total >= 15', label: 'ok' }, { label: 'no' }],
      },
      attack: { handler: 'attack' },
    };
    expect(rollsSchema.safeParse(rolls).success).toBe(true);
    expect(rollsSchema.safeParse({ skill: { label: 'x' } }).success).toBe(false);
  });

  it('accepts text, numeric and labelled faces', () => {
    const dice = {
      dF: { faces: ['-', ' ', '+'], values: { '-': -1, ' ': 0, '+': 1 } },
      dB: { faces: [1, 2, { label: 'skull', value: 0 }] },
    };
    expect(diceSchema.safeParse(dice).success).toBe(true);
    expect(diceSchema.safeParse({ dF: { faces: [] } }).success).toBe(false);
  });

  it('accepts cards', () => {
    const card = { title: 't', rows: [{ label: 'l', value: '@total' }], outcome: true };
    expect(cardSchema.safeParse(card).success).toBe(true);
    expect(cardSchema.safeParse({ ...card, rows: [{ label: 'l' }] }).success).toBe(false);
  });

  it('checks each setting against its type', () => {
    const settings = {
      critFumble: { type: 'boolean', default: true, label: 's' },
      startingHp: { type: 'integer', default: 10, minimum: 1, label: 's' },
      speed: { type: 'number', default: 1.5, label: 's' },
      tone: { type: 'string', default: 'grim', enum: ['grim', 'light'], label: 's' },
    };
    expect(settingsSchema.safeParse(settings).success).toBe(true);
    const wrong = { startingHp: { type: 'integer', default: 1.5, label: 's' } };
    expect(settingsSchema.safeParse(wrong).success).toBe(false);
  });

  it('accepts the combat stub and flat lang files', () => {
    expect(combatSchema.safeParse({ initiative: '1d20 + @dexMod', order: 'desc' }).success).toBe(
      true,
    );
    expect(combatSchema.safeParse({ order: 'random' }).success).toBe(false);
    expect(langSchema.safeParse({ 'type.character': 'Character' }).success).toBe(true);
    expect(langSchema.safeParse({ type: { character: 'Character' } }).success).toBe(false);
  });
});
