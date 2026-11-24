import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { SETTINGS_DEFAULTS } from '../../packages/schema/src/constants';
import { launchExtension } from './extension';
import { readFile } from 'node:fs/promises';

async function seedPersian(page: Page) {
  await page.evaluate(async (defaults) => {
    const request = indexedDB.open('deck');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(['meta', 'cards'], 'readwrite');
      const settings = transaction.objectStore('meta').get('settings');
      settings.onsuccess = () =>
        transaction.objectStore('meta').put({
          key: 'settings',
          value: {
            ...(settings.result?.value ?? defaults),
            language: 'fa',
            showGoogleSuggestions: false,
          },
        });
      const cards = transaction.objectStore('cards').getAll();
      cards.onsuccess = () => {
        for (const card of cards.result.slice(0, 2)) {
          transaction
            .objectStore('cards')
            .put({ ...card, pinned: true, deckId: 'deck_inbox' });
        }
      };
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, SETTINGS_DEFAULTS);
  await page.reload();
  await expect(
    page.locator('html[data-deck-ready="true"][lang="fa"][dir="rtl"]'),
  ).toHaveCount(1);
}

async function expectLocalFont(page: Page) {
  const fonts = await page.evaluate(async () => {
    const loaded = await document.fonts.load('1rem Vazirmatn', 'سلام');
    return {
      count: loaded.length,
      status: loaded.every((font) => font.status === 'loaded'),
      family: getComputedStyle(document.body).fontFamily,
    };
  });
  expect(fonts.count).toBeGreaterThan(0);
  expect(fonts.status).toBe(true);
  expect(fonts.family).toContain('Vazirmatn');
}

async function reorderRtlPins(page: Page) {
  const pins = page.locator('[data-deck="pin"]');
  await expect(pins).toHaveCount(2);
  const first = await pins.nth(0).boundingBox();
  const second = await pins.nth(1).boundingBox();
  expect(first && second && first.x > second.x).toBe(true);
  await pins.nth(0).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(pins.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(pins.nth(0)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(pins.nth(0)).toHaveAttribute('data-dragging', 'true');
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText('روی مقصد');
  const beforeOrder = await pins.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href')),
  );
  const announcement = page.locator('[id^="DndLiveRegion"]');
  const beforeMove = await announcement.textContent();
  await page.keyboard.press('ArrowLeft');
  await expect(announcement).not.toHaveText(beforeMove ?? '');
  await expect(announcement).toContainText('روی مقصد');
  await page.keyboard.press('Space');
  await expect
    .poll(() =>
      pins.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('href')),
      ),
    )
    .toEqual([...beforeOrder].reverse());
}

async function checkRtlPinMenu(page: Page) {
  const pin = page.locator('[data-deck="pin"]').first();
  await pin.press('ContextMenu');
  const items = page.locator('[data-deck="pin-menu"]').getByRole('menuitem');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pin).toBeFocused();
}

test('Persian saved settings render local fonts, translated panels and physical RTL pin keys', async () => {
  const testInfo = test.info();
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    await seedPersian(page);
    await expect(page.locator('[data-deck="line"] input')).toHaveAttribute(
      'placeholder',
      'جست‌وجو کنید یا > بنویسید',
    );
    await expectLocalFont(page);
    await reorderRtlPins(page);
    await checkRtlPinMenu(page);
    await page.screenshot({ path: testInfo.outputPath('surface-fa.png') });
    await page.locator('[data-deck="settings-toggle"]').click();
    await expect(
      page.getByRole('heading', { name: 'تنظیمات', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'شب', exact: true }),
    ).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      violations.filter(
        ({ impact, id }) =>
          impact === 'serious' ||
          impact === 'critical' ||
          id === 'label-content-name-mismatch',
      ),
    ).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('settings-fa.png') });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

async function exportPersianBackup(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'خروجی داده', exact: true }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('JSON export missing');
  const json = await readFile(path, 'utf8');
  expect(JSON.parse(json).settings.language).toBe('fa');
  return json;
}

async function selectLanguage(page: Page, language: 'en' | 'fa') {
  await page.locator('[data-deck="language-select"]').selectOption(language);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}

test('language selection updates the open UI, persists and round-trips a real JSON backup', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    const fontRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('vazirmatn')) fontRequests.push(request.url());
    });
    await page.goto('chrome://newtab/#settings');
    await page.waitForSelector('html[data-deck-ready="true"]');
    const language = page.locator('[data-deck="language-select"]');
    await expect(language).toHaveValue('en');
    expect(fontRequests).toEqual([]);
    await selectLanguage(page, 'fa');
    await expect.poll(() => fontRequests.length).toBe(1);
    await expect(page.locator('[id^="DndDescribedBy"]')).toContainText(
      'برای برداشتن',
    );
    await expect(
      page.getByRole('button', { name: 'شب', exact: true }),
    ).toBeVisible();
    await language.selectOption('en');
    await expect(
      page.getByRole('button', { name: 'Night', exact: true }),
    ).toBeVisible();
    await selectLanguage(page, 'fa');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
    await page.locator('[data-deck="settings-toggle"]').click();
    await expect(language).toHaveValue('fa');
    const json = await exportPersianBackup(page);
    await selectLanguage(page, 'en');
    await page.getByLabel('Import data', { exact: true }).setInputFiles({
      name: 'persian-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    const preview = page.locator('[data-deck="data-import-preview"]');
    await preview.getByRole('button', { name: 'Replace', exact: true }).click();
    await preview.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
    await expect(page.locator('[data-deck="settings"]')).toHaveCount(0);
    await page.locator('[data-deck="settings-toggle"]').click();
    await expect(language).toHaveValue('fa');
  } finally {
    await context.close();
  }
});

test('a failed language write keeps English visible and allows a retry', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/#settings');
    await page.waitForSelector('html[data-deck-ready="true"]');
    await page.evaluate(() => {
      const fixture = window as Window & { isLanguageWriteBlocked: boolean };
      fixture.isLanguageWriteBlocked = true;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (
          this.name === 'meta' &&
          (value as { key?: string }).key === 'settings' &&
          fixture.isLanguageWriteBlocked
        ) {
          throw new Error('Fixture language write failed');
        }
        return put.call(this, value, key);
      };
    });
    const language = page.locator('[data-deck="language-select"]');
    await language.selectOption('fa');
    const error = page
      .locator('[data-deck="toast"][role="alert"]')
      .filter({ hasText: 'Fixture language write failed' });
    await expect(error).toBeVisible();
    await expect(language).toHaveValue('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await error.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await page.evaluate(() => {
      (
        window as Window & { isLanguageWriteBlocked: boolean }
      ).isLanguageWriteBlocked = false;
    });
    await language.selectOption('fa');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  } finally {
    await context.close();
  }
});
