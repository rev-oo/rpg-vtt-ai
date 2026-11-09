import { describe, expect, it } from 'vitest';

import type { RollOption } from '@vtt/plugin-schema';

import { createRules, optionDefaults, rollOptions, shortcutOptions } from '../src/index.js';

import { PLUGIN, scripted } from './fixtures.js';

// T-1609: options the app asks for when a roll button is pressed.

const OPTIONS: Record<string, RollOption> = {
  mode: {
    type: 'choice',
    label: 'Roll',
    choices: [
      { value: 'normal', label: 'Normal' },
      { value: 'advantage', label: 'Advantage', key: 'shift' },
      { value: 'disadvantage', label: 'Disadvantage', key: 'ctrl' },
    ],
  },
  level: { type: 'number', label: 'Level', default: '@level', minimum: '@level', maximum: 9 },
  bonus: { type: 'dice', label: 'Bonus', default: '1d4' },
};
const context = { scope: { level: 3 } };

describe('roll options (T-1609)', () => {
  it('fills in defaults, worked out from the roll', () => {
    expect(optionDefaults(OPTIONS, context)).toEqual({ mode: 'normal', level: 3, bonus: '1d4' });
    expect(rollOptions(OPTIONS, { level: 5 }, context)).toEqual({
      mode: 'normal',
      level: 5,
      bonus: '1d4',
    });
  });

  it('picks the choice of a shortcut key, the rest at their defaults', () => {
    expect(shortcutOptions(OPTIONS, 'ctrl', context)).toEqual({
      mode: 'disadvantage',
      level: 3,
      bonus: '1d4',
    });
    expect(
      shortcutOptions({ bonus: { type: 'dice', label: 'Bonus' } }, 'shift', context),
    ).toBeNull();
  });

  it('refuses values the declaration does not allow', () => {
    const refused = (given: Record<string, string | number>) => () =>
      rollOptions(OPTIONS, given, context);
    expect(refused({ mode: 'wild' })).toThrow('The option "mode" has no such choice');
    expect(refused({ level: 2 })).toThrow('The option "level" must be at least 3');
    expect(refused({ level: 10 })).toThrow('The option "level" must be at most 9');
    expect(refused({ level: 4.5 })).toThrow('The option "level" takes a whole number');
    expect(refused({ level: '4' })).toThrow('takes a whole number');
    expect(refused({ bonus: '1d4 + @str' })).toThrow('The option "bonus" takes dice');
    expect(refused({ bonus: 3 })).toThrow('takes dice');
    expect(refused({ extra: 1 })).toThrow('The roll has no option "extra"');
    expect(refused({})).not.toThrow();
    expect(rollOptions(OPTIONS, { bonus: '' }, context).bonus).toBe('');
  });

  it('refuses formulas that do not give a whole number', () => {
    const odd: Record<string, RollOption> = {
      level: { type: 'number', label: 'Level', default: '@level / 2' },
    };
    expect(() => optionDefaults(odd, context)).toThrow(
      expect.objectContaining({ code: 'bad_option' }),
    );
  });

  it('lets recipes read @options, checked on every roll', () => {
    const rules = createRules(PLUGIN);
    const request = { type: 'character', data: {}, rng: scripted(5, 17, 2) };
    expect(rules.roll('aimed', request).roll.resolved).toBe('1d20 + 6');
    const aimed = rules.roll('aimed', {
      ...request,
      rng: scripted(5, 17, 2),
      options: { mode: 'advantage', level: 1, bonus: '1d4' },
    });
    expect(aimed.roll).toMatchObject({ resolved: '2d20kh1 + 1 + 1d4', total: 20 });
    expect(() => rules.roll('aimed', { ...request, options: { level: 20 } })).toThrow(
      expect.objectContaining({ code: 'bad_option' }),
    );
    expect(() => rules.roll('plain', { ...request, options: { mode: 'normal' } })).toThrow(
      expect.objectContaining({ code: 'bad_option' }),
    );
  });
});
