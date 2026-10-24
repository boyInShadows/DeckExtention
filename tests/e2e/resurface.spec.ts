import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { launchExtension } from './extension';
import { expectWithinBudget } from './coverage';
import { SETTINGS_DEFAULTS } from '../../packages/schema/src/settings';
import { writeFile } from 'node:fs/promises';

const READY = 'html[data-deck-ready="true"]';
const DAY_MS = 86_400_000;
const NOW = new Date(2026, 9, 17, 12).getTime();

async function readCards(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('deck');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const query = database.transaction('cards').objectStore('cards').getAll();
      return await new Promise<
        {
          id: string;
          url: string;
          reviewedAt?: number;
          lastOpenedAt: number | null;
          deletedAt: number | null;
        }[]
      >((resolve, reject) => {
        query.onsuccess = () => resolve(query.result);
        query.onerror = () => reject(query.error);
      });
    } finally {
      database.close();
    }
  });
}

async function seed(page: Page) {
  await page.evaluate(
    async ({ time, dayMs, settings }) => {
      const request = indexedDB.open('deck');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = database.transaction(
        ['pages', 'decks', 'cards', 'meta'],
        'readwrite',
      );
      const base = { createdAt: 1, updatedAt: time, deletedAt: null };
      tx.objectStore('pages').put({
        ...base,
        id: 'page_review',
        title: 'Reading',
        order: 'b0',
      });
      for (const kind of ['normal', 'session'])
        tx.objectStore('decks').put({
          ...base,
          id: `deck_review_${kind}`,
          pageId: 'page_review',
          title: kind,
          kind,
          order: 'a0',
          color: null,
          isCollapsed: false,
        });
      const variants = [
        { id: 'review_a', title: 'The art of noticing the small things' },
        { id: 'review_b', title: 'A field guide to deep reading' },
        { id: 'review_c', title: 'Designing a quieter workspace' },
        { id: 'review_recent', createdAt: time - 59 * dayMs },
        { id: 'review_opened', lastOpenedAt: 1 },
        { id: 'review_pin', pinned: true },
        { id: 'review_session', deckId: 'deck_review_session' },
        { id: 'review_trash', deletedAt: 1 },
        { id: 'review_kept', reviewedAt: 1 },
      ];
      for (const item of variants)
        tx.objectStore('cards').put({
          ...base,
          deckId: 'deck_review_normal',
          title: item.id,
          url: `http://resurface.test/${item.id}`,
          hostname: 'resurface.test',
          createdAt: time - 90 * dayMs,
          order: 'a0',
          pinned: false,
          lastOpenedAt: null,
          ...item,
        });
      tx.objectStore('meta').delete('resurface');
      tx.objectStore('meta').put({
        key: 'settings',
        value: { ...settings, showResurface: true, showSeconds: true },
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      });
      database.close();
    },
    { time: NOW, dayMs: DAY_MS, settings: SETTINGS_DEFAULTS },
  );
  await page.reload();
  await page.waitForSelector(READY);
}

