import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// A table has one URL; tests reach sheets and pages through the workspace (ADR-059).

/** Opens a panel from the Panels menu, or brings it to the front. */
export async function openPanel(name: string): Promise<void> {
  const user = userEvent.setup();
  await screen.findByRole('button', { name: 'Panels' });
  // The table page may render again while its data loads, closing a menu just opened: open
  // it again until it stays.
  const menu = await waitFor(async () => {
    if (!screen.queryByRole('list', { name: 'Panels' })) {
      await user.click(screen.getByRole('button', { name: 'Panels' }));
    }
    return screen.getByRole('list', { name: 'Panels' });
  });
  await user.click(within(menu).getByRole('button', { name: new RegExp(`^${name}`) }));
}

/** Opens an actor's sheet from the actor list. */
export async function openSheet(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: `Open sheet: ${name}` }));
}
