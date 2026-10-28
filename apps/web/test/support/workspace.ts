import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// A table has one URL; tests reach sheets and pages through the workspace (ADR-059).

/** Opens a panel from the Panels menu, or brings it to the front. */
export async function openPanel(name: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Panels' }));
  const menu = screen.getByRole('list', { name: 'Panels' });
  await user.click(within(menu).getByRole('button', { name: new RegExp(`^${name}`) }));
}

/** Opens an actor's sheet from the actor list. */
export async function openSheet(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: `Open sheet: ${name}` }));
}
