import { describe, expect, it } from 'vitest';

import type { ItemType, PluginDefinition } from '@vtt/plugin-schema';

import { createRules, itemTotals, type HeldItem } from '../src/index.js';

import { CHARACTER, PLUGIN, scripted } from './fixtures.js';

// T-1205 (FR-PLUGIN-15, ADR-063): item types contribute values to their holder's formulas.

const ARMOR: ItemType = {
  label: 'Armor',
  sheet: 'hero',
  schema: {
    type: 'object',
    properties: {
      equipped: { type: 'boolean', default: false },
      acBonus: { type: 'integer', default: 1 },
    },
  },
  derived: { counted: '@equipped ? @acBonus : 0' },
  contributes: {
    acBonus: { formula: '@derived.counted' },
    bestAc: { formula: '@acBonus', combine: 'max', default: 0 },
    worstAc: { formula: '@acBonus', combine: 'min', default: 99 },
    anyWorn: { formula: '@equipped', combine: 'any' },
    worn: { formula: '@equipped', combine: 'count' },
  },
};
const SHIELD: ItemType = {
  label: 'Shield',
  sheet: 'hero',
  schema: { type: 'object', properties: { bonus: { type: 'integer', default: 2 } } },
  contributes: { acBonus: { formula: '@bonus', combine: 'sum' } },
};
const TYPES = { armor: ARMOR, shield: SHIELD };

const armor = (data: Record<string, unknown>): HeldItem => ({ type: 'armor', data });

describe('itemTotals() (T-1205)', () => {
  it('starts every name at its neutral value without items', () => {
    expect(itemTotals(TYPES, [])).toEqual({
      values: { acBonus: 0, bestAc: 0, worstAc: 99, anyWorn: false, worn: 0 },
      errors: {},
    });
  });

  it('combines each name over the items, with defaults and derived values', () => {
    const items = [
      armor({ equipped: true, acBonus: 3 }),
      armor({ acBonus: 5 }),
      // A missing field reads its default (acBonus 1).
      armor({ equipped: true }),
      { type: 'shield', data: {} },
      // Types the system no longer has contribute nothing.
      { type: 'wand', data: { acBonus: 100 } },
    ];
    expect(itemTotals(TYPES, items).values).toEqual({
      acBonus: 3 + 1 + 2,
      bestAc: 5,
      worstAc: 1,
      anyWorn: true,
      worn: 2,
    });
  });

  it('leaves out and reports an item whose value has the wrong type', () => {
    const broken = { ...ARMOR, contributes: { worn: { formula: '@acBonus', combine: 'count' } } };
    const totals = itemTotals({ armor: broken } as Record<string, ItemType>, [armor({})]);
    expect(totals.values).toEqual({ worn: 0 });
    expect(totals.errors.worn?.code).toBe('type_mismatch');
  });
});

describe('@items in actor formulas (T-1205)', () => {
  const plugin: PluginDefinition = {
    ...PLUGIN,
    actorTypes: {
      character: {
        ...CHARACTER,
        derived: { ...CHARACTER.derived, ac: '10 + @items.acBonus' },
      },
    },
    itemTypes: TYPES,
    rolls: { ...PLUGIN.rolls, defend: { formula: '1d20 + @derived.ac + @items.worn' } },
  };
  const rules = createRules(plugin);
  const items = [armor({ equipped: true, acBonus: 3 }), { type: 'shield', data: {} }];

  it('feeds derived values, recipes and typed formulas', () => {
    expect(rules.derived('actor', 'character', {}, items).values.ac).toBe(15);
    expect(rules.derived('actor', 'character', {}).values.ac).toBe(10);
    expect(rules.itemTotals(items)).toMatchObject({ acBonus: 5, worn: 1 });
    const defend = rules.roll('defend', { type: 'character', data: {}, items, rng: scripted(4) });
    expect(defend.roll.total).toBe(4 + 15 + 1);
    const typed = rules.rollFormula('@items.acBonus', {
      type: 'character',
      items,
      rng: scripted(),
    });
    expect(typed.total).toBe(5);
  });
});

describe('@item in rolls (T-1207)', () => {
  const plugin: PluginDefinition = {
    ...PLUGIN,
    itemTypes: {
      weapon: {
        label: 'Weapon',
        sheet: 'hero',
        schema: {
          type: 'object',
          properties: {
            bonus: { type: 'integer', default: 1 },
            damage: { type: 'string', default: '1d6' },
          },
        },
        derived: { hit: '@bonus + 1' },
      },
    },
    rolls: {
      ...PLUGIN.rolls,
      attack: { formula: '1d20 + @item.derived.hit + @item.bonus', item: ['weapon'] },
    },
  };
  const rules = createRules(plugin);
  const sword = { id: 'i1', name: 'Sword', type: 'weapon', data: { bonus: 2 } };

  it("reads the item's fields, defaults, derived values and name", () => {
    const attack = rules.roll('attack', {
      type: 'character',
      data: {},
      item: sword,
      rng: scripted(10),
    });
    expect(attack.roll.total).toBe(10 + 3 + 2);
    const typed = rules.rollFormula(
      "@item.name == 'Sword' and @item.damage == '1d6' ? @item.bonus : 0",
      {
        type: 'character',
        item: sword,
        rng: scripted(),
      },
    );
    expect(typed.total).toBe(2);
  });
});
