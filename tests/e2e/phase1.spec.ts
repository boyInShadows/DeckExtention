import { expect, test, chromium, type BrowserContext } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EXTENSION_PATH = resolve('apps/extension/dist');
const READY_SELECTOR = 'html[data-deck-ready="true"]';
const WARM_RUNS = 20;
const DRAWER_TEST_TIMEOUT_MS = 120_000;

function chromeExecutable(): string {
  const playwrightRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const playwrightChromium = existsSync(playwrightRoot)
    ? readdirSync(playwrightRoot)
        .filter((name) => name.startsWith('chromium-'))
        .toSorted()
        .reverse()
        .map((name) => join(playwrightRoot, name, 'chrome-win64/chrome.exe'))
        .find(existsSync)
    : undefined;
  const candidates = [
    playwrightChromium,
    join(
      process.env.PROGRAMFILES ?? '',
      'Google/Chrome/Application/chrome.exe',
    ),
    join(
      process.env['PROGRAMFILES(X86)'] ?? '',
      'Google/Chrome/Application/chrome.exe',
    ),
  ];
  const executable = candidates.find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate)),
  );
  if (!executable)
    throw new Error('Google Chrome is required for extension E2E tests.');
  return executable;
}

async function launchExtension(): Promise<BrowserContext> {
  return chromium.launchPersistentContext('', {
    executablePath: chromeExecutable(),
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
}

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
    expect(medianTiming).toBeLessThan(60);
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