test('Resurface: one daily link across tabs, five-second Keep, tomorrow, Open, recoverable Trash and opt-out', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(90_000);
  const context = await launchExtension();
  try {
    await context.route('http://resurface.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>A saved link</title>',
      }),
    );
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(NOW));
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    const panel = page.locator('[data-deck="resurface"]');
    await expect(panel).toBeVisible();
    const selectedId = await panel.getAttribute('data-deck-id');
    expect(['review_a', 'review_b', 'review_c']).toContain(selectedId);
    const originalCount = (await readCards(page)).length;

    for (const { theme, width, height } of [
      { theme: 'night', width: 1280, height: 800 },
      { theme: 'day', width: 640, height: 900 },
      { theme: 'day', width: 375, height: 812 },
      { theme: 'night', width: 640, height: 600 },
    ]) {
      await page.getByLabel('Settings', { exact: true }).click();
      await page
        .getByRole('button', {
          name: theme === 'day' ? 'Day' : 'Night',
          exact: true,
        })
        .click();
      await page.getByLabel('Close settings', { exact: true }).click();
      await expect(page.locator('[data-deck="toast"]')).toHaveCount(0);
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
      if (width < 900) {
        const clock = await page.locator('[data-deck="clock"]').boundingBox();
        const rail = await page
          .locator('[data-deck="section-nav"]')
          .boundingBox();
        if (!clock || !rail)
          throw new Error('Missing clock or navigation bounds');
        expect(clock.y).toBeGreaterThanOrEqual(rail.y + rail.height);
      }
      await panel.scrollIntoViewIfNeeded();
      const bounds = await panel.boundingBox();
      const pins = await page.locator('[data-deck="pins"]').boundingBox();
      expect(bounds).not.toBeNull();
      if (!bounds || !pins) throw new Error('Missing review or Pins bounds');
      const navigation = await page
        .locator('[data-deck="section-nav"]')
        .boundingBox();
      if (!navigation) throw new Error('Missing section navigation bounds');
      expect(
        bounds.x >= navigation.x + navigation.width ||
          bounds.x + bounds.width <= navigation.x ||
          bounds.y >= navigation.y + navigation.height ||
          bounds.y + bounds.height <= navigation.y,
      ).toBe(true);
      expect(bounds.y).toBeGreaterThan(pins.y + pins.height);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      expect(
        await panel.locator('button').evaluateAll((buttons) =>
          buttons.every((button) => {
            const box = button.getBoundingClientRect();
            return button.contains(
              document.elementFromPoint(
                box.x + box.width / 2,
                box.y + box.height / 2,
              ),
            );
          }),
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`resurface-${theme}-${width}-${height}.png`),
      });
      const axe = await new AxeBuilder({ page })
        .include('[data-deck="resurface"]')
        .analyze();
      expect(
        axe.violations.filter((issue) =>
          ['serious', 'critical'].includes(issue.impact ?? ''),
        ),
      ).toEqual([]);
      await page.locator('[data-deck="surface"]').evaluate((surface) => {
        (surface as HTMLElement).dataset.brightWallpaper = 'true';
      });
      const brightAxe = await new AxeBuilder({ page })
        .include('[data-deck="resurface"]')
        .analyze();
      expect(
        brightAxe.violations.filter((issue) =>
          ['serious', 'critical'].includes(issue.impact ?? ''),
        ),
      ).toEqual([]);
      await page.locator('[data-deck="surface"]').evaluate((surface) => {
        delete (surface as HTMLElement).dataset.brightWallpaper;
      });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    const start = Date.now();
    await page.locator('[data-deck="resurface-keep"]').focus();
    await page.keyboard.press('Enter');
    await expect(panel).toHaveCount(0);
    const keepMs = Date.now() - start;
    expectWithinBudget('Resurface Keep ms', keepMs, { max: 5000 });
    await writeFile(
      testInfo.outputPath('resurface-timing.json'),
      JSON.stringify({ keepMs }),
    );
    await testInfo.attach('resurface-timing.json', {
      body: JSON.stringify({ keepMs }),
      contentType: 'application/json',
    });
    expect(
      (await readCards(page)).find(({ id }) => id === selectedId),
    ).toMatchObject({ reviewedAt: NOW, lastOpenedAt: null, deletedAt: null });
    expect(
      await page.evaluate(() =>
        chrome.permissions.contains({ permissions: ['tabs'] }),
      ),
    ).toBe(false);
    await page.reload();
    await page.waitForSelector(READY);
    await expect(panel).toHaveCount(0);
    const other = await context.newPage();
    await other.goto('chrome://newtab/');
    await other.waitForSelector(READY);
    await expect(other.locator('[data-deck="resurface"]')).toHaveCount(0);
    await other.close();
    await page.bringToFront();

    await page.clock.setFixedTime(new Date(NOW + DAY_MS));
    await expect(panel).toBeVisible();
    const dismissedId = await panel.getAttribute('data-deck-id');
    expect(dismissedId).not.toBe(selectedId);
    await page.getByLabel('Dismiss until tomorrow').click();
    await expect(panel).toHaveCount(0);
    expect(
      (await readCards(page)).find(({ id }) => id === dismissedId),
    ).toMatchObject({ lastOpenedAt: null, deletedAt: null });
    await page.reload();
    await page.waitForSelector(READY);
    await expect(panel).toHaveCount(0);

    await page.clock.setFixedTime(new Date(NOW + 2 * DAY_MS));
    await expect(panel).toBeVisible();
    const openedId = await panel.getAttribute('data-deck-id');
    const savedLink = (await readCards(page)).find(({ id }) => id === openedId);
    if (!savedLink) throw new Error('Missing chosen link');
    await page.locator('[data-deck="resurface-open"]').click();
    await expect
      .poll(() => context.pages().some((tab) => tab.url() === savedLink.url))
      .toBe(true);
    expect(
      (await readCards(page)).find(({ id }) => id === openedId)?.lastOpenedAt,
    ).toBe(NOW + 2 * DAY_MS);
    const opened = context.pages().find((tab) => tab.url() === savedLink.url);
    await opened?.close();
    await page.bringToFront();

    await page.clock.setFixedTime(new Date(NOW + 3 * DAY_MS));
    await expect(panel).toBeVisible();
    const trashedId = await panel.getAttribute('data-deck-id');
    await page.locator('[data-deck="resurface-trash"]').click();
    await expect(panel).toHaveCount(0);
    expect(
      (await readCards(page)).find(({ id }) => id === trashedId)?.deletedAt,
    ).toBe(NOW + 3 * DAY_MS);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await readCards(page)).find(({ id }) => id === trashedId)?.deletedAt,
      )
      .toBeNull();
    await expect(panel).toHaveCount(0);

    await page.clock.setFixedTime(new Date(NOW + 4 * DAY_MS));
    await expect(panel).toBeVisible();
    await page.getByLabel('Settings', { exact: true }).click();
    await page.getByLabel('Resurface an unread link each day').uncheck();
    await page.getByLabel('Close settings', { exact: true }).click();
    await expect(panel).toHaveCount(0);
    await page.reload();
    await page.waitForSelector(READY);
    await expect(panel).toHaveCount(0);
    await page.getByLabel('Settings', { exact: true }).click();
    await expect(
      page.getByLabel('Resurface an unread link each day'),
    ).not.toBeChecked();
    await page.getByLabel('Resurface an unread link each day').check();
    await page.getByLabel('Close settings', { exact: true }).click();
    await expect(panel).toBeVisible();
    expect((await readCards(page)).length).toBe(originalCount);
  } finally {
    await context.close();
  }
});
