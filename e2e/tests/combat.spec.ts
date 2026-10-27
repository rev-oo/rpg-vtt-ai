import { expect, test, type Page } from '@playwright/test';

import { ADMIN, createPlayer, post, signIn } from './support/api.js';

// T-0801: the GM runs an encounter through two rounds; a player sees each turn within 500 ms
// and never the hidden combatant (FR-COMBAT-01, 03, 04).
test('a GM runs two rounds of combat with a player watching', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  const player = await createPlayer(browser, gm, 'milo', 'Milo');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Skirmish Table',
    systemId: 'e2e-system',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(player, `/invites/${token}/accept`);

  const open = async (who: typeof gm): Promise<Page> => {
    const page = await who.context.newPage();
    await page.goto(`/tables/${table.id}`);
    await expect(page.getByRole('heading', { name: 'Skirmish Table' })).toBeVisible();
    await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
    return page;
  };
  const [gmPage, playerPage] = await Promise.all([open(gm), open(player)]);
  const order = (page: Page) => page.getByRole('list', { name: 'Turn order' });
  const turn = (page: Page) => order(page).locator('[aria-current="step"]');

  await test.step('the GM sets up the encounter', async () => {
    await gmPage.getByRole('button', { name: 'Start an encounter' }).click();
    for (const [name, initiative, hidden] of [
      ['Hero', '14', false],
      ['Orc', '9', false],
      ['Assassin', '20', true],
    ] as const) {
      await gmPage.getByLabel('Name', { exact: true }).fill(name);
      if (hidden) await gmPage.getByLabel('Hidden', { exact: true }).check();
      await gmPage.getByRole('button', { name: 'Add combatant' }).click();
      const field = gmPage.getByLabel(`Initiative of ${name}`);
      await field.fill(initiative);
      await field.blur();
      await expect(order(gmPage)).toContainText(name);
    }
    await expect(order(gmPage).getByRole('listitem')).toHaveText([/Assassin/, /Hero/, /Orc/]);
    await gmPage.getByRole('button', { name: 'Begin' }).click();
  });

  await test.step('the player follows two rounds without the hidden combatant', async () => {
    await expect(order(playerPage).getByRole('listitem')).toHaveText([/Hero/, /Orc/]);
    // The hidden Assassin opens round 1: the player sees nobody's turn.
    await expect(turn(playerPage)).toHaveCount(0);
    const expected = [
      ['Round 1', 'Hero'],
      ['Round 1', 'Orc'],
      ['Round 2', null],
      ['Round 2', 'Hero'],
      ['Round 2', 'Orc'],
    ] as const;
    for (const [round, name] of expected) {
      await gmPage.getByRole('button', { name: 'Next turn' }).click();
      const heading = playerPage.getByRole('heading', { name: /^Combat/ });
      await expect(heading).toContainText(round, { timeout: 500 });
      if (name) await expect(turn(playerPage)).toHaveText(new RegExp(name), { timeout: 500 });
      // The hidden combatant's turn: the player sees nobody's.
      else await expect(turn(playerPage)).toHaveCount(0, { timeout: 500 });
    }
    await expect(playerPage.getByText('Assassin')).toHaveCount(0);
  });

  await test.step('ending the encounter removes it for the player', async () => {
    await gmPage.getByRole('button', { name: 'End encounter' }).click();
    await expect(playerPage.getByRole('heading', { name: /^Combat/ })).toBeHidden();
  });
});
