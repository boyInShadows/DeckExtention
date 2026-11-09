import { expect, test } from '@playwright/test';
import { MAINTENANCE_MESSAGE } from '../../packages/schema/src/constants';

import { launchExtension } from './extension';

test('one persistent backup failure and its retry reply produce one alert', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    await page.evaluate(async (type) => {
      await chrome.runtime.sendMessage({ type });
      await chrome.storage.local.set({
        backupMaintenanceError: { message: 'fixture disk full', occurredAt: 1 },
        drawerCommandError: {
          message: 'distinct drawer failure',
          occurredAt: 1,
        },
      });
    }, MAINTENANCE_MESSAGE);
    await page.addInitScript((type) => {
      const send = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = function (
        message: unknown,
        ...args: unknown[]
      ) {
        if (
          message &&
          typeof message === 'object' &&
          Reflect.get(message, 'type') === type
        )
          return Promise.resolve({ error: 'fixture disk full' });
        return Reflect.apply(send, chrome.runtime, [message, ...args]);
      } as typeof send;
    }, MAINTENANCE_MESSAGE);
    await page.reload();
    const errors = page.locator('[data-deck="toast"][data-kind="error"]');
    await expect(errors.filter({ hasText: 'fixture disk full' })).toHaveCount(
      1,
    );
    await expect(errors).toHaveCount(2);
    await expect(
      errors.filter({ hasText: 'distinct drawer failure' }),
    ).toHaveCount(1);
    expect(
      await page.evaluate(
        async () =>
          (await chrome.storage.local.get('backupMaintenanceError'))
            .backupMaintenanceError,
      ),
    ).toEqual({ message: 'fixture disk full', occurredAt: 1 });
    await page.getByLabel('Settings', { exact: true }).click();
    await expect(page.locator('[data-deck="backup-retry"]')).toBeVisible();
  } finally {
    await context.close();
  }
});

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
      });
    });
    await page.reload();
    await expect(
      page.locator('[data-deck="toast"][data-kind="success"]'),
    ).toContainText('Saved to Inbox');
    await expect(
      page.locator('[data-deck="toast"][data-kind="error"]'),
    ).toHaveCount(1);
    await page
      .locator('[data-deck="toast"][data-kind="error"]')
      .getByLabel('Dismiss')
      .click();
    await expect(
      page.locator('[data-deck="toast"][data-kind="error"]'),
    ).toHaveCount(0);
    await page.evaluate(async () => {
      await chrome.storage.local.set({
        backupMaintenanceError: {
          message: 'disk full',
          occurredAt: Date.now(),
        },
      });
    });
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
