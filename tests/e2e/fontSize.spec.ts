import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchExtension } from './extension';
import { SETTINGS_DEFAULTS } from '../../packages/schema/src/constants';

const READY = 'html[data-deck-ready="true"]';
const SELECT = '[data-deck="font-size-select"]';

async function settings(page: Page) {
  const line = page.locator('[data-deck="line"] input');
  await line.fill('>settings');
  await line.press('Enter');
  await expect(
    page.getByRole('combobox', { name: 'Text size', exact: true }),
  ).toBeVisible();
}

async function selectSize(page: Page, size: string) {
  await page.locator(SELECT).selectOption(size);
  await expect(page.locator('html')).toHaveAttribute('data-font-size', size);
}

async function seed(page: Page) {
  await page.evaluate(async (defaults) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          ['pages', 'decks', 'cards', 'meta'],
          'readwrite',
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        const request = tx.objectStore('pages').getAll();
        request.onsuccess = () => {
          const base = {
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deletedAt: null,
          };
          tx.objectStore('decks').put({
            ...base,
            id: 'font_deck',
            pageId: request.result[0].id,
            title: 'Readable saved links',
            kind: 'normal',
            order: 'a1',
            color: null,
            isCollapsed: false,
          });
          const card = {
            ...base,
            deckId: 'font_deck',
            hostname: 'font.example',
            pinned: false,
            lastOpenedAt: null,
          };
          tx.objectStore('cards').put({
            ...card,
            id: 'font_link',
            order: 'a0',
            title:
              'A long saved link title remains available when the text is enlarged',
            url: 'https://font.example/',
          });
          tx.objectStore('cards').put({
            ...card,
            id: 'font_task',
            kind: 'task',
            order: 'a1',
            hostname: '',
            done: false,
            title:
              'A long task wraps without hiding its completion, focus or delete controls at larger text sizes',
          });
          tx.objectStore('cards').put({
            ...card,
            id: 'font_pin',
            order: 'a2',
            pinned: true,
            title: 'A readable pin',
            url: 'https://pin.example/',
          });
          tx.objectStore('cards').put({
            ...card,
            id: 'font_inbox',
            deckId: 'deck_inbox',
            order: 'a3',
            title: 'Readable Inbox link',
            url: 'https://inbox.example/',
          });
          tx.objectStore('cards').put({
            ...card,
            id: 'font_trash',
            order: 'a4',
            deletedAt: Date.now(),
            title: 'Readable deleted link',
            url: 'https://trash.example/',
          });
        };
        tx.objectStore('meta').put({
          key: 'settings',
          value: { ...defaults, showShelf: true, shelfDeckIds: ['font_deck'] },
        });
      });
    } finally {
      db.close();
    }
  }, SETTINGS_DEFAULTS);
  await page.reload();
  await page.waitForSelector(READY);
}

async function settledDrawer(page: Page) {
  const drawer = page.locator('[data-deck="drawer"]');
  await expect(drawer).toHaveAttribute('data-open', 'true');
  await expect
    .poll(() =>
      drawer.evaluate((element) =>
        element
          .getAnimations()
          .some((animation) => animation.playState === 'running'),
      ),
    )
    .toBe(false);
}

async function bounds(page: Page, targets: Locator, container: Locator) {
  expect(await targets.count()).toBeGreaterThan(0);
  for (const target of await targets.all()) {
    if (!(await target.isVisible())) continue;
    await target.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(target).toBeFocused();
    await target.evaluate((element) =>
      element.scrollIntoView({ block: 'center', inline: 'nearest' }),
    );
    const b = await target.boundingBox();
    const c = await container.boundingBox();
    if (!b || !c) throw new Error('Missing control bounds');
    expect(b.width).toBeGreaterThanOrEqual(24);
    expect(b.height).toBeGreaterThanOrEqual(24);
    expect(b.x).toBeGreaterThanOrEqual(c.x);
    expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width);
    expect(b.y).toBeGreaterThanOrEqual(c.y);
    expect(b.y + b.height).toBeLessThanOrEqual(c.y + c.height);
  }
}

