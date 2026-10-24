import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { expectWithinBudget } from './coverage';
import { launchExtension } from './extension';
import { measureDrawerOpen } from './drawerTiming';

/**
 * FableTasks P2.S8: one journey through the whole drawer phase - save from a
 * page, triage it, drag it, export it - plus the numbers p2-report.md quotes.
 */
const READY_SELECTOR = 'html[data-deck-ready="true"]';
const ARTICLE_URL = 'http://deck.test/article';
const ARTICLE_TITLE = 'Deck phase two article';
const JOURNEY_TIMEOUT_MS = 90_000;
const DRAWER_OPEN_RUNS = 10;
/** MasterPlan 3.2 / P2 star: the drawer opens under 120 ms. */
const DRAWER_OPEN_BUDGET_MS = 120;
const DRAWER_EXIT_MS = 320;
/** Headless Chromium paints at 60 Hz; a drag below 50 fps is visible jank. */
const DRAG_MIN_FPS = 50;
const DRAG_STEPS = 40;
const WORKSPACE_DECKS = 20;
const WORKSPACE_CARDS = 300;
const SCROLL_FRAMES = 90;

async function serveArticle(context: BrowserContext): Promise<void> {
  await context.route('http://deck.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<title>${ARTICLE_TITLE}</title><p>Read me later.</p>`,
    }),
  );
}

async function openDeck(context: BrowserContext, hash = ''): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome://newtab/${hash}`);
  await page.waitForSelector(READY_SELECTOR);
  return page;
}

/**
 * Fires the service worker's own `quick-save` listener - the code the hotkey
 * runs. A real Ctrl+Shift+S never reaches Chrome's shortcut layer from
 * Playwright, and a synthetic command carries no user gesture, so Chrome
 * refuses the on-page toast; Quick Save then falls back to a notice in the
 * next new tab, exactly as it does on a `chrome://` page. The toast itself is
 * covered by quickSave.spec.ts.
 */
async function dispatchQuickSave(context: BrowserContext): Promise<void> {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  await worker.evaluate(
    async ({ url, title }) => {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      const onCommand = chrome.commands.onCommand as unknown as {
        dispatch: (command: string, tab: chrome.tabs.Tab) => void;
      };
      if (!tab) throw new Error('No active tab');
      onCommand.dispatch('quick-save', { ...tab, url, title });
    },
    { url: ARTICLE_URL, title: ARTICLE_TITLE },
  );
}

