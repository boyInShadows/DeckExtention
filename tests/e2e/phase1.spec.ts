import { expect, test } from '@playwright/test';
import { SETTINGS_DEFAULTS } from '../../packages/schema/src/settings';

import { expectWithinBudget } from './coverage';
import { launchExtension } from './extension';

const READY_SELECTOR = 'html[data-deck-ready="true"]';
const WARM_RUNS = 20;
const DRAWER_TEST_TIMEOUT_MS = 120_000;

test('Line results overlay without moving the clock', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY_SELECTOR);
    const clock = page.locator('[data-deck="clock"]');
    const before = (await clock.boundingBox())?.y;
    await page.locator('[data-deck="line"] input').fill('TypeScript');
    await expect(page.locator('[data-deck="line-results"]')).toBeVisible();
    expect((await clock.boundingBox())?.y).toBe(before);
  } finally {
    await context.close();
  }
});

test('Line opens the intended card for ten queries in a 300-card workspace', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.route('https://target*.example/**', (route) =>
      route.fulfill({ body: '<html></html>' }),
    );
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY_SELECTOR);
    await page.evaluate(async () => {
      const request = indexedDB.open('deck');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction('cards', 'readwrite');
      for (let index = 0; index < 300; index += 1) {
        const target = index < 10;
        const host = target
          ? `target${index}.example`
          : `archive${index}.example`;
        transaction.objectStore('cards').put({
          id: `fixture_${index}`,
          deckId: 'deck_examples',
          url: `https://${host}/`,
          title: target ? `Target ${index} reference` : `Archive item ${index}`,
          hostname: host,
          order: 'a0',
          pinned: false,
          lastOpenedAt: null,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
        });
      }
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    });
    for (let index = 0; index < 10; index += 1) {
      await page.goto('chrome://newtab/');
      await page.waitForSelector(READY_SELECTOR);
      const line = page.locator('[data-deck="line"] input');
      await line.fill(`target ${index}`);
      await expect(page.locator('[data-deck="card"]').first()).toContainText(
        `Target ${index} reference`,
      );
      await line.press('Enter');
      await expect(page).toHaveURL(`https://target${index}.example/`);
    }
  } finally {
    await context.close();
  }
});

test('Settings controls fit, close, and render in both themes', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('chrome://newtab/');
      await page.waitForSelector(READY_SELECTOR);
      await page.locator('[data-deck="settings-toggle"]').click();
      const panel = page.locator('[data-deck="settings"]');
      await expect(panel).toBeVisible();
      for (const theme of ['Night', 'Day']) {
        await panel.getByRole('button', { name: theme, exact: true }).click();
        const overflow = await panel.evaluate((element) => {
          const panelEdge = element.getBoundingClientRect().right;
          return [...element.querySelectorAll('input, textarea, button')]
            .filter((control) => getComputedStyle(control).display !== 'none')
            .filter(
              (control) =>
                control.getBoundingClientRect().right > panelEdge + 1,
            )
            .map(
              (control) =>
                control.getAttribute('aria-label') ?? control.textContent,
            );
        });
        expect(overflow).toEqual([]);
        await testInfo.attach(
          `appearance-${theme.toLowerCase()}-${width}.png`,
          {
            body: await page.screenshot(),
            contentType: 'image/png',
          },
        );
      }
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(page.locator('[data-deck="settings-toggle"]')).toBeFocused();
      await page.locator('[data-deck="settings-toggle"]').click();
      await page
        .locator('[data-deck="settings"]')
        .getByRole('textbox', { name: 'Your name' })
        .fill('Kasra');
      await page
        .locator('[data-deck="settings-backdrop"]')
        .click({ position: { x: 30, y: 30 } });
      await expect(panel).toHaveCount(0);
      await page.reload();
      await expect(page.locator('[data-deck="greeting"]')).toContainText(
        'Kasra',
      );
    }
  } finally {
    await context.close();
  }
});

