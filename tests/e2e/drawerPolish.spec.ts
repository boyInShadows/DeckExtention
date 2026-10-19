import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { launchExtension } from './extension';

const SAVED_SCROLL = 40;
const RAPID_OPENS = 50;
const MAX_FRAME_GAP_MS = 50;

async function dispatchDrawer(context: BrowserContext): Promise<void> {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (!tab) throw new Error('No active tab');
    const command = chrome.commands.onCommand as unknown as {
      dispatch: (name: string, tab: chrome.tabs.Tab) => void;
    };
    command.dispatch('toggle-drawer', tab);
  });
}

async function openDeck(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto('chrome://newtab/');
  await expect(page.locator('html[data-deck-ready="true"]')).toHaveCount(1);
  return page;
}

test('drawer remembers its page across tabs and the command targets the active tab', async () => {
  const context = await launchExtension();
  try {
    const first = await openDeck(context);
    await first.getByRole('button', { name: 'Open Deck drawer' }).click();
    await expect(
      first.locator('[data-deck="drawer"][data-open]'),
    ).toBeVisible();
    const examples = first.locator('[data-deck="page"]', {
      hasText: 'Examples',
    });
    await examples.dblclick();
    await first.locator('[data-deck="page-name"]').fill('Work');
    await first.locator('[data-deck="page-name"]').press('Enter');
    await expect(
      first.locator('[data-deck="page"][data-selected]'),
    ).toContainText('Work');
    const workspace = first.locator('[data-deck="decks"]');
    expect(
      await workspace.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    ).toBeGreaterThan(SAVED_SCROLL);
    await workspace.evaluate((element, scroll) => {
      element.scrollTop = scroll;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    }, SAVED_SCROLL);

    const second = await openDeck(context);
    await second.getByRole('button', { name: 'Open Deck drawer' }).click();
    await expect(
      second.locator('[data-deck="page"][data-selected]'),
    ).toContainText('Work');
    await expect
      .poll(() =>
        second
          .locator('[data-deck="decks"]')
          .evaluate((element) => element.scrollTop),
      )
      .toBe(SAVED_SCROLL);
    const tabCount = context.pages().length;
    await dispatchDrawer(context);
    await expect(second.locator('[data-deck="drawer"][data-open]')).toHaveCount(
      0,
    );
    expect(context.pages()).toHaveLength(tabCount);

    await context.route('http://deck.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Site</title>' }),
    );
    const site = await context.newPage();
    await site.goto('http://deck.test/');
    await site.bringToFront();
    const created = context.waitForEvent('page');
    await dispatchDrawer(context);
    const fromSite = await created;
    await expect(
      fromSite.locator('[data-deck="drawer"][data-open]'),
    ).toBeVisible();
    await expect(
      fromSite.locator('[data-deck="page"][data-selected]'),
    ).toContainText('Work');
  } finally {
    await context.close();
  }
});

test('fifty rapid drawer opens keep animation frames responsive', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await openDeck(context);
    await page.getByRole('button', { name: 'Open Deck drawer' }).click();
    await expect(page.locator('[data-deck="drawer"][data-open]')).toBeVisible();
    const gaps = await page.evaluate(async (opens) => {
      const frames: number[] = [];
      let isRunning = true;
      const tick = (time: number) => {
        frames.push(time);
        if (isRunning) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const toggle = () =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'j',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      for (let index = 0; index < opens; index += 1) {
        toggle();
        await nextFrame();
        toggle();
        await nextFrame();
      }
      isRunning = false;
      return frames
        .slice(1)
        .map((time, index) => time - (frames[index] ?? time));
    }, RAPID_OPENS);
    const worst = Math.max(...gaps);
    await testInfo.attach('drawer-frame-gaps.json', {
      body: JSON.stringify({
        opens: RAPID_OPENS,
        frames: gaps.length,
        worstFrameMs: worst,
        droppedFrames: gaps.filter((gap) => gap > 34).length,
      }),
      contentType: 'application/json',
    });
    expect(worst).toBeLessThan(MAX_FRAME_GAP_MS);
    expect(gaps.filter((gap) => gap > 34)).toHaveLength(0);
  } finally {
    await context.close();
  }
});
