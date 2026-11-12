import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
  type Worker,
} from '@playwright/test';
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  MAINTENANCE_MESSAGE,
  SETTINGS_DEFAULTS,
} from '../../packages/schema/src/constants';
import { launchExtension } from './extension';

test('reload repairs an older backup validator and preserves saved data', async () => {
  const testInfo = test.info();
  const { context, worker } = await launchOlderWorker(testInfo);
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    const before = await readSavedData(page, true);
    expect(before.records[2]).not.toHaveLength(0);
    const failed = await page.evaluate(
      (type) => chrome.runtime.sendMessage({ type }),
      MAINTENANCE_MESSAGE,
    );
    expect(JSON.parse(failed.error)).toEqual([
      {
        code: 'unrecognized_keys',
        keys: ['showGoogleSuggestions'],
        path: ['settings'],
        message: 'Unrecognized key: "showGoogleSuggestions"',
      },
    ]);
    await page.reload();
    await reloadFromNotice(page, worker, context, testInfo);
    const fresh = await context.newPage();
    await fresh.goto('chrome://newtab/');
    await fresh.waitForSelector('html[data-deck-ready="true"]');
    await expectRecoveredBackup(fresh);
    expect(await readSavedData(fresh)).toEqual(before);
    await expect(
      fresh.locator('[data-deck="toast"][data-kind="error"]'),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

async function launchOlderWorker(testInfo: TestInfo) {
  const extension = testInfo.outputPath('older-worker');
  await cp(resolve('apps/extension/dist'), extension, { recursive: true });
  const setting = /showGoogleSuggestions:\s*\w+\(\)\.default\((?:!0|true)\),?/g;
  const assets = await Promise.all(
    (await readdir(`${extension}/assets`))
      .filter((name) => name.endsWith('.js'))
      .map(async (name) => {
        const path = `${extension}/assets/${name}`;
        return { path, current: await readFile(path, 'utf8') };
      }),
  );
  const candidates = assets.filter(({ current }) => current.match(setting));
  expect(candidates).toHaveLength(1);
  const validator = candidates[0];
  if (!validator) throw new Error('Settings validator chunk not found');
  const { path, current } = validator;
  expect(current.match(setting)).toHaveLength(1);
  await writeFile(path, current.replace(setting, ''));
  const context = await launchExtension(extension);
  try {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    await manager.locator('#devMode').click();
    await expect(manager.locator('#devMode')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await manager.close();
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await expect
      .poll(() =>
        worker.evaluate(
          async () =>
            (await chrome.storage.local.get('backupMaintenanceError'))
              .backupMaintenanceError?.message,
        ),
      )
      .toContain('showGoogleSuggestions');
    // The old worker keeps its imported validator while new tabs read current files.
    await writeFile(path, current);
    return { context, worker };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function reloadFromNotice(
  page: Page,
  worker: Worker,
  context: BrowserContext,
  testInfo: TestInfo,
) {
  const errors = page.locator('[data-deck="toast"][data-kind="error"]');
  await expect(errors).toHaveCount(1);
  const reload = errors.getByRole('button', {
    name: 'Reload Deck',
    exact: true,
  });
  await expect(reload).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await errors.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
  await page.screenshot({ path: testInfo.outputPath('reload-offer.png') });
  const stopped = worker.waitForEvent('close');
  const restarted = context.waitForEvent(
    'serviceworker',
    (next) => next !== worker,
  );
  await reload.focus();
  await reload.press('Enter');
  await Promise.all([stopped, restarted]);
}

async function expectRecoveredBackup(page: Page) {
  const outcome = await page.evaluate(async (type) => {
    const reply = await chrome.runtime.sendMessage({ type });
    const stored = await chrome.storage.local.get([
      'backupMaintenanceError',
      'deckLatestSnapshot',
    ]);
    return {
      error: reply.error,
      failure: stored.backupMaintenanceError ?? null,
      enabled: JSON.parse(stored.deckLatestSnapshot.blob).settings
        .showGoogleSuggestions,
    };
  }, MAINTENANCE_MESSAGE);
  expect(outcome).toEqual({ error: null, failure: null, enabled: false });
}

async function readSavedData(page: Page, shouldSetOff = false) {
  return page.evaluate(
    async ({ setOff, defaults }) => {
      const request = indexedDB.open('deck');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const tx = database.transaction(
          ['pages', 'decks', 'cards', 'meta'],
          setOff ? 'readwrite' : 'readonly',
        );
        const settingsRequest = tx.objectStore('meta').get('settings');
        settingsRequest.onsuccess = () => {
          if (setOff)
            tx.objectStore('meta').put({
              key: 'settings',
              value: {
                ...(settingsRequest.result?.value ?? defaults),
                showGoogleSuggestions: false,
              },
            });
        };
        const records = ['pages', 'decks', 'cards'].map((store) =>
          tx.objectStore(store).getAll(),
        );
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
        return {
          records: records.map((request) => request.result),
          settings: {
            ...(settingsRequest.result?.value ?? defaults),
            ...(setOff ? { showGoogleSuggestions: false } : {}),
          },
        };
      } finally {
        database.close();
      }
    },
    { setOff: shouldSetOff, defaults: SETTINGS_DEFAULTS },
  );
}
