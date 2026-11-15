import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { launchExtension } from './extension';

const DECK_ID = 'deck_sorting';
const DECK = `[data-deck="deck"][data-deck-id="${DECK_ID}"]`;
const READY = 'html[data-deck-ready="true"]';

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

async function openSort(page: Page) {
  await page
    .locator(DECK)
    .getByRole('button', { name: 'Deck menu', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Sort cards', exact: true }).click();
}
async function choose(page: Page, label: string) {
  await openSort(page);
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
  await expect(page.locator('[data-deck="deck-menu"]')).toHaveCount(0);
}
async function titles(page: Page) {
  return page.locator(`${DECK} [data-deck="card"] a strong`).allTextContents();
}

for (const [label, expected] of [
  ['Title', ['Alpha', 'Beta', 'Zebra', 'AAA done']],
  ['Newest first', ['Beta', 'Zebra', 'Alpha', 'AAA done']],
  ['Hostname', ['Beta', 'Zebra', 'Alpha', 'AAA done']],
  ['Manual', ['Zebra', 'Alpha', 'Beta', 'AAA done']],
] as const) {
  test(`${label} survives reload without changing cards or unrelated decks, and Manual restores the original`, async () => {
    const context = await launchExtension();
    try {
      const page = await context.newPage();
      await page.goto('chrome://newtab/');
      await page.waitForSelector(READY);
      await seed(page);
      const [cardsBefore, decksBefore] = await records(page);
      await choose(page, label);
      await expect.poll(() => titles(page)).toEqual(expected);
      await page.reload();
      await page.waitForSelector(READY);
      await page.keyboard.press('Control+J');
      await expect.poll(() => titles(page)).toEqual(expected);
      await openSort(page);
      await expect(
        page.getByRole('menuitemradio', { name: label, exact: true }),
      ).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape');
      const [cardsAfter, decksAfter] = await records(page);
      expect(cardsAfter).toEqual(cardsBefore);
      expect(decksAfter?.filter((deck) => deck.id !== DECK_ID)).toEqual(
        decksBefore?.filter((deck) => deck.id !== DECK_ID),
      );
      await choose(page, 'Manual');
      await expect
        .poll(() => titles(page))
        .toEqual(['Zebra', 'Alpha', 'Beta', 'AAA done']);
    } finally {
      await context.close();
    }
  });
}

test('adding a card in a sorted deck appends after all manual keys', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    await choose(page, 'Title');
    await page.locator(DECK).locator('[data-deck="add-card"]').click();
    const input = page
      .locator(DECK)
      .getByRole('textbox', { name: 'Paste a URL' });
    await input.fill('https://added.sort.example/');
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    const [addedCards] = await records(page);
    const added = addedCards?.find(
      (card) => card.hostname === 'added.sort.example',
    );
    expect(String(added?.order) > 'a2').toBe(true);
  } finally {
    await context.close();
  }
});

test('a failed sort write keeps the current order and can be retried', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    const before = await records(page);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'decks') {
          IDBObjectStore.prototype.put = put;
          throw new Error('Sort write failed');
        }
        return put.apply(this, args);
      };
    });
    await choose(page, 'Title');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Sort write failed' }),
    ).toBeVisible();
    expect(await titles(page)).toEqual(['Zebra', 'Alpha', 'Beta', 'AAA done']);
    expect(await records(page)).toEqual(before);
    await choose(page, 'Title');
    await expect
      .poll(() => titles(page))
      .toEqual(['Alpha', 'Beta', 'Zebra', 'AAA done']);
  } finally {
    await context.close();
  }
});

