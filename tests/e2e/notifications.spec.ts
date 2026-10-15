import { expect, test } from '@playwright/test';

import { launchExtension } from './extension';

test('new tab classifies stored notices and Settings retries a failed backup', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    await page.evaluate(async () => {
      await chrome.storage.local.set({
        'deck:capture-notice': {
          message: 'Saved to Inbox',
          createdAt: Date.now(),
          kind: 'success',
        },
        drawerCommandError: {
          message: 'command failed',
          occurredAt: Date.now(),
        },
        backupMaintenanceError: {
          message: 'disk full',
          occurredAt: Date.now(),
        },
      });
    });
    await page.reload();
    await expect(
      page.locator('[data-deck="toast"][data-kind="success"]'),
    ).toContainText('Saved to Inbox');
    await expect(
      page.locator('[data-deck="toast"][data-kind="error"]'),
    ).toHaveCount(2);
    await page.getByLabel('Dismiss').first().click();
    await expect(
      page.locator('[data-deck="toast"][data-kind="error"]'),
    ).toHaveCount(1);
    await page.getByLabel('Settings').click();
    const retry = page.locator('[data-deck="backup-retry"]');
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(retry).toHaveCount(0);
    await expect(
      page.locator('[data-deck="toast"][data-kind="success"]').last(),
    ).toContainText('Backup saved');
  } finally {
    await context.close();
  }
});
