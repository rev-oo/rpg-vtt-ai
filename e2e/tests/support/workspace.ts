import { expect, type Page } from '@playwright/test';

// A table has one URL; sheets, entries and pages open as workspace panels (ADR-059).

/** Opens a panel from the Panels menu, or brings it to the front. */
export async function showPanel(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Panels' }).click();
  await page
    .getByRole('list', { name: 'Panels' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click();
}

/** Opens an actor's sheet from the actor list. */
export async function openSheet(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Open sheet: ${name}` }).click();
  await expect(page.getByRole('tabpanel', { name }).getByRole('heading', { name })).toBeVisible();
}
