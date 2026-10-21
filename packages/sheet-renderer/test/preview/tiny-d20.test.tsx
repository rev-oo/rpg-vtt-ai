import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { loadPreviewPlugin, PREVIEW_PLUGINS } from '../../preview/plugins.js';
import { Preview } from '../../preview/Preview.js';

describe('sheet preview (T-0408)', () => {
  it('loads the reference plugins from plugins/', () => {
    expect(PREVIEW_PLUGINS).toEqual(expect.arrayContaining(['tiny-d20', 'tiny-pool']));
    const loaded = loadPreviewPlugin('tiny-d20');
    expect(loaded.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(loaded.css).toContain('[data-plugin="tiny-d20"] .vitals');
  });

  it('renders the tiny-d20 character sheet against a memory store', async () => {
    render(<Preview />);
    const sheet = document.querySelector('[data-plugin="tiny-d20"]');
    if (!(sheet instanceof HTMLElement)) throw new Error('no sheet');
    const view = within(sheet);

    expect(view.getByLabelText('Strength')).toHaveValue('10');
    expect(view.getByRole('status', { name: 'Str mod' })).toHaveTextContent('+0');
    const user = userEvent.setup();
    await user.clear(view.getByLabelText('Strength'));
    await user.type(view.getByLabelText('Strength'), '16');
    expect(view.getByRole('status', { name: 'Str mod' })).toHaveTextContent('+3');

    // Skills: add a row and roll it with the engine.
    await user.click(view.getByRole('button', { name: 'Add skill' }));
    await user.type(view.getByLabelText('Skill'), 'Climb');
    await user.click(view.getByRole('button', { name: 'Roll' }));
    expect(
      await screen.findByText(/^Roll: 1d20 \+ .+ = \d+ \((Success|Failure)\)$/),
    ).toBeInTheDocument();

    // The GM view shows the secret notes; players do not get them.
    await user.click(view.getByRole('tab', { name: 'Notes' }));
    expect(view.getByLabelText('GM notes')).toBeInTheDocument();
    await user.click(screen.getByLabelText('GM view'));
    const playerSheet = within(document.querySelector('[data-plugin="tiny-d20"]')!);
    await user.click(playerSheet.getByRole('tab', { name: 'Notes' }));
    expect(playerSheet.queryByLabelText('GM notes')).not.toBeInTheDocument();
  });

  it('switches to the other types and plugins', async () => {
    render(<Preview />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Type'), 'item:weapon');
    expect(screen.getByLabelText('Damage')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Plugin'), 'tiny-pool');
    expect(document.querySelector('[data-plugin="tiny-pool"]')).not.toBeNull();
  });
});
