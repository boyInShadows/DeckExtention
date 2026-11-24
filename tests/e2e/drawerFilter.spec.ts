import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { launchExtension } from './extension';

const DECK_ID = 'deck_sorting';
const DECK = `[data-deck="deck"][data-deck-id="${DECK_ID}"]`;
const READY = 'html[data-deck-ready="true"]';
const FILTER = '[data-deck="drawer-filter-input"]';

async function seed(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['pages', 'decks', 'cards'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        const request = tx.objectStore('pages').getAll();
        request.onsuccess = () => {
          const page = request.result[0] as { id: string } | undefined;
          if (!page) throw new Error('Seed page missing');
          const base = { createdAt: 1000, updatedAt: 1000, deletedAt: null };
          tx.objectStore('decks').put({
            ...base,
            id: 'deck_sorting',
            pageId: page.id,
            title: 'Sort proof',
            kind: 'normal',
            order: 'a1',
            color: null,
            isCollapsed: false,
          });
          const fixtures = [
            {
              id: 'sort_zebra',
              title: 'Zebra',
              order: 'a0',
              hostname: 'b.sort.example',
              createdAt: 2000,
            },
            {
              id: 'sort_alpha',
              title: 'Alpha',
              order: 'a1',
              hostname: 'c.sort.example',
              createdAt: 1000,
            },
            {
              id: 'sort_beta',
              title: 'Beta',
              order: 'a2',
              hostname: 'a.sort.example',
              createdAt: 3000,
            },
            {
              id: 'sort_done',
              title: 'AAA done',
              order: 'Zz',
              hostname: 'd.sort.example',
              createdAt: 4000,
              done: true,
            },
          ];
          for (const fixture of fixtures)
            tx.objectStore('cards').put({
              ...base,
              deckId: 'deck_sorting',
              pinned: false,
              lastOpenedAt: null,
              url: `https://${fixture.hostname}/`,
              ...fixture,
            });
        };
      });
    } finally {
      db.close();
    }
  });
  await page.reload();
  await page.waitForSelector(READY);
  await page.keyboard.press('Control+J');
  await expect(page.locator(DECK)).toBeVisible();
}

async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await Promise.all(
        ['cards', 'decks'].map(
          (name) =>
            new Promise<Record<string, unknown>[]>((resolve, reject) => {
              const request = db.transaction(name).objectStore(name).getAll();
              request.onsuccess = () =>
                resolve(request.result as Record<string, unknown>[]);
              request.onerror = () => reject(request.error);
            }),
        ),
      );
    } finally {
      db.close();
    }
  });
}

test('filter scopes cards, restores focus, respects editors and preserves records', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    const before = await records(page);
    const card = page.locator('[data-card-id="sort_alpha"]');
    await card.focus();
    await page.keyboard.press('Control+f');
    const input = page.locator(FILTER);
    await expect(input).toBeFocused();
    await input.fill(' ALPHA ');
    await expect(page.locator(`${DECK} [data-deck="card"]`)).toHaveCount(1);
    await expect(card).toBeVisible();
    await expect(
      page
        .locator('[data-deck="deck"]')
        .filter({ hasText: 'Examples' })
        .locator('[data-deck="card"]'),
    ).toHaveCount(0);
    await page.keyboard.press('Control+f');
    await expect(input).toBeFocused();
    await input.fill('missing-everywhere');
    await expect(
      page.locator('[data-deck="drawer-filter-status"]'),
    ).toContainText('No matching cards');
    await expect(
      page.locator('[data-deck="decks"] [data-deck="card"]'),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(card).toBeFocused();
    await expect(page.locator(`${DECK} [data-deck="card"]`)).toHaveCount(4);
    await expect(page.locator('[data-deck="drawer"]')).toHaveAttribute(
      'data-open',
      'true',
    );
    await page.locator(`${DECK} [data-deck="deck-title"]`).click();
    const editor = page.getByRole('textbox', { name: 'Deck name' });
    await expect(editor).toBeFocused();
    await page.keyboard.press('Control+f');
    await expect(input).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(await records(page)).toEqual(before);
  } finally {
    await context.close();
  }
});