/** Counts animation frames while a card is dragged across the grid. */
async function dragWithFrameCount(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<{ fps: number; worstFrameMs: number }> {
  await page.evaluate(() => {
    const probe = window as unknown as {
      frames: number[];
      isCounting: boolean;
    };
    probe.frames = [];
    probe.isCounting = true;
    const tick = (time: number) => {
      probe.frames.push(time);
      if (probe.isCounting) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 12, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: DRAG_STEPS });
  await page.mouse.up();
  return page.evaluate(() => {
    const probe = window as unknown as {
      frames: number[];
      isCounting: boolean;
    };
    probe.isCounting = false;
    const { frames } = probe;
    const gaps = frames
      .slice(1)
      .map((time, index) => time - (frames[index] ?? time));
    const spanMs = (frames.at(-1) ?? 0) - (frames[0] ?? 0);
    return {
      fps: spanMs > 0 ? (gaps.length * 1000) / spanMs : 0,
      worstFrameMs: Math.max(0, ...gaps),
    };
  });
}

const centre = async (page: Page, selector: ReturnType<Page['locator']>) => {
  const box = await selector.boundingBox();
  if (!box) throw new Error('Element is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test('phase 2 journey: quick save, triage, drag, export', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const context = await launchExtension();
  try {
    await serveArticle(context);

    // Quick Save's one-time grant, from Settings.
    const settings = await openDeck(context, '#settings');
    await settings.getByRole('button', { name: 'Allow' }).click();
    await expect(
      settings.getByRole('button', { name: 'Revoke' }),
    ).toBeVisible();
    await settings.close();

    // Capture: one command, zero decisions.
    const article = await context.newPage();
    await article.goto(ARTICLE_URL);
    await article.bringToFront();
    await dispatchQuickSave(context);
    const page = await openDeck(context);
    await expect(
      page.locator('[data-deck="toast"][data-kind="success"]'),
    ).toContainText(`Saved to Inbox: ${ARTICLE_TITLE}`);

    // Drawer open time, keydown to painted frame.
    const openTimes: number[] = [];
    for (let run = 0; run < DRAWER_OPEN_RUNS; run += 1) {
      openTimes.push(await measureDrawerOpen(page));
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-deck="drawer"]')).toBeHidden();
      await page.waitForTimeout(DRAWER_EXIT_MS);
    }
    await page.keyboard.press('Control+J');
    const drawer = page.locator('[data-deck="drawer"][data-open]');
    await expect(drawer).toBeVisible();

    // Create a deck on the Examples page.
    const decks = page.locator('[data-deck="deck"]');
    await page.locator('[data-deck="deck-add"]').click();
    await expect(decks).toHaveCount(2);

    // Triage: the saved page is in the Inbox; m, type, Enter.
    await page.locator('[data-deck="page"][data-system]').first().click();
    const inbox = page.getByRole('listbox', { name: 'Inbox' });
    await expect(inbox.getByRole('option')).toHaveCount(1);
    await expect(inbox).toContainText(ARTICLE_TITLE);
    await expect(inbox).toBeFocused();
    await page.keyboard.press('m');
    await expect(page.getByRole('combobox')).toBeFocused();
    await page.keyboard.type('new deck');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-deck="inbox-zero"]')).toHaveText(
      'Inbox zero.',
    );

    // Drag it from the new deck into Examples, counting frames on the way.
    await page
      .locator('[data-deck="page"]:not([data-system])')
      .filter({ hasText: 'Examples' })
      .click();
    const deckTitled = (title: string) =>
      decks.filter({
        has: page.getByRole('button', { name: title, exact: true }),
      });
    const newDeck = deckTitled('New deck');
    const examples = deckTitled('Examples');
    const savedCard = newDeck.locator('[data-deck="card"]').first();
    await expect(savedCard).toBeVisible();
    await savedCard.locator('[data-deck="card-drag"]').focus();
    await page.keyboard.press('Space');
    await expect(savedCard).toHaveAttribute('data-dragging', 'true');
    // dnd-kit attaches the cancel key listener on the next task after lift.
    await page.evaluate(
      () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    );
    await page.keyboard.press('Escape');
    await expect(savedCard).not.toHaveAttribute('data-dragging', 'true');
    await expect(drawer).toBeVisible();
    await page.waitForTimeout(DRAWER_EXIT_MS);
    const drag = await dragWithFrameCount(
      page,
      await centre(page, savedCard.locator('[data-deck="card-drag"]')),
      await centre(page, examples),
    );
    await expect(examples.locator('[data-deck="card"]')).toHaveCount(7);
    await expect(examples).toContainText(ARTICLE_TITLE);

    // Export, and the saved page is in the file, in its new deck.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings' }).click();
    const download = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Export data', exact: true })
      .click();
    const file = await (await download).path();
    const exported = JSON.parse(await readFile(file, 'utf8')) as {
      decks: { id: string; title: string }[];
      cards: { url: string; deckId: string; deletedAt: number | null }[];
    };
    const saved = exported.cards.find(({ url }) => url === ARTICLE_URL);
    expect(saved?.deletedAt).toBeNull();
    expect(exported.decks.find(({ id }) => id === saved?.deckId)?.title).toBe(
      'Examples',
    );

    const sortedOpen = openTimes.toSorted((left, right) => left - right);
    const timings = {
      drawerOpenMs: {
        min: sortedOpen[0],
        median: sortedOpen[Math.floor(sortedOpen.length / 2)],
        max: sortedOpen.at(-1),
      },
      drag,
    };
    await testInfo.attach('phase2-timings.json', {
      body: JSON.stringify(timings),
      contentType: 'application/json',
    });
    expectWithinBudget('drawer open worst ms', sortedOpen.at(-1) ?? Infinity, {
      max: DRAWER_OPEN_BUDGET_MS,
    });
    expectWithinBudget('drag fps', drag.fps, { min: DRAG_MIN_FPS });
  } finally {
    await context.close();
  }
});

