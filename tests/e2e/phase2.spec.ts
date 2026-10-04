import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { launchExtension } from './extension';

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

/** Keydown → first painted frame with the drawer open, measured in-page. */
async function measureDrawerOpen(page: Page): Promise<number> {
  const measured = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let startedAt = 0;
        const onKey = (event: KeyboardEvent) => {
          if (event.ctrlKey && event.key.toLowerCase() === 'j')
            startedAt = event.timeStamp;
        };
        window.addEventListener('keydown', onKey, { capture: true });
        const observer = new MutationObserver(() => {
          if (!document.querySelector('[data-deck="drawer"][data-open]'))
            return;
          observer.disconnect();
          window.removeEventListener('keydown', onKey, { capture: true });
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve(performance.now() - startedAt)),
          );
        });
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
        });
      }),
  );
  await page.keyboard.press('Control+J');
  return measured;
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
    await expect(page.getByRole('alert')).toHaveText(
      `Saved to Inbox: ${ARTICLE_TITLE}`,
    );

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
    await page.keyboard.press('j');
    await page.keyboard.press('d');
    await expect(decks).toHaveCount(2);

    // Triage: the saved page is in the Inbox; m, type, Enter.
    await page.locator('[data-deck="page"][data-system]').click();
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
    const drag = await dragWithFrameCount(
      page,
      await centre(page, savedCard),
      await centre(page, examples),
    );
    await expect(examples.locator('[data-deck="card"]')).toHaveCount(7);
    await expect(examples).toContainText(ARTICLE_TITLE);

    // Export, and the saved page is in the file, in its new deck.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export data' }).click();
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
    expect(sortedOpen.at(-1)).toBeLessThan(DRAWER_OPEN_BUDGET_MS);
    expect(drag.fps).toBeGreaterThan(DRAG_MIN_FPS);
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
