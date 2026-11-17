import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { launchExtension } from './extension';
import { localSite } from './localSite';

const test = localSite(
  () => '<title>Saved link</title><p>Local saved link</p>',
);
const READY = 'html[data-deck-ready="true"]';

async function seed(page: Page, url: string) {
  await page.evaluate(async (url) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(['pages', 'decks', 'cards'], 'readwrite');
    const common = { order: 'a0', createdAt: 1, updatedAt: 1, deletedAt: null };
    tx.objectStore('pages').put({
      ...common,
      id: 'page_other',
      title: 'Other',
    });
    tx.objectStore('decks').put({
      ...common,
      id: 'deck_other',
      pageId: 'page_other',
      title: 'Reading',
      kind: 'normal',
      color: null,
      isCollapsed: false,
    });
    tx.objectStore('cards').put({
      ...common,
      id: 'saved_existing',
      deckId: 'deck_other',
      title: 'Existing',
      url,
      hostname: new URL(url).hostname,
      pinned: false,
      lastOpenedAt: null,
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, url);
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('cards');
    const records = await new Promise<
      {
        id: string;
        url?: string;
        lastOpenedAt: number | null;
        pinned: boolean;
      }[]
    >((resolve, reject) => {
      const request = tx.objectStore('cards').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return records;
  });
}

test('manual pin detects another page before writing, preserves drafts and opens the current saved URL', async ({
  siteOrigin,
}) => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page, `${siteOrigin}/saved`);
    const before = await stored(page);
    await page.getByRole('button', { name: 'Add pin', exact: true }).click();
    const form = page.locator('[data-deck="pin-add-form"]');
    await form
      .getByRole('textbox', { name: 'Paste a URL' })
      .fill(`${siteOrigin}/folder/../saved`);
    await form.locator('.deck-pin-label-input').fill('My draft');
    await form.getByRole('textbox', { name: 'Paste a URL' }).press('Enter');
    const notice = form.locator('[data-deck="duplicate-link"]');
    await expect(notice).toContainText('Already saved in Other › Reading.');
    expect(await stored(page)).toEqual(before);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-deck="pin-add-form"]')
          .analyze()
      ).violations,
    ).toEqual([]);
    // The persisted URL may change while this duplicate message remains open.
    await seed(page, `${siteOrigin}/current`);
    const opened = context.waitForEvent('page');
    await notice
      .getByRole('button', { name: 'Open saved link' })
      .press('Enter');
    const target = await opened;
    await target.waitForURL(`${siteOrigin}/current`);
    await expect(
      target.getByText('Local saved link', { exact: true }),
    ).toBeVisible();
    await target.close();
    await page.bringToFront();
    await expect(form.locator('.deck-pin-label-input')).toHaveValue('My draft');
    expect(
      (await stored(page)).find(({ id }) => id === 'saved_existing')
        ?.lastOpenedAt,
    ).toBeGreaterThan(0);
    await form
      .getByRole('textbox', { name: 'Paste a URL' })
      .fill(`${siteOrigin}/distinct?x=1#part`);
    await expect(notice).toHaveCount(0);
    await form.getByRole('button', { name: 'Add pin', exact: true }).click();
    await expect(form).toHaveCount(0);
    expect((await stored(page)).filter(({ pinned }) => pinned)).toHaveLength(1);
    await page.reload();
    await page.waitForSelector(READY);
    await expect(page.locator('[data-deck="pin"]')).toHaveAttribute(
      'href',
      `${siteOrigin}/distinct?x=1#part`,
    );
  } finally {
    await context.close();
  }
});