for (const theme of ['day', 'night']) {
  test(`filter is accessible and reachable in narrow ${theme}`, async ({
    browserName,
  }, testInfo) => {
    expect(browserName).toBe('chromium');
    const context = await launchExtension();
    try {
      const page = await context.newPage();
      await page.goto('chrome://newtab/');
      await page.waitForSelector(READY);
      await seed(page);
      await page.setViewportSize({ width: 320, height: 720 });
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.locator('[data-card-id="sort_alpha"]').focus();
      await page.keyboard.press('Control+f');
      await page.locator(FILTER).fill('alpha');
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-deck="drawer-filter"]')
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.keyboard.press('Tab');
      const close = page.getByRole('button', {
        name: 'Close filter',
        exact: true,
      });
      await expect(close).toBeFocused();
      const bounds = await close.boundingBox();
      if (!bounds) throw new Error('Missing filter close');
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
      await page.screenshot({
        path: testInfo.outputPath(`filter-${theme}.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Enter');
      await expect(page.locator(FILTER)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

test('filter resets across sections and drawer close and fits actual 200 percent zoom', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    const extensionPage = await page.evaluate(() =>
      chrome.runtime.getURL('src/newtab/index.html'),
    );
    await page.goto(`${extensionPage}?drawer-filter-zoom`);
    await page.waitForSelector(READY);
    await page.setViewportSize({ width: 1280, height: 720 });
    const ratio = await page.evaluate(() => devicePixelRatio);
    await page.evaluate(async () => {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id === undefined) throw new Error('Missing current tab');
      await chrome.tabs.setZoom(tab.id, 2);
    });
    await expect
      .poll(() => page.evaluate(() => devicePixelRatio))
      .toBe(ratio * 2);
    await page.keyboard.press('Control+J');
    await page.locator('[data-card-id="sort_alpha"]').focus();
    await page.keyboard.press('Control+f');
    const input = page.locator(FILTER);
    await input.fill('alpha');
    await page.keyboard.press('Tab');
    const close = page.getByRole('button', {
      name: 'Close filter',
      exact: true,
    });
    await expect(close).toBeFocused();
    const bounds = await close.boundingBox();
    const drawer = await page.locator('[data-deck="drawer"]').boundingBox();
    if (!bounds || !drawer) throw new Error('Missing filter bounds');
    expect(bounds.x).toBeGreaterThanOrEqual(drawer.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(
      drawer.x + drawer.width,
    );
    expect(bounds.y).toBeGreaterThanOrEqual(drawer.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(
      drawer.y + drawer.height,
    );
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-deck="drawer"]')).not.toHaveAttribute(
      'data-open',
      'true',
    );
    await page.keyboard.press('Control+J');
    await expect(page.locator('[data-deck="drawer"]')).toHaveAttribute(
      'data-open',
      'true',
    );
    await expect(input).toHaveCount(0);
    await page.locator('[data-card-id="sort_alpha"]').focus();
    await expect(page.locator('[data-card-id="sort_alpha"]')).toBeFocused();
    await page.keyboard.press('Control+f');
    await input.fill('alpha');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Control+J');
    await expect(page.locator('[data-deck="drawer"]')).not.toHaveAttribute(
      'data-open',
      'true',
    );
    await page.keyboard.press('Control+J');
    await expect(page.locator('[data-deck="drawer"]')).toHaveAttribute(
      'data-open',
      'true',
    );
    await expect(input).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('Sessions filter reveals collapsed matches without saving collapse or query', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('deck');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('decks', 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          const store = tx.objectStore('decks');
          const request = store.get('deck_sorting');
          request.onsuccess = () =>
            store.put({
              ...request.result,
              kind: 'session',
              isCollapsed: true,
            });
        });
      } finally {
        db.close();
      }
    });
    await page.reload();
    await page.waitForSelector(READY);
    await page.keyboard.press('Control+J');
    await page
      .locator('[data-deck="drawer"]')
      .getByRole('button', { name: /^Sessions(?:\s+\d+)?$/ })
      .click();
    await expect(page.locator(DECK)).toBeVisible();
    const before = await records(page);
    await page.locator(`${DECK} [data-deck="deck-drag"]`).focus();
    await page.keyboard.press('Control+f');
    await page.locator(FILTER).fill('alpha');
    await expect(page.locator(`${DECK} [data-deck="card"]`)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator(`${DECK} [data-deck="card"]`)).toHaveCount(0);
    expect(await records(page)).toEqual(before);
    await page.keyboard.press('Control+f');
    await page.locator(FILTER).fill('alpha');
    await page
      .locator('[data-deck="drawer"]')
      .getByRole('button', { name: 'Links', exact: true })
      .click();
    await expect(page.locator(FILTER)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
