import { expect, test } from '@playwright/test';

import { launchExtension } from './extension';

test('note text survives Close, page switch, and drawer close; preview renders markdown', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    await page.keyboard.press('Control+J');
    const card = page.locator('[data-card-id="example_mdn"]');
    const edit = () => card.getByRole('button', { name: 'Edit note' });
    const note = page.locator('[data-deck="note"] textarea');
    const pageRail = page.locator('[data-deck="pages"]');
    const selectedPage = await pageRail
      .locator('[data-selected]')
      .textContent();
    if (!selectedPage) throw new Error('No selected page');

    await edit().click();
    await note.fill('# Read **today**');
    await page.locator('[data-deck="note-toggle-preview"]').click();
    await expect(page.locator('[data-deck="note-preview"] h1')).toHaveText(
      'Read today',
    );
    await expect(page.locator('[data-deck="note-preview"] strong')).toHaveText(
      'today',
    );
    await page.locator('[data-deck="note-close"]').click();
    await expect(page.locator('[data-deck="note"]')).toHaveCount(0);
    await edit().click();
    await expect(note).toHaveValue('# Read **today**');

    await note.fill('Page switch draft');
    await pageRail.getByRole('button', { name: 'Inbox' }).click();
    await expect(page.locator('[data-deck="note"]')).toHaveCount(0);
    await pageRail.getByRole('button', { name: selectedPage.trim() }).click();
    await edit().click();
    await expect(note).toHaveValue('Page switch draft');

    await note.fill('Drawer close draft');
    await page.keyboard.press('Control+J');
    await expect(page.locator('[data-deck="drawer"][data-open]')).toHaveCount(
      0,
    );
    await page.keyboard.press('Control+J');
    await expect(page.locator('[data-deck="drawer"][data-open]')).toBeVisible();
    await edit().click();
    await expect(note).toHaveValue('Drawer close draft');
  } finally {
    await context.close();
  }
});