test('surface persists a pin, exports data, and stays fast when warm', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY_SELECTOR);
    const coldTiming = await page.evaluate(
      () =>
        performance.getEntriesByName('deck-ready').at(-1)?.startTime ??
        Infinity,
    );
    await expect(page.locator('[data-deck="clock"]')).toBeVisible();
    await expect(page.locator('[data-deck="line"]')).toBeVisible();
    await expect(page.locator('[data-deck="pins"]')).toBeVisible();

    await page.locator('[data-deck="pin-add"]').click();
    await page.getByLabel('Paste a URL').fill('https://example.com/');
    await page.getByLabel('Paste a URL').press('Enter');
    await expect(page.locator('[data-deck="pin"]')).toHaveCount(1);
    await page.reload();
    await page.waitForSelector(READY_SELECTOR);
    await expect(page.locator('[data-deck="pin"]')).toHaveCount(1);

    const downloadPromise = page.waitForEvent('download');
    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'Export data' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^deck-\d{4}-\d{2}-\d{2}\.json$/,
    );

    const timings: number[] = [];
    for (let run = 0; run < WARM_RUNS; run += 1) {
      await page.reload();
      await page.waitForSelector(READY_SELECTOR);
      timings.push(
        await page.evaluate(
          () =>
            performance.getEntriesByName('deck-ready').at(-1)?.startTime ??
            Infinity,
        ),
      );
    }
    await testInfo.attach('surface-timings.json', {
      body: JSON.stringify({ coldTiming, warmTimings: timings }),
      contentType: 'application/json',
    });
    const sortedTimings = timings.toSorted((left, right) => left - right);
    const medianTiming = sortedTimings[Math.floor(sortedTimings.length / 2)];
    expectWithinBudget('surface median ms', medianTiming, { max: 60 });
  } finally {
    await context.close();
  }
});

test('a corrupt card leaves the new tab usable and exportable', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY_SELECTOR);
    await page.evaluate(async (defaultSettings) => {
      const request = <T>(operation: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          operation.onsuccess = () => resolve(operation.result);
          operation.onerror = () => reject(operation.error);
        });
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const operation = indexedDB.open('deck');
        operation.onsuccess = () => resolve(operation.result);
        operation.onerror = () => reject(operation.error);
      });
      const [pages, decks, cards, settings] = await Promise.all([
        request(database.transaction('pages').objectStore('pages').getAll()),
        request(database.transaction('decks').objectStore('decks').getAll()),
        request(database.transaction('cards').objectStore('cards').getAll()),
        request(
          database.transaction('meta').objectStore('meta').get('settings'),
        ),
      ]);
      const now = Date.now();
      await chrome.storage.local.set({
        deckLatestSnapshot: {
          id: 'snapshot_e2e',
          ts: now,
          schemaVersion: 1,
          blob: JSON.stringify({
            schemaVersion: 1,
            exportedAt: now,
            pages,
            decks,
            cards,
            settings: settings?.value ?? defaultSettings,
          }),
        },
      });
      const transaction = database.transaction('cards', 'readwrite');
      await request(
        transaction.objectStore('cards').put({
          ...cards[0],
          id: 'seed0',
        }),
      );
      database.close();
    }, SETTINGS_DEFAULTS);

    await page.reload();
    await page.waitForSelector(READY_SELECTOR);
    await expect(page.locator('[data-deck="clock"]')).toBeVisible();
    await expect(page.locator('[data-deck="recovery-notice"]')).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'Export data' }).click();
    expect((await downloadPromise).suggestedFilename()).toMatch(
      /^deck-.*\.json$/,
    );
    page.once('dialog', (dialog) => void dialog.accept());
    const restored = page.waitForEvent('load').then(() => null);
    const restoreFailure = page
      .locator('[data-deck="settings"] [role="alert"]')
      .waitFor()
      .then(() =>
        page.locator('[data-deck="settings"] [role="alert"]').textContent(),
      );
    await page
      .getByRole('button', { name: /^Restore ·/ })
      .first()
      .click({ noWaitAfter: true });
    expect(await Promise.race([restored, restoreFailure])).toBeNull();
    await expect(page.locator('[data-deck="clock"]')).toBeVisible();
    await expect(page.locator('[data-deck="recovery-notice"]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('an unavailable IndexedDB opens recovery and exports the independent snapshot', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY_SELECTOR);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const stored = await chrome.storage.local.get('deckLatestSnapshot');
          return Boolean(stored.deckLatestSnapshot);
        }),
      )
      .toBe(true);
    await page.addInitScript(() => {
      const originalOpen = indexedDB.open.bind(indexedDB);
      indexedDB.open = ((name: string, version?: number) => {
        if (name === 'deck') throw new Error('IndexedDB unavailable');
        return originalOpen(name, version);
      }) as typeof indexedDB.open;
    });

    await page.reload();
    await expect(page.locator('[data-deck="recovery"]')).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export now' }).click();
    expect((await downloadPromise).suggestedFilename()).toMatch(
      /^deck-.*\.json$/,
    );
    await page
      .getByRole('button', { name: 'Restore this snapshot' })
      .first()
      .click({ noWaitAfter: true });
    await expect(page.locator('[data-deck="clock"]')).toBeVisible();
    const restored = await context.newPage();
    await restored.goto('chrome://newtab/');
    await expect(restored.locator('[data-deck="clock"]')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('drawer triggers and page state survive repeated open and close cycles', async ({
  browserName,
}) => {
  test.setTimeout(DRAWER_TEST_TIMEOUT_MS);
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY_SELECTOR);
    const drawer = page.locator('[data-deck="drawer"]');
    const line = page.locator('[data-deck="line"] input');

    await line.focus();
    await line.press('Space');
    await expect(drawer).toBeVisible();
    await page.getByLabel('Close Deck drawer').click();

    await line.fill('keeps leading spaces');
    await line.press('Space');
    await expect(drawer).toBeHidden();
    await expect(line).toHaveValue('keeps leading spaces ');

    await page.keyboard.press('Control+J');
    await expect(drawer).toBeVisible();
    await expect(page.locator('[data-deck="pages"]')).toContainText('Inbox');
    await page.getByLabel('Add page').click();
    const selectedPage = page.locator('[data-deck="page"][data-selected]');
    await expect(selectedPage).toContainText('New page');
    await page.getByLabel('Close Deck drawer').click();
    await page.getByLabel('Open Deck drawer').click();
    await expect(selectedPage).toContainText('New page');

    for (let index = 0; index < 18; index += 1) {
      await page.getByLabel('Add page').click();
    }
    const pageRail = page.locator('.deck-pages__scroll');
    await pageRail.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    const savedScroll = await pageRail.evaluate((element) => element.scrollTop);
    expect(savedScroll).toBeGreaterThan(0);
    await page.getByLabel('Close Deck drawer').click();
    await page.getByLabel('Open Deck drawer').click();
    await expect
      .poll(() => pageRail.evaluate((element) => element.scrollTop))
      .toBeCloseTo(savedScroll, 0);

    for (let cycle = 0; cycle < 50; cycle += 1) {
      await page.getByLabel('Close Deck drawer').click();
      await expect(drawer).toBeHidden();
      await page.getByLabel('Open Deck drawer').click();
      await expect(drawer).toBeVisible();
    }
  } finally {
    await context.close();
  }
});

