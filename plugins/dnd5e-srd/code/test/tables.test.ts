import { describe, expect, it } from 'vitest';

import { abilityName, damageText, hitDieOf, slotsFor } from '../src/tables.js';

const row = (classKey: string, level: number): number[] =>
  Array.from({ length: 9 }, (_, i) => slotsFor(classKey, level, i + 1));

describe('spell slots (SRD 5.2 class tables)', () => {
  it('follows the full caster table', () => {
    expect(row('class.wizard', 1)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(row('class.cleric', 5)).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
    expect(row('class.bard', 20)).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });

  it('gives half casters the full table at half their level, rounded up', () => {
    expect(row('class.paladin', 1)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(row('class.ranger', 5)).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(row('class.paladin', 20)).toEqual([4, 3, 3, 3, 2, 0, 0, 0, 0]);
  });

  it('gives warlocks Pact Magic slots, all of one level', () => {
    expect(row('class.warlock', 1)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(row('class.warlock', 6)).toEqual([0, 0, 2, 0, 0, 0, 0, 0, 0]);
    expect(row('class.warlock', 11)).toEqual([0, 0, 0, 0, 3, 0, 0, 0, 0]);
    expect(row('class.warlock', 20)).toEqual([0, 0, 0, 0, 4, 0, 0, 0, 0]);
  });

  it('gives other classes none, and keeps levels within 1–20', () => {
    expect(row('class.fighter', 20)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(slotsFor('class.wizard', 0, 1)).toBe(2);
    expect(slotsFor('class.wizard', 99, 9)).toBe(1);
  });
});

describe('text for cards', () => {
  it('writes damage dice with their bonus', () => {
    expect(damageText(1, 8, 3)).toBe('1d8 + 3');
    expect(damageText(2, 6, 0)).toBe('2d6');
    expect(damageText(1, 4, -1)).toBe('1d4 − 1');
  });

  it('names abilities and Hit Dice', () => {
    expect(abilityName('ability.dex')).toBe('Dexterity');
    expect(abilityName('unknown')).toBe('unknown');
    expect(hitDieOf('class.barbarian')).toBe(12);
    expect(hitDieOf('class.wizard')).toBe(6);
    expect(hitDieOf('class.rogue')).toBe(8);
  });
});
