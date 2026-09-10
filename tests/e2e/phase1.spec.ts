import { expect, test, chromium, type BrowserContext } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EXTENSION_PATH = resolve('apps/extension/dist');
const READY_SELECTOR = 'html[data-deck-ready="true"]';
const WARM_RUNS = 20;

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
    expect(Math.max(...timings)).toBeLessThan(60);
  } finally {
    await context.close();
  }
});