test('access granted in context is listed in Settings and can be revoked', async () => {
  const context = await launchExtension();
  try {
    await context.route(/^https?:\/\//, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>stub</title>' }),
    );
    const page = await openDeck(context);
    const hasSearch = () =>
      page.evaluate(() =>
        chrome.permissions.contains({ permissions: ['search'] }),
      );
    expect(await hasSearch()).toBe(false);

    // Granted at the moment of use: a `?` query from the Line.
    await page.keyboard.press('/');
    await page.keyboard.type('?deck');
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => !url.href.startsWith('chrome'));

    const deck = await openDeck(context, '#settings');
    const row = deck
      .locator('[data-deck="granted-access"]')
      .filter({ hasText: 'Web search' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(row).toHaveCount(0);
    expect(
      await deck.evaluate(() =>
        chrome.permissions.contains({ permissions: ['search'] }),
      ),
    ).toBe(false);
  } finally {
    await context.close();
  }
});

test('incognito action respects Chrome access without requesting tabs', async () => {
  const context = await launchExtension();
  try {
    const page = await openDeck(context);
    const access = await page.evaluate(async () => ({
      hasTabs: await chrome.permissions.contains({ permissions: ['tabs'] }),
      isAllowed: await chrome.extension.isAllowedIncognitoAccess(),
    }));
    expect(access.hasTabs).toBe(false);
    if (!access.isAllowed) {
      await page.keyboard.press('Control+J');
      await page
        .locator('[data-deck="card"]')
        .first()
        .getByRole('button', { name: 'Card menu' })
        .click();
      await page.getByRole('menuitem', { name: 'Open in incognito' }).click();
      await expect(
        page.locator('[data-deck="toast"][data-kind="error"]'),
      ).toContainText('Allow Deck in Incognito');
      return;
    }
    const isIncognito = await page.evaluate(async () => {
      const created = await chrome.windows.create({
        url: 'about:blank',
        incognito: true,
      });
      if (created?.id === undefined) throw new Error('No window was created');
      try {
        const windows = await chrome.windows.getAll();
        return windows.some((item) => item.id === created.id && item.incognito);
      } finally {
        await chrome.windows.remove(created.id);
      }
    });
    expect(isIncognito).toBe(true);
  } finally {
    await context.close();
  }
});

test('300 cards across 20 decks scroll smoothly and deck colour is visible in both themes', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await openDeck(context);
    await page.evaluate(
      async ({ deckCount, cardCount }) => {
        const open = indexedDB.open('deck');
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        const tx = database.transaction(
          ['pages', 'decks', 'cards'],
          'readwrite',
        );
        const now = Date.now();
        tx.objectStore('pages').put({
          id: 'page_perf',
          title: 'Load test',
          order: 'zz',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        for (let deck = 0; deck < deckCount; deck += 1) {
          const deckId = `deck_perf_${String(deck).padStart(2, '0')}`;
          tx.objectStore('decks').put({
            id: deckId,
            pageId: 'page_perf',
            title: `Deck ${deck}`,
            kind: 'normal',
            order: `b${String(deck).padStart(2, '0')}`,
            color: deck === 0 ? 'blue' : null,
            isCollapsed: false,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });
          for (let card = 0; card < cardCount / deckCount; card += 1) {
            const index = deck * (cardCount / deckCount) + card;
            tx.objectStore('cards').put({
              id: `card_perf_${index}`,
              deckId,
              title: `Link ${index}`,
              url: `https://example.com/perf/${index}`,
              hostname: 'example.com',
              order: `b${String(card).padStart(2, '0')}`,
              pinned: false,
              lastOpenedAt: null,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            });
          }
        }
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        database.close();
      },
      { deckCount: WORKSPACE_DECKS, cardCount: WORKSPACE_CARDS },
    );
    await page.reload();
    await page.waitForSelector(READY_SELECTOR);
    await page.keyboard.press('Control+J');
    await page.getByRole('button', { name: 'Load test' }).click();
    await expect(page.locator('[data-deck="deck"]')).toHaveCount(
      WORKSPACE_DECKS,
    );
    await expect(page.locator('[data-deck="card"]')).toHaveCount(
      WORKSPACE_CARDS,
    );
    const accent = page.locator('[data-deck-id="deck_perf_00"]');
    const colors: string[] = [];
    for (const theme of ['night', 'day']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const pair = await accent.evaluate((element) => {
        const title = element.querySelector('.deck-column__title');
        if (!title) throw new Error('Deck title missing');
        return {
          border: getComputedStyle(element).borderBlockStartColor,
          title: getComputedStyle(title).color,
        };
      });
      expect(pair.title).toBe(pair.border);
      colors.push(pair.border);
    }
    expect(colors[0]).not.toBe(colors[1]);
    const scroll = await page
      .locator('[data-deck="decks"]')
      .evaluate(async (element, frames) => {
        if (element.scrollHeight <= element.clientHeight)
          throw new Error('Workspace does not scroll');
        const stamps: number[] = [];
        await new Promise<void>((resolve) => {
          const tick = (time: number) => {
            stamps.push(time);
            element.scrollTop += 12;
            if (stamps.length < frames) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        const gaps = stamps
          .slice(1)
          .map((time, index) => time - (stamps[index] ?? time));
        const span = (stamps.at(-1) ?? 0) - (stamps[0] ?? 0);
        return {
          fps: (gaps.length * 1000) / span,
          worstFrameMs: Math.max(...gaps),
        };
      }, SCROLL_FRAMES);
    await testInfo.attach('workspace-scroll.json', {
      body: JSON.stringify({
        decks: WORKSPACE_DECKS,
        cards: WORKSPACE_CARDS,
        scroll,
        colors,
      }),
      contentType: 'application/json',
    });
    expectWithinBudget('workspace scroll fps', scroll.fps, { min: 59 });
  } finally {
    await context.close();
  }
});