async function noDocumentScroll(page: Page) {
  expect(
    await page.evaluate(() => ({
      width: document.documentElement.scrollWidth <= innerWidth,
      height: document.documentElement.scrollHeight <= innerHeight,
    })),
  ).toEqual({ width: true, height: true });
}

test('default parity, exact type scale, reload and actual JSON restore', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    await page.evaluate(() => document.fonts.ready);
    const geometry = () => page.locator('[data-deck="line"]').boundingBox();
    const original = await geometry();
    const bodyFont = () =>
      page
        .locator('body')
        .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    const originalFont = await bodyFont();
    await settings(page);
    await expect(page.locator(SELECT)).toHaveValue('default');
    for (const [size, scale] of [
      ['large', 1.125],
      ['extra-large', 1.25],
      ['default', 1],
    ] as const) {
      await selectSize(page, size);
      expect(await bodyFont()).toBe(originalFont * scale);
      await page.reload();
      await page.waitForSelector(READY);
      expect(await bodyFont()).toBe(originalFont * scale);
      await settings(page);
      await expect(page.locator(SELECT)).toHaveValue(size);
    }
    await page.keyboard.press('Escape');
    expect(await geometry()).toEqual(original);
    await settings(page);
    await selectSize(page, 'extra-large');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export data', exact: true }).click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('Missing JSON export');
    const json = await readFile(path, 'utf8');
    expect(JSON.parse(json).settings.fontSize).toBe('extra-large');
    await selectSize(page, 'default');
    await page.getByLabel('Import data', { exact: true }).setInputFiles({
      name: 'text-size.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    const preview = page.locator('[data-deck="data-import-preview"]');
    await preview.getByRole('button', { name: 'Replace', exact: true }).click();
    await preview.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-font-size',
      'extra-large',
    );
    await page.reload();
    await page.waitForSelector(READY);
    expect(await bodyFont()).toBe(originalFont * 1.25);
    await settings(page);
    await expect(page.locator(SELECT)).toHaveValue('extra-large');
  } finally {
    await context.close();
  }
});

test('native keys and failed writes preserve the prior size until retry', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await settings(page);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        ...args: Parameters<IDBObjectStore['put']>
      ) {
        if (this.name === 'meta' && args[0]?.key === 'settings') {
          IDBObjectStore.prototype.put = put;
          throw new Error('Text size write failed');
        }
        return put.apply(this, args);
      };
    });
    const select = page.locator(SELECT);
    await select.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Text size write failed' }),
    ).toBeVisible();
    await expect(select).toHaveValue('default');
    await expect(page.locator('html')).toHaveAttribute(
      'data-font-size',
      'default',
    );
    await select.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await expect(select).toHaveValue('large');
    await expect(page.locator('html')).toHaveAttribute(
      'data-font-size',
      'large',
    );
  } finally {
    await context.close();
  }
});

