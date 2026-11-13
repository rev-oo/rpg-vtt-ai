import { expect, type Locator, type Page } from '@playwright/test';

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

const tokensButton = (page: Page) => page.getByRole('button', { name: /^Tokens \(\d+\)$/ });

/** Opens the token list floating over the map, closed until asked for (T-1620). */
export async function showTokens(page: Page): Promise<void> {
  const toggle = tokensButton(page);
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.getByRole('list', { name: 'Tokens' })).toBeVisible();
}

/** The token list, opened first: a click elsewhere closes it. */
export async function tokenList(page: Page): Promise<Locator> {
  await showTokens(page);
  return page.getByRole('list', { name: 'Tokens' });
}

/** Closes the token list, so it covers no part of the map the test is about to click. */
export async function hideTokens(page: Page): Promise<void> {
  const toggle = tokensButton(page);
  if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
  await expect(page.getByRole('list', { name: 'Tokens' })).toHaveCount(0);
}
