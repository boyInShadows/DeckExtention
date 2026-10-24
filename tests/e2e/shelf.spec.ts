import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { launchExtension } from './extension';

const READY = 'html[data-deck-ready="true"]';
const DECK_TITLE = 'Reading and reference material for the next quiet morning';
const CARD_TITLE =
  'A very long saved title that remains readable when the category is expanded in a narrow window';

async function seed(page: Page) {
  await page.evaluate(
    async ({ deckTitle, cardTitle }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('deck');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction(['pages', 'decks', 'cards'], 'readwrite');
      const base = {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      };
      tx.objectStore('pages').put({
        ...base,
        id: 'page_shelf',
        title: 'Work',
        order: 'b0',
      });
      for (const [index, title] of [
        deckTitle,
        'Research',
        'Empty deck',
      ].entries()) {
        tx.objectStore('decks').put({
          ...base,
          id: `deck_shelf_${index}`,
          pageId: 'page_shelf',
          title,
          order: `a${index}`,
          kind: 'normal',
          color: null,
          isCollapsed: false,
        });
      }
      const cards = [
        { id: 'card_shelf', title: cardTitle },
        { id: 'card_shelf_trash', deletedAt: 1 },
        { id: 'card_shelf_pin', pinned: true },
        {
          id: 'task_shelf',
          kind: 'task',
          url: undefined,
          hostname: '',
          title: 'Remember the notebook',
          note: 'A note on the Shelf',
        },
      ];
      for (const [index, card] of cards.entries()) {
        const next = {
          ...base,
          title: card.id,
          deckId: 'deck_shelf_0',
          order: `a${index}`,
          url: 'http://shelf.test/read',
          hostname: 'shelf.test',
          pinned: false,
          lastOpenedAt: null,
          ...card,
        };
        if (next.url === undefined) delete next.url;
        tx.objectStore('cards').put(next);
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { deckTitle: DECK_TITLE, cardTitle: CARD_TITLE },
  );
  await page.reload();
  await page.waitForSelector(READY);
}

async function storedCard(page: Page, note?: string) {
  return page.evaluate(async (text) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(
        'cards',
        text === undefined ? 'readonly' : 'readwrite',
      );
      const store = tx.objectStore('cards');
      const read = store.get('card_shelf');
      const card = await new Promise<{
        id: string;
        note?: string;
        lastOpenedAt: number | null;
      }>((resolve, reject) => {
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
      if (text !== undefined) store.put({ ...card, note: text });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      });
      return card;
    } finally {
      db.close();
    }
  }, note);
}