for (const size of ['large', 'extra-large']) {
  for (const layout of ['desktop', 'tablet', 'narrow', 'short', 'zoom']) {
    test(`${size} keeps settings, surface, links and tasks accessible in ${layout}`, async ({
      browserName,
    }, testInfo) => {
      expect(browserName).toBe('chromium');
      const context = await launchExtension();
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto('chrome://newtab/');
        await page.waitForSelector(READY);
        await seed(page);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        if (layout === 'zoom') {
          const url = await page.evaluate(() =>
            chrome.runtime.getURL('src/newtab/index.html'),
          );
          await page.goto(`${url}?font-size-zoom`);
          await page.waitForSelector(READY);
          await page.setViewportSize({ width: 1280, height: 1200 });
          const ratio = await page.evaluate(() => devicePixelRatio);
          await page.evaluate(async () => {
            const tab = await chrome.tabs.getCurrent();
            if (tab?.id === undefined) throw new Error('Missing tab');
            await chrome.tabs.setZoom(tab.id, 2);
          });
          await expect
            .poll(() => page.evaluate(() => devicePixelRatio))
            .toBe(ratio * 2);
        } else
          await page.setViewportSize({
            width:
              { desktop: 1440, tablet: 768, narrow: 320, short: 640 }[layout] ??
              1440,
            height: layout === 'short' ? 360 : 900,
          });
        await settings(page);
        await page
          .getByRole('group', { name: 'Theme', exact: true })
          .getByRole('button', {
            name: layout === 'narrow' || layout === 'zoom' ? 'Day' : 'Night',
            exact: true,
          })
          .click();
        await selectSize(page, size);
        await bounds(
          page,
          page.locator(SELECT),
          page.locator('[data-deck="settings"]'),
        );
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-deck="settings"]')
              .analyze()
          ).violations,
        ).toEqual([]);
        await expect(page.locator('[data-deck="toast"]')).toHaveCount(0);
        await page.screenshot({
          path: testInfo.outputPath('settings.png'),
          animations: 'disabled',
        });
        await page.keyboard.press('Escape');
        await noDocumentScroll(page);
        await bounds(
          page,
          page.locator(
            '[data-deck="settings-toggle"], [data-deck="line"] input, [data-deck="pin"], [data-deck="section-nav"] button',
          ),
          page.locator('[data-deck="surface"]'),
        );
        await page.screenshot({
          path: testInfo.outputPath('surface.png'),
          animations: 'disabled',
        });
        await page.keyboard.press('Control+J');
        await settledDrawer(page);
        await bounds(
          page,
          page.locator('[data-card-id="font_link"]').locator('button,a'),
          page.locator('[data-deck="decks"]'),
        );
        await page
          .locator('[data-deck="drawer"]')
          .getByRole('button', { name: 'Tasks', exact: true })
          .click();
        await bounds(
          page,
          page.locator('[data-task-id="font_task"] button'),
          page.locator('[data-deck="task-manager"]'),
        );
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-deck="task-manager"]')
              .analyze()
          ).violations,
        ).toEqual([]);
        await noDocumentScroll(page);
        await page.screenshot({
          path: testInfo.outputPath('tasks.png'),
          animations: 'disabled',
        });
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}

test('extra large and comfortable keep Shelf, Inbox and Trash controls reachable', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    await page.setViewportSize({ width: 320, height: 720 });
    await settings(page);
    await selectSize(page, 'extra-large');
    await page
      .locator('[data-deck="density-select"]')
      .selectOption('comfortable');
    await expect(page.locator('html')).toHaveAttribute(
      'data-density',
      'comfortable',
    );
    await page.keyboard.press('Escape');
    await page
      .locator('[data-deck="shelf-toggle"]')
      .filter({ hasText: 'Readable saved links' })
      .click();
    await bounds(
      page,
      page.locator('[data-deck="shelf-card"]').first().locator('a,button'),
      page.locator('[data-deck="shelf"]'),
    );
    await page.keyboard.press('Control+J');
    await settledDrawer(page);
    const drawer = page.locator('[data-deck="drawer"]');
    await drawer.getByRole('button', { name: 'Inbox', exact: true }).click();
    await bounds(
      page,
      page.locator('[data-deck="inbox"]').getByRole('listbox'),
      page.locator('[data-deck="inbox"]'),
    );
    await page.keyboard.press('Home');
    await expect(
      page.locator('[data-deck="inbox"]').getByRole('listbox'),
    ).toHaveAttribute('aria-activedescendant', 'deck-inbox-font_inbox');
    await drawer.getByRole('button', { name: 'Trash', exact: true }).click();
    await bounds(
      page,
      page
        .locator('[data-deck="trash-item"]')
        .filter({ hasText: 'Readable deleted link' })
        .locator('button'),
      page.locator('[data-deck="trash"]'),
    );
    await noDocumentScroll(page);
  } finally {
    await context.close();
  }
});