test('drawer cards move between decks and onto the Pins strip', async ({
  browserName,
}) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY_SELECTOR);
    await page.keyboard.press('Control+J');

    const decks = page.locator('[data-deck="deck"]');
    await page.getByRole('button', { name: '+ Add deck' }).click();
    await expect(decks).toHaveCount(2);
    const sourceDeck = decks.nth(0);
    const targetDeck = decks.nth(1);
    const sourceCard = sourceDeck.locator('[data-deck="card"]').first();
    const sourceCardBox = await sourceCard.boundingBox();
    const targetDeckBox = await targetDeck.boundingBox();
    if (!sourceCardBox || !targetDeckBox)
      throw new Error('Card drag endpoints are not visible');
    await page.mouse.move(
      sourceCardBox.x + sourceCardBox.width / 2,
      sourceCardBox.y + sourceCardBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceCardBox.x + sourceCardBox.width / 2,
      sourceCardBox.y + sourceCardBox.height / 2 + 12,
      { steps: 2 },
    );
    await page.mouse.move(
      targetDeckBox.x + targetDeckBox.width / 2,
      targetDeckBox.y + targetDeckBox.height / 2,
      { steps: 8 },
    );
    await expect(targetDeck).toHaveAttribute('data-drag-over', 'true');
    await page.mouse.up();
    await expect(sourceDeck.locator('[data-deck="card"]')).toHaveCount(5);
    await expect(targetDeck.locator('[data-deck="card"]')).toHaveCount(1);

    const movedCard = targetDeck.locator('[data-deck="card"]').first();
    const sourceBox = await movedCard.boundingBox();
    if (!sourceBox) throw new Error('Moved card is not visible');
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2 + 12,
      { steps: 2 },
    );
    await expect(movedCard).toHaveAttribute('data-dragging', 'true');
    const pinsDrop = page.locator('[data-deck="pins-drop"]');
    await expect(pinsDrop).toBeVisible();
    const pinsBox = await pinsDrop.boundingBox();
    if (!pinsBox) throw new Error('Pins drop target is not visible');
    await page.mouse.move(
      pinsBox.x + pinsBox.width / 2,
      pinsBox.y + pinsBox.height / 2,
    );
    await expect(pinsDrop).toHaveAttribute('data-drag-over', 'true');
    await page.mouse.up();
    await expect(page.locator('[data-deck="pin"]')).toHaveCount(1);

    await page.reload();
    await page.waitForSelector(READY_SELECTOR);
    await expect(page.locator('[data-deck="pin"]')).toHaveCount(1);
    await page.keyboard.press('Control+J');
    await expect(decks.nth(1).locator('[data-deck="card"]')).toHaveCount(1);
  } finally {
    await context.close();
  }
});