test('Shelf: opt-in selection, one accordion, native links, Notes, responsive contrast and durable opt-out', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(120_000);
  const context = await launchExtension();
  try {
    await context.route('http://shelf.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Saved reading</title>',
      }),
    );
    const page = await context.newPage();
    const chunks: string[] = [];
    page.on('request', (request) => {
      if (/\/Shelf-[^/]+\.js/.test(request.url())) chunks.push(request.url());
    });
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    const shelf = page.locator('[data-deck="shelf"]');
    await expect(shelf).toHaveCount(0);
    expect(chunks).toEqual([]);
    await seed(page);
    await page.getByLabel('Settings', { exact: true }).click();
    const enabled = page.getByLabel('Show decks on the surface', {
      exact: true,
    });
    await expect(enabled).not.toBeChecked();
    await expect(page.locator('[data-deck="shelf-picker"]')).toHaveCount(0);
    await enabled.check();
    for (const id of ['deck_shelf_0', 'deck_shelf_1', 'deck_shelf_2'])
      await page.locator(`[data-deck="shelf-choice"][value="${id}"]`).check();
    await page.getByLabel('Close settings', { exact: true }).click();
    const first = shelf.locator(
      '[data-deck="shelf-deck"][data-deck-id="deck_shelf_0"]',
    );
    const firstHeader = first.locator('[data-deck="shelf-toggle"]');
    const second = shelf.locator(
      '[data-deck="shelf-deck"][data-deck-id="deck_shelf_1"]',
    );
    const empty = shelf.locator(
      '[data-deck="shelf-deck"][data-deck-id="deck_shelf_2"]',
    );
    await expect(shelf.locator('[data-deck="shelf-toggle"]')).toHaveCount(3);
    await expect(shelf.locator('[aria-expanded="true"]')).toHaveCount(0);
    const shelfBox = await shelf.boundingBox();
    const pinsBox = await page.locator('[data-deck="pins"]').boundingBox();
    if (!shelfBox || !pinsBox) throw new Error('Missing Shelf or Pins');
    expect(shelfBox.y).toBeGreaterThanOrEqual(pinsBox.y + pinsBox.height);
    await firstHeader.focus();
    await firstHeader.press('Enter');
    await expect(first.locator('[data-deck="shelf-card"]')).toHaveCount(2);
    await expect(first.locator('[data-deck="shelf-count"]')).toHaveText('2');
    await firstHeader.press('ArrowDown');
    await expect(second.locator('[data-deck="shelf-toggle"]')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(firstHeader).toHaveAttribute('aria-expanded', 'false');
    await expect(shelf.locator('[aria-expanded="true"]')).toHaveCount(1);
    await page.keyboard.press('ArrowUp');
    await expect(firstHeader).toBeFocused();
    await firstHeader.press('Enter');
    await firstHeader.press('Tab');
    await expect(first.locator('[data-deck="shelf-link"]')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(firstHeader).toBeFocused();
    await expect(firstHeader).toHaveAttribute('aria-expanded', 'false');
    await empty.locator('[data-deck="shelf-toggle"]').click();
    await expect(empty.locator('[data-deck="shelf-empty"]')).toBeVisible();
    await firstHeader.click();
    await first.locator('[data-deck="shelf-note"]').click();
    const note = page.locator('[data-deck="note"] textarea');
    await expect(note).toBeFocused();
    await expect(note).toHaveValue('A note on the Shelf');
    await page.keyboard.press('Control+J');
    await expect(
      page.locator('[data-deck="surface"][data-drawer-open]'),
    ).toHaveCount(0);
    await storedCard(page, 'A newer note from another tab');
    const newTab = context.waitForEvent('page');
    await first
      .locator('[data-deck="shelf-link"]')
      .click({ modifiers: ['Control'] });
    const opened = await newTab;
    await expect(opened).toHaveURL('http://shelf.test/read');
    await opened.close();
    await page.bringToFront();
    expect(await storedCard(page)).toMatchObject({
      note: 'A newer note from another tab',
      lastOpenedAt: expect.any(Number),
    });
    expect(
      await page.evaluate(() =>
        chrome.permissions.contains({ permissions: ['tabs'] }),
      ),
    ).toBe(false);
    await first.locator('[data-deck="shelf-link"]').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('http://shelf.test/read');
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await expect(shelf).toBeVisible();
    await expect(shelf.locator('[aria-expanded="true"]')).toHaveCount(0);

    for (const { theme, width, height } of [
      { theme: 'night', width: 1280, height: 800 },
      { theme: 'day', width: 640, height: 900 },
      { theme: 'day', width: 375, height: 812 },
      { theme: 'night', width: 640, height: 480 },
    ]) {
      await page.setViewportSize({ width, height });
      await page.getByLabel('Settings', { exact: true }).click();
      await page
        .getByRole('button', {
          name: theme === 'day' ? 'Day' : 'Night',
          exact: true,
        })
        .click();
      const overflow = await page
        .locator('[data-deck="shelf-settings"] input')
        .evaluateAll((inputs) => {
          const panel = document.querySelector('[data-deck="settings"]');
          if (!panel) throw new Error('Missing Settings');
          const bounds = panel.getBoundingClientRect();
          return inputs.some((input) => {
            const box = input.getBoundingClientRect();
            return box.x < bounds.x || box.right > bounds.right;
          });
        });
      expect(overflow).toBe(false);
      await expect(page.locator('[data-deck="toast"]')).toHaveCount(0);
      if (width === 375 || width === 1280) {
        await page
          .locator('[data-deck="shelf-settings"]')
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`shelf-settings-${theme}-${width}.png`),
          animations: 'disabled',
        });
      }
      await page.getByLabel('Close settings', { exact: true }).click();
      await expect(page.locator('[data-deck="toast"]')).toHaveCount(0);
      if ((await firstHeader.getAttribute('aria-expanded')) !== 'true')
        await firstHeader.click();
      await first.scrollIntoViewIfNeeded();
      await expect(first.locator('[data-deck="shelf-link"]')).toContainText(
        CARD_TITLE,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const review = page.locator('[data-deck="resurface"]');
      if (await review.count()) {
        const shelfBounds = await shelf.boundingBox();
        const reviewBounds = await review.boundingBox();
        if (!shelfBounds || !reviewBounds)
          throw new Error('Missing review bounds');
        expect(
          shelfBounds.x + shelfBounds.width <= reviewBounds.x ||
            reviewBounds.x + reviewBounds.width <= shelfBounds.x ||
            shelfBounds.y + shelfBounds.height <= reviewBounds.y ||
            reviewBounds.y + reviewBounds.height <= shelfBounds.y,
        ).toBe(true);
        for (const button of await review.locator('button').all()) {
          await button.scrollIntoViewIfNeeded();
          const hit = await button.evaluate((node) => {
            const box = node.getBoundingClientRect();
            const covering = document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            return {
              isHit: node.contains(covering),
              label: node.textContent || node.getAttribute('aria-label'),
              box: box.toJSON(),
              covering: covering?.outerHTML.slice(0, 300),
              width: innerWidth,
              height: innerHeight,
            };
          });
          expect(hit.isHit, JSON.stringify(hit)).toBe(true);
        }
        await first.scrollIntoViewIfNeeded();
      }
      for (const isBright of [false, true]) {
        await page.locator('[data-deck="surface"]').evaluate((node, bright) => {
          if (bright) (node as HTMLElement).dataset.brightWallpaper = 'true';
          else delete (node as HTMLElement).dataset.brightWallpaper;
        }, isBright);
        const axe = await new AxeBuilder({ page })
          .include('[data-deck="shelf"]')
          .analyze();
        expect(
          axe.violations.filter((issue) =>
            ['serious', 'critical'].includes(issue.impact ?? ''),
          ),
        ).toEqual([]);
      }
      await page.locator('[data-deck="surface"]').evaluate((node) => {
        delete (node as HTMLElement).dataset.brightWallpaper;
      });
      await page.screenshot({
        path: testInfo.outputPath(`shelf-${theme}-${width}-${height}.png`),
        animations: 'disabled',
      });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
    });
    await firstHeader.focus();
    await firstHeader.press('ArrowLeft');
    await expect(firstHeader).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() => {
      document.documentElement.dir = 'ltr';
    });
    await page.getByLabel('Settings', { exact: true }).click();
    await enabled.uncheck();
    await page.getByLabel('Close settings', { exact: true }).click();
    await expect(shelf).toHaveCount(0);
    await page.reload();
    await page.waitForSelector(READY);
    await expect(shelf).toHaveCount(0);
    await page.getByLabel('Settings', { exact: true }).click();
    await enabled.check();
    await expect(
      page.locator('[data-deck="shelf-choice"][value="deck_shelf_0"]'),
    ).toBeChecked();
    await page.getByLabel('Close settings', { exact: true }).click();
    await expect(shelf).toBeVisible();
    await expect(
      shelf.locator(
        'input, textarea, [role="checkbox"], [data-deck="card-edit"]',
      ),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
