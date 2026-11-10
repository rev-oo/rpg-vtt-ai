import { describe, expect, it } from 'vitest';

import type { PluginDefinition } from '@vtt/plugin-schema';

import { createRules, EngineError, resolveCard } from '../src/index.js';

import { PLUGIN, scripted } from './fixtures.js';

// T-1615: a recipe that targets actors reads the first target as `@target`, without its secret
// fields, and how many there are as `@targets`; a card's actions work out their amounts.

const AIMED: PluginDefinition = {
  ...PLUGIN,
  rolls: {
    ...PLUGIN.rolls,
    strike: {
      formula: { hit: '1d20', damage: '1d6' },
      target: ['character'],
      outcomes: [
        { when: '@targets > 0 and @rolls.hit.total >= 10 + @target.derived.strMod', label: 'Hit' },
      ],
      card: 'strike',
    },
  },
  cards: {
    ...PLUGIN.cards,
    strike: {
      title: 'Strike',
      rows: [
        { label: 'Target', value: "@targets > 0 ? @target.name + ' ' + text(@target.str) : '—'" },
        { label: 'Count', value: '@targets' },
      ],
      apply: [
        { label: 'Damage', field: 'hp.value', amount: '-@rolls.damage.total' },
        { label: 'Half', field: 'hp.value', amount: '-@rolls.damage.total / 2' },
      ],
    },
  },
};

const rules = createRules(AIMED, { settings: { bonus: 1 } });
const ogre = {
  id: 'a2',
  name: 'Ogre',
  type: 'character',
  data: { str: 18, gmNotes: 'weak to fire' },
};

describe('targets (T-1615)', () => {
  it('reads the first target as @target, with its derived values, and counts them', () => {
    const hit = rules.roll('strike', {
      type: 'character',
      data: {},
      targets: [ogre, { ...ogre, id: 'a3', name: 'Imp', data: { str: 6 } }],
      rng: scripted(14, 5),
    });
    expect(hit.outcome?.label).toBe('Hit');
    expect(hit.card?.rows.map((row) => row.value)).toEqual(['Ogre 18', '2']);
    expect(hit.card?.apply).toEqual([
      { label: 'Damage', field: 'hp.value', amount: -5 },
      expect.objectContaining({ label: 'Half', amount: 0, error: expect.any(String) as unknown }),
    ]);

    const alone = rules.roll('strike', { type: 'character', data: {}, rng: scripted(20, 1) });
    expect(alone.outcome).toBeNull();
    expect(alone.card?.rows.map((row) => row.value)).toEqual(['—', '0']);
  });

  it('never reads a target’s secret fields', () => {
    const peek = createRules({
      ...AIMED,
      rolls: { peek: { formula: '1d1', target: ['character'], card: 'peek' } },
      cards: { peek: { title: 'Peek', rows: [{ label: 'Notes', value: '@target.gmNotes' }] } },
    }).roll('peek', { type: 'character', data: {}, targets: [ogre], rng: scripted(1) });
    expect(peek.card?.rows[0]).toMatchObject({ value: '', error: expect.any(String) as unknown });
  });

  it('refuses targets for a recipe that targets nothing, or of a type it does not target', () => {
    const refused = (name: string, type: string) => {
      try {
        rules.roll(name, {
          type: 'character',
          data: {},
          targets: [{ ...ogre, type }],
          rng: scripted(1, 1),
        });
      } catch (error) {
        return error instanceof EngineError ? error.code : 'other';
      }
      return 'rolled';
    };
    expect(refused('plain', 'character')).toBe('bad_target');
    expect(refused('strike', 'npc')).toBe('bad_target');
  });

  it('works out a card action’s amount as a whole number', () => {
    const card = resolveCard(
      'strike',
      { title: 'T', rows: [], apply: [{ label: 'Heal', field: 'hp.value', amount: '@total' }] },
      { total: 4 },
    );
    expect(card.apply).toEqual([{ label: 'Heal', field: 'hp.value', amount: 4 }]);
  });
});
