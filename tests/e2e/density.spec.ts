import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchExtension } from './extension';
import { SETTINGS_DEFAULTS } from '../../packages/schema/src/constants';

const READY = 'html[data-deck-ready="true"]';
const ROW = '[data-card-id="density_link"]';
const SELECT = '[data-deck="density-select"]';

async function seed(page: Page) {
  await page.evaluate(async (defaults) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('deck');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          ['pages', 'decks', 'cards', 'meta'],
          'readwrite',
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        const pages = tx.objectStore('pages').getAll();
        pages.onsuccess = () => {
          const base = {
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deletedAt: null,
          };
          tx.objectStore('decks').put({
            ...base,
            id: 'density_deck',
            pageId: pages.result[0].id,
            title: 'Density proof',
            kind: 'normal',
            order: 'a1',
            color: null,
            isCollapsed: false,
          });
          const card = {
            ...base,
            deckId: 'density_deck',
            hostname: 'density.example',
            pinned: false,
            lastOpenedAt: null,
          };
          tx.objectStore('cards').put({
            ...card,
            id: 'density_link',
            order: 'a0',
            title:
              'A long saved link title that remains available in both density choices',
            url: 'https://density.example/',
          });
          tx.objectStore('cards').put({
            ...card,
            id: 'density_task',
            order: 'a1',
            kind: 'task',
            hostname: '',
            done: false,
            title:
              'A long task title that must wrap without losing its completion or trash controls',
          });
          tx.objectStore('cards').put({
            ...card,
            id: 'density_inbox',
            deckId: 'deck_inbox',
            order: 'a2',
            title: 'Inbox density proof',
            url: 'https://inbox-density.example/',
          });
          tx.objectStore('cards').put({
            ...card,
            id: 'density_trash',
            order: 'a3',
            title: 'Trash density proof',
            url: 'https://trash-density.example/',
            deletedAt: Date.now(),
          });
        };
        const settings = tx.objectStore('meta').get('settings');
        settings.onsuccess = () =>
          tx.objectStore('meta').put({
            key: 'settings',
            value: {
              ...(settings.result?.value ?? defaults),
              showShelf: true,
              shelfDeckIds: ['density_deck'],
            },
          });
      });
    } finally {
      db.close();
    }
  }, SETTINGS_DEFAULTS);
  await page.reload();
  await page.waitForSelector(READY);
}

async function settings(page: Page) {
  const line = page.locator('[data-deck="line"] input');
  await line.fill('>settings');
  await line.press('Enter');
  await expect(page.locator(SELECT)).toBeVisible();
}

async function setDensity(page: Page, value: string) {
  await settings(page);
  await page.locator(SELECT).selectOption(value);
  await expect(page.locator('html')).toHaveAttribute('data-density', value);
  await checkTargets(
    page,
    page.locator('[data-deck="density-setting"]'),
    page.locator('[data-deck="settings"]'),
  );
  await page.keyboard.press('Escape');
  await expect(page.locator(SELECT)).toHaveCount(0);
}

async function calmGeometry(page: Page) {
  return page.evaluate(() =>
    ['clock', 'line', 'pins'].map((name) => {
      const e = document.querySelector(`[data-deck="${name}"]`);
      if (!e) throw new Error(name);
      const { x, y, width, height } = e.getBoundingClientRect();
      return { name, x, y, width, height };
    }),
  );
}

async function waitForDrawer(page: Page) {
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

async function checkTargets(page: Page, row: Locator, container: Locator) {
  if (
    await container.evaluate((element) =>
      Boolean(element.closest('[data-deck="drawer"]')),
    )
  )
    await waitForDrawer(page);
  const targets = row.locator('button,a,select');
  const minimum = await page.evaluate(
    () => parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.5,
  );
  for (let i = 0; i < (await targets.count()); i++) {
    const target = targets.nth(i);
    if (!(await target.isVisible())) continue;
    await target.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(target).toBeFocused();
    const b = await target.boundingBox();
    const c = await container.boundingBox();
    if (!b || !c) throw new Error('Missing target bounds');
    expect(b.width).toBeGreaterThanOrEqual(minimum);
    expect(b.height).toBeGreaterThanOrEqual(minimum);
    expect(b.x).toBeGreaterThanOrEqual(c.x);
    expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width);
    expect(b.y).toBeGreaterThanOrEqual(c.y);
    expect(b.y + b.height).toBeLessThanOrEqual(c.y + c.height);
  }
}

