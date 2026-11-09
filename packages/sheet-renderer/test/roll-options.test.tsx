import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Recipe } from '@vtt/plugin-schema';

import { renderSheet } from './fixtures.js';

// T-1609: a roll button whose recipe has options asks for them, or takes a shortcut key.

const ROLLS: Record<string, Recipe> = {
  aimed: {
    label: 'Aimed shot',
    formula: '1d20',
    options: {
      mode: {
        type: 'choice',
        label: 'Roll',
        choices: [
          { value: 'normal', label: 'Normal' },
          { value: 'advantage', label: 'Advantage', key: 'shift' },
          { value: 'disadvantage', label: 'Disadvantage', key: 'ctrl' },
        ],
      },
      level: { type: 'number', label: 'Level', default: '@args.base', minimum: 1, maximum: '@str' },
      bonus: { type: 'dice', label: 'Bonus' },
    },
  },
  plain: { formula: '1d6' },
  broken: {
    formula: '1',
    options: { level: { type: 'number', label: 'Level', default: '@str / 3' } },
  },
};

function sheet() {
  const rolls: unknown[][] = [];
  renderSheet(
    {
      type: 'row',
      children: [
        { type: 'rollButton', roll: 'aimed', label: 'Aim', args: { base: 2 } },
        { type: 'rollButton', roll: 'plain', label: 'Plain' },
        { type: 'rollButton', roll: 'broken', label: 'Broken' },
      ],
    },
    {
      rolls: ROLLS,
      onRoll: (...call) => {
        rolls.push(call);
      },
    },
  );
  return rolls;
}

describe('roll options (T-1609)', () => {
  it('asks for the options, with their defaults, and rolls with what was chosen', async () => {
    const rolls = sheet();
    const aim = screen.getByRole('button', { name: 'Aim' });
    expect(aim).toHaveAttribute('aria-haspopup', 'dialog');
    await userEvent.click(aim);
    const dialog = screen.getByRole('dialog', { name: 'Aimed shot' });
    expect(within(dialog).getByRole('radio', { name: 'Normal' })).toBeChecked();
    const level = within(dialog).getByRole('spinbutton', { name: 'Level' });
    expect(level).toHaveValue(2);

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Advantage' }));
    await userEvent.clear(level);
    await userEvent.type(level, '15');
    expect(within(dialog).getByText('Must be at most 14.')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Roll' })).toBeDisabled();
    await userEvent.clear(level);
    await userEvent.type(level, '3');
    const bonus = within(dialog).getByRole('textbox', { name: 'Bonus' });
    await userEvent.type(bonus, '1d4 + @str');
    expect(within(dialog).getByText('Enter dice, such as 2d6 + 3.')).toBeVisible();
    await userEvent.clear(bonus);
    await userEvent.type(bonus, '1d4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Roll' }));

    expect(rolls).toEqual([
      ['aimed', { base: 2 }, undefined, { mode: 'advantage', level: 3, bonus: '1d4' }],
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('rolls at once with Shift or Ctrl, and asks nothing without options', async () => {
    const rolls = sheet();
    const user = userEvent.setup();
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('button', { name: 'Aim' }));
    await user.keyboard('{/Shift}{Control>}');
    await user.click(screen.getByRole('button', { name: 'Aim' }));
    await user.keyboard('{/Control}');
    await user.click(screen.getByRole('button', { name: 'Plain' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rolls).toEqual([
      ['aimed', { base: 2 }, undefined, { mode: 'advantage', level: 2, bonus: '' }],
      ['aimed', { base: 2 }, undefined, { mode: 'disadvantage', level: 2, bonus: '' }],
      ['plain', {}],
    ]);
  });

  it('cancels, and disables a button whose options cannot be worked out', async () => {
    const rolls = sheet();
    await userEvent.click(screen.getByRole('button', { name: 'Aim' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rolls).toEqual([]);
    const broken = screen.getByRole('button', { name: 'Broken' });
    expect(broken).toBeDisabled();
    expect(broken).toHaveAttribute(
      'title',
      'The default of the option "level" is not a whole number',
    );
  });
});