test('manual deck link detects another page without writing and accepts a distinct address', async ({
  siteOrigin,
}) => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page, `${siteOrigin}/saved`);
    const before = await stored(page);
    await page.keyboard.press('Control+J');
    await page.locator('[data-deck="add-card"]').first().click();
    const input = page.getByRole('textbox', {
      name: 'Paste a URL',
      exact: true,
    });
    await input.fill(`${siteOrigin}/./saved`);
    await input.press('Enter');
    const notice = page.locator('[data-deck="duplicate-link"]');
    await expect(notice).toContainText('Other › Reading');
    await expect(input).toHaveValue(`${siteOrigin}/./saved`);
    await expect(input).toBeFocused();
    expect(await stored(page)).toEqual(before);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-deck="duplicate-link"]')
          .analyze()
      ).violations,
    ).toEqual([]);
    await input.fill(`${siteOrigin}/saved?distinct=1`);
    await expect(notice).toHaveCount(0);
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    expect(await stored(page)).toHaveLength(before.length + 1);
    await page.reload();
    await page.waitForSelector(READY);
    expect(
      (await stored(page)).some(
        ({ url }) => url === `${siteOrigin}/saved?distinct=1`,
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});

test('a failed deck duplicate read keeps the URL and reports the error', async ({
  siteOrigin,
}) => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await page.keyboard.press('Control+J');
    await page.locator('[data-deck="add-card"]').first().click();
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (...args) {
        if (this.name === 'cards') throw new Error('Duplicate lookup failed');
        return original.apply(this, args);
      };
    });
    const input = page.getByRole('textbox', {
      name: 'Paste a URL',
      exact: true,
    });
    await input.fill(`${siteOrigin}/new`);
    await input.press('Enter');
    await expect(page.getByRole('alert')).toContainText(
      'Duplicate lookup failed',
    );
    await expect(input).toHaveValue(`${siteOrigin}/new`);
    await expect(input).toBeEditable();
  } finally {
    await context.close();
  }
});

test('duplicate pin notice fits narrow Day/Night and 200 percent browser zoom', async ({
  siteOrigin,
}) => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page, `${siteOrigin}/saved`);
    const extensionPage = await page.evaluate(() =>
      chrome.runtime.getURL('src/newtab/index.html'),
    );
    await page.goto(extensionPage);
    await page.waitForSelector(READY);
    await page.getByRole('button', { name: 'Add pin', exact: true }).click();
    const form = page.locator('[data-deck="pin-add-form"]');
    await form
      .getByRole('textbox', { name: 'Paste a URL' })
      .fill(`${siteOrigin}/saved`);
    await form.getByRole('textbox', { name: 'Paste a URL' }).press('Enter');
    const action = form.getByRole('button', { name: 'Open saved link' });
    await expect(action).toBeVisible();
    for (const theme of ['day', 'night']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.setViewportSize({ width: 320, height: 568 });
      await action.focus();
      await expect(action).toBeInViewport();
      await page.screenshot({
        path: `docs/artifacts/manual-duplicates-20261112/${theme}-320.png`,
        animations: 'disabled',
      });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    const ratio = await page.evaluate(() => devicePixelRatio);
    await page.evaluate(() => chrome.tabs.setZoom(2));
    await expect
      .poll(() => page.evaluate(() => devicePixelRatio))
      .toBe(ratio * 2);
    await form.locator('.deck-pin-url-input').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(action).toBeFocused();
    await expect(action).toBeInViewport();
    const bounds = await action.boundingBox();
    const panel = await form.boundingBox();
    if (!bounds || !panel) throw new Error('Missing zoomed form geometry');
    const geometry = await form.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollTop: element.scrollTop,
      rows: getComputedStyle(element).gridTemplateRows,
      children: [
        ...element.querySelectorAll(
          'input, button, [data-deck="duplicate-link"], p',
        ),
      ].map((child) => ({
        tag: child.tagName,
        height: child.getBoundingClientRect().height,
        top: child.getBoundingClientRect().top,
      })),
    }));
    expect(
      bounds.y + bounds.height,
      JSON.stringify(geometry),
    ).toBeLessThanOrEqual(panel.y + panel.height);
    await page.screenshot({
      path: 'docs/artifacts/manual-duplicates-20261112/zoom-200.png',
      animations: 'disabled',
    });
  } finally {
    await context.close();
  }
});