test('default rows stay compact, comfortable adds space and both choices survive reload', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    await page.evaluate(() => document.fonts.ready);
    const calm = await calmGeometry(page);
    await expect(page.locator('html')).toHaveAttribute(
      'data-density',
      'compact',
    );
    await page.keyboard.press('Control+J');
    const row = page.locator(ROW);
    await expect(row).toBeVisible();
    await expect(row).toHaveCSS('padding-block-start', '0px');
    const compact = await row.boundingBox();
    if (!compact) throw new Error('Missing row');
    await page.keyboard.press('Escape');
    await setDensity(page, 'comfortable');
    await expect(page.locator('[data-deck="surface"]')).not.toHaveAttribute(
      'data-drawer-open',
      'true',
    );
    expect(await calmGeometry(page)).toEqual(calm);
    await page.keyboard.press('Control+J');
    await expect(row).toBeVisible();
    const comfortable = await row.boundingBox();
    if (!comfortable) throw new Error('Missing row');
    expect(comfortable.height).toBeGreaterThan(compact.height);
    await page.reload();
    await page.waitForSelector(READY);
    await expect(page.locator('html')).toHaveAttribute(
      'data-density',
      'comfortable',
    );
    await setDensity(page, 'compact');
    await page.reload();
    await page.waitForSelector(READY);
    await page.keyboard.press('Control+J');
    expect((await row.boundingBox())?.height).toBe(compact.height);
  } finally {
    await context.close();
  }
});

test('density exports and restores through actual JSON replacement import', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await setDensity(page, 'comfortable');
    await settings(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export data', exact: true }).click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('Missing export');
    const json = await readFile(path, 'utf8');
    expect(JSON.parse(json).settings.rowDensity).toBe('comfortable');
    await page.locator(SELECT).selectOption('compact');
    await page.getByLabel('Import data', { exact: true }).setInputFiles({
      name: 'density.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    const preview = page.locator('[data-deck="data-import-preview"]');
    await preview.getByRole('button', { name: 'Replace', exact: true }).click();
    await preview.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-density',
      'comfortable',
    );
  } finally {
    await context.close();
  }
});

for (const density of ['compact', 'comfortable']) {
  for (const layout of ['narrow', 'short', 'zoom']) {
    test(`${density} link/task controls remain reachable in ${layout}`, async ({
      browserName,
    }, testInfo) => {
      expect(browserName).toBe('chromium');
      const context = await launchExtension();
      try {
        const page = await context.newPage();
        await page.goto('chrome://newtab/');
        await page.waitForSelector(READY);
        await seed(page);
        if (layout === 'zoom') {
          const url = await page.evaluate(() =>
            chrome.runtime.getURL('src/newtab/index.html'),
          );
          await page.goto(`${url}?density-zoom`);
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
          await page.setViewportSize(
            layout === 'narrow'
              ? { width: 320, height: 720 }
              : { width: 640, height: 360 },
          );
        await setDensity(page, density);
        await page.keyboard.press('Control+J');
        await checkTargets(
          page,
          page.locator(ROW),
          page.locator('[data-deck="decks"]'),
        );
        await expect(page.locator('[data-deck="toast"]')).toHaveCount(0);
        await page.screenshot({
          path: testInfo.outputPath('links.png'),
          animations: 'disabled',
        });
        await page
          .locator('[data-deck="drawer"]')
          .getByRole('button', { name: 'Tasks', exact: true })
          .click();
        await checkTargets(
          page,
          page.locator('[data-task-id="density_task"]'),
          page.locator('[data-deck="task-manager"]'),
        );
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-deck="task-manager"]')
              .analyze()
          ).violations,
        ).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath('tasks.png'),
          animations: 'disabled',
        });
      } finally {
        await context.close();
      }
    });
  }
}

