import { expect, test } from '@playwright/test';
import {
  MAINTENANCE_MESSAGE,
  SETTINGS_DEFAULTS,
} from '../../packages/schema/src/constants';

import { launchExtension } from './extension';

test('current worker backups preserve Google suggestion preferences', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    const outcomes = await page.evaluate(exerciseBackupSettings, {
      type: MAINTENANCE_MESSAGE,
      defaults: SETTINGS_DEFAULTS,
    });
    expect(outcomes).toEqual([
      { error: null, enabled: false, hasBackupError: false },
      { error: null, enabled: true, hasBackupError: false },
    ]);
  } finally {
    await context.close();
  }
});

async function exerciseBackupSettings({
  type,
  defaults,
}: {
  type: string;
  defaults: typeof SETTINGS_DEFAULTS;
}) {
  await chrome.runtime.sendMessage({ type });
  const request = indexedDB.open('deck');
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const outcomes = [];
  try {
    for (const enabled of [false, true]) {
      const tx = database.transaction(['meta', 'snapshots'], 'readwrite');
      tx.objectStore('meta').put({
        key: 'settings',
        value: { ...defaults, showGoogleSuggestions: enabled },
      });
      tx.objectStore('snapshots').clear();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      await chrome.storage.local.remove('deckLatestSnapshot');
      const reply = await chrome.runtime.sendMessage({ type });
      const stored = await chrome.storage.local.get([
        'deckLatestSnapshot',
        'backupMaintenanceError',
      ]);
      outcomes.push({
        error: reply.error,
        enabled: JSON.parse(stored.deckLatestSnapshot.blob).settings
          .showGoogleSuggestions,
        hasBackupError: stored.backupMaintenanceError !== undefined,
      });
    }
    return outcomes;
  } finally {
    database.close();
  }
}

function failSnapshotStorage() {
  Date.now = () => 1;
  const set = chrome.storage.local.set;
  chrome.storage.local.set = async function (items) {
    if (Object.hasOwn(items, 'deckLatestSnapshot'))
      throw new Error('fixture disk full');
    return set.call(this, items);
  };
}

test('one persistent backup failure and its retry reply produce one alert', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    await page.evaluate(async (type) => {
      await chrome.runtime.sendMessage({ type });
    }, MAINTENANCE_MESSAGE);
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await worker.evaluate(failSnapshotStorage);
    await page.evaluate(async (type) => {
      const reply = await chrome.runtime.sendMessage({ type });
      if (reply.error !== 'fixture disk full')
        throw new Error('Backup failure fixture did not reach the worker');
      await chrome.storage.local.set({
        drawerCommandError: {
          message: 'distinct drawer failure',
          occurredAt: 1,
        },
      });
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