for (const theme of ['day', 'night']) {
  test(`sort radios support keyboard and narrow ${theme} accessibility`, async ({
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
      await openSort(page);
      await expect(
        page.getByRole('menuitemradio', { name: 'Manual', exact: true }),
      ).toBeFocused();
      await page.keyboard.press('End');
      await expect(
        page.getByRole('menuitemradio', { name: 'Hostname', exact: true }),
      ).toBeFocused();
      const menu = page.getByRole('menu', { name: 'Sort cards', exact: true });
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-deck="deck-menu"]')
            .analyze()
        ).violations,
      ).toEqual([]);
      const box = await menu.boundingBox();
      if (!box) throw new Error('Sort menu missing');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      await page.screenshot({
        path: testInfo.outputPath(`${theme}-320.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await expect(
        page
          .locator(DECK)
          .getByRole('button', { name: 'Deck menu', exact: true }),
      ).toBeFocused();
    } finally {
      await context.close();
    }
  });
}

test('sort radios fit the drawer and support keyboard at real 200 percent browser zoom', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    const extensionPage = await page.evaluate(() =>
      chrome.runtime.getURL('src/newtab/index.html'),
    );
    await page.goto(`${extensionPage}?deck-sort-layout`);
    await page.waitForSelector(READY);
    await page.setViewportSize({ width: 1280, height: 720 });
    const ratio = await page.evaluate(() => devicePixelRatio);
    await page.evaluate(async () => {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id === undefined) throw new Error('Missing tab');
      await chrome.tabs.setZoom(tab.id, 2);
    });
    await expect
      .poll(() => page.evaluate(() => devicePixelRatio))
      .toBe(ratio * 2);
    await page.keyboard.press('Control+J');
    await openSort(page);
    await expect(
      page.getByRole('menuitemradio', { name: 'Manual', exact: true }),
    ).toBeFocused();
    const menuBounds = await page
      .getByRole('menu', { name: 'Sort cards', exact: true })
      .boundingBox();
    const drawerBounds = await page
      .locator('[data-deck="drawer"]')
      .boundingBox();
    if (!menuBounds || !drawerBounds)
      throw new Error('Missing zoomed menu bounds');
    expect(menuBounds.x).toBeGreaterThanOrEqual(drawerBounds.x);
    expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(
      drawerBounds.x + drawerBounds.width,
    );
    expect(menuBounds.y).toBeGreaterThanOrEqual(drawerBounds.y);
    expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(
      drawerBounds.y + drawerBounds.height,
    );
    await page.keyboard.press('End');
    const lastChoice = page.getByRole('menuitemradio', {
      name: 'Hostname',
      exact: true,
    });
    await expect(lastChoice).toBeFocused();
    const lastBounds = await lastChoice.boundingBox();
    if (!lastBounds) throw new Error('Last zoomed choice missing');
    const geometry = await lastChoice.evaluate((element) => {
      const menu = element.closest('[role="menu"]');
      const drawer = element.closest('[data-deck="drawer"]');
      return {
        choice: element.getBoundingClientRect().toJSON(),
        menu: menu?.getBoundingClientRect().toJSON(),
        style: menu?.getAttribute('style'),
        drawer: drawer?.getBoundingClientRect().toJSON(),
        scrollTop: menu?.scrollTop,
        scrollHeight: menu?.scrollHeight,
        clientHeight: menu?.clientHeight,
      };
    });
    expect(
      lastBounds.y + lastBounds.height,
      JSON.stringify(geometry),
    ).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await expect(
      page.getByRole('menuitemradio', { name: 'Title', exact: true }),
    ).toBeFocused();
    const bounds = await page
      .getByRole('menuitemradio', { name: 'Title', exact: true })
      .boundingBox();
    const height = await page.evaluate(() => innerHeight);
    if (!bounds) throw new Error('Zoomed sort choice missing');
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    await page.screenshot({
      path: testInfo.outputPath('zoom-200.png'),
      animations: 'disabled',
    });
    await page.keyboard.press('Enter');
    await expect
      .poll(() => titles(page))
      .toEqual(['Alpha', 'Beta', 'Zebra', 'AAA done']);
  } finally {
    await context.close();
  }
});