for (const density of ['compact', 'comfortable']) {
  test(`${density} Shelf, Inbox and Trash rows keep controls accessible in Day`, async () => {
    const context = await launchExtension();
    try {
      const page = await context.newPage();
      await page.goto('chrome://newtab/');
      await page.waitForSelector(READY);
      await seed(page);
      await settings(page);
      await page
        .getByRole('group', { name: 'Theme', exact: true })
        .getByRole('button', { name: 'Day', exact: true })
        .click();
      await page.locator(SELECT).selectOption(density);
      await expect(page.locator('html')).toHaveAttribute(
        'data-density',
        density,
      );
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 320, height: 720 });
      await page
        .locator('[data-deck="shelf-toggle"]')
        .filter({ hasText: 'Density proof' })
        .click();
      await checkTargets(
        page,
        page.locator('[data-deck="shelf-card"]').first(),
        page.locator('[data-deck="shelf"]'),
      );
      await page.keyboard.press('Control+J');
      const drawer = page.locator('[data-deck="drawer"]');
      await drawer.getByRole('button', { name: 'Inbox', exact: true }).click();
      await expect(
        page.locator('[data-deck="inbox"] [data-deck="card"]').first(),
      ).toHaveCSS(
        'padding-block-start',
        density === 'comfortable' ? '8px' : '0px',
      );
      await drawer.getByRole('button', { name: 'Trash', exact: true }).click();
      await checkTargets(
        page,
        page
          .locator('[data-deck="trash-item"]')
          .filter({ hasText: 'Trash density proof' }),
        page.locator('[data-deck="trash"]'),
      );
      await expect(page.locator('[data-deck="toast"]')).toHaveCount(0);
      await page.screenshot({
        path: test.info().outputPath('trash-day.png'),
        animations: 'disabled',
      });
    } finally {
      await context.close();
    }
  });
}

test('density setting supports native keys and write failure leaves the old view until retry', async () => {
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
          throw new Error('Density write failed');
        }
        return put.apply(this, args);
      };
    });
    const select = page.locator(SELECT);
    await select.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Density write failed' }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute(
      'data-density',
      'compact',
    );
    await expect(select).toHaveValue('compact');
    await select.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await expect(page.locator('html')).toHaveAttribute(
      'data-density',
      'comfortable',
    );
  } finally {
    await context.close();
  }
});

test('comfortable spacing keeps keyboard drag ordering durable', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    await setDensity(page, 'comfortable');
    await page.keyboard.press('Control+J');
    const rows = page.locator(
      '[data-deck-id="density_deck"] [data-deck="card"]',
    );
    await waitForDrawer(page);
    await expect(rows).toHaveCount(2);
    await page.locator(`${ROW} [data-deck="card-drag"]`).focus();
    await page.keyboard.press('Space');
    await expect(page.locator(ROW)).toHaveAttribute('data-dragging', 'true');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-card-id="density_task"]')).toHaveAttribute(
      'data-drag-over',
      'true',
    );
    await expect(page.locator('[id^="DndLiveRegion-"]')).toContainText(
      'card:density_task',
    );
    await page.keyboard.press('Space');
    await expect
      .poll(() =>
        rows.evaluateAll((elements) =>
          elements.map((e) => e.getAttribute('data-card-id')),
        ),
      )
      .toEqual(['density_task', 'density_link']);
    await page.reload();
    await page.waitForSelector(READY);
    await page.keyboard.press('Control+J');
    await expect
      .poll(() =>
        rows.evaluateAll((elements) =>
          elements.map((e) => e.getAttribute('data-card-id')),
        ),
      )
      .toEqual(['density_task', 'density_link']);
  } finally {
    await context.close();
  }
});
