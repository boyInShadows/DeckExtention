import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { launchExtension } from './extension';
import { SETTINGS_DEFAULTS } from '../../packages/schema/src/constants';

const READY = 'html[data-deck-ready="true"]';
const PIN_COUNT = 19;

async function seed(page: Page, count = PIN_COUNT) {
  await page.evaluate(
    async ({ count, defaults }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('deck');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction(['cards', 'meta'], 'readwrite');
      const cards = tx.objectStore('cards');
      for (let i = 0; i < count; i += 1) {
        cards.put({
          id: `pin_fixture_${i}`,
          deckId: 'deck_inbox',
          title: `Pinned link ${i + 1}`,
          url: `https://pin${i}.example/`,
          hostname: `pin${i}.example`,
          order: `a${String(i).padStart(2, '0')}`,
          pinned: true,
          lastOpenedAt: null,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
        });
      }
      const meta = tx.objectStore('meta');
      const read = meta.get('settings');
      read.onsuccess = () =>
        meta.put({
          key: 'settings',
          value: {
            ...(read.result?.value ?? defaults),
            showShelf: true,
            shelfDeckIds: ['deck_examples'],
            ownerName: 'A long greeting for a focused workday',
            showGoogleSuggestions: false,
          },
        });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    },
    { count, defaults: SETTINGS_DEFAULTS },
  );
  await page.reload();
  await page.waitForSelector(READY);
  await expect(page.locator('[data-deck="shelf"]')).toBeVisible();
  await expect(page.locator('[data-deck="resurface"]')).toBeVisible();
}

async function assertFixed(page: Page) {
  expect(
    await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    })),
  ).toEqual(
    await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    })),
  );
  for (const selector of [
    'line',
    'pins-grid',
    'pins-controls',
    'drawer-handle',
    'surface-controls',
  ]) {
    const rect = await page.locator(`[data-deck="${selector}"]`).boundingBox();
    if (!rect) throw new Error(`Missing geometry for ${selector}`);
    expect(rect.y, selector).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.height, selector).toBeLessThanOrEqual(
      await page.evaluate(() => innerHeight),
    );
  }
  const pins = await page.locator('[data-deck="pins"]').boundingBox();
  const extras = await page
    .locator('[data-deck="surface-extras"]')
    .boundingBox();
  const handle = await page
    .locator('[data-deck="drawer-handle"]')
    .boundingBox();
  if (!pins || !extras || !handle) throw new Error('Missing surface geometry');
  expect(pins.y + pins.height).toBeLessThanOrEqual(extras.y);
  expect(extras.y + extras.height).toBeLessThanOrEqual(handle.y);
  await page.mouse.wheel(0, 500);
  expect(await page.evaluate(() => scrollY)).toBe(0);
}

test('six pins per group fit a fixed surface with optional content and preserve every saved link', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(90_000);
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    for (const [width, height] of [
      [1440, 900],
      [1024, 600],
      [375, 812],
      [320, 568],
      [640, 360],
    ] as const) {
      await page.setViewportSize({ width, height });
      await assertFixed(page);
      await expect(page.locator('[data-deck="pin"]')).toHaveCount(6);
      await page.screenshot({
        path: testInfo.outputPath(`pins-${width}-${height}.png`),
        animations: 'disabled',
      });
    }
    const names: string[] = [];
    for (let group = 0; group < 4; group += 1) {
      names.push(
        ...(await page
          .locator('[data-deck="pin"]')
          .evaluateAll((pins) =>
            pins.map((pin) => pin.getAttribute('aria-label') ?? ''),
          )),
      );
      if (group < 3) {
        await page
          .getByRole('button', { name: 'More links', exact: true })
          .focus();
        await page.keyboard.press('Enter');
      }
    }
    expect(names).toEqual(
      Array.from({ length: PIN_COUNT }, (_, i) => `Pinned link ${i + 1}`),
    );
    await page.setViewportSize({ width: 375, height: 812 });
    await page
      .getByRole('button', { name: 'Previous links', exact: true })
      .click();
    const pin = page.locator('[data-deck="pin"]').last();
    await pin.focus();
    await pin.press('Shift+F10');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click();
    await expect(page.locator('[data-deck="toast"]')).toContainText('Unpin');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('[data-deck="pins-range"]')).toContainText(
      `of ${PIN_COUNT}`,
    );
    await page.reload();
    await page.waitForSelector(READY);
    await expect(page.locator('[data-deck="pins-range"]')).toContainText(
      `of ${PIN_COUNT}`,
    );
    await page.locator('[data-deck="settings-toggle"]').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export data', exact: true }).click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('Missing exported file');
    const { readFile } = await import('node:fs/promises');
    const exported = JSON.parse(await readFile(path, 'utf8'));
    expect(
      exported.cards.filter((card: { pinned: boolean }) => card.pinned),
    ).toHaveLength(PIN_COUNT);
    await page.keyboard.press('Escape');
    const scan = await new AxeBuilder({ page })
      .include('[data-deck="pins"]')
      .analyze();
    expect(scan.violations).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const count of [6, 12]) {
  test(`${count} pins keep every group reachable in Day and Night`, async ({
    browserName,
  }, testInfo) => {
    expect(browserName).toBe('chromium');
    const context = await launchExtension();
    try {
      const page = await context.newPage();
      await page.goto('chrome://newtab/');
      await page.waitForSelector(READY);
      await seed(page, count);
      for (const theme of ['Day', 'Night']) {
        await page.getByLabel('Settings', { exact: true }).click();
        await page.getByRole('button', { name: theme, exact: true }).click();
        await page.getByLabel('Close settings', { exact: true }).click();
        await expect(page.locator('[data-deck="toast"]')).toHaveCount(0);
        for (const [width, height] of [
          [1440, 900],
          [375, 812],
          [320, 568],
          [640, 360],
        ] as const) {
          await page.setViewportSize({ width, height });
          await assertFixed(page);
          await expect(page.locator('[data-deck="pin"]')).toHaveCount(6);
          if (count === 12) {
            await page
              .getByRole('button', { name: 'More links', exact: true })
              .click();
            await expect(
              page.locator('[data-deck="pin"]').first(),
            ).toHaveAttribute('aria-label', 'Pinned link 7');
            await page
              .getByRole('button', { name: 'Previous links', exact: true })
              .click();
          }
          await page.screenshot({
            path: testInfo.outputPath(`${count}-pins-${theme}-${width}.png`),
            animations: 'disabled',
          });
        }
      }
      if (count === 6) {
        await page
          .getByRole('button', { name: 'Add pin', exact: true })
          .click();
        const form = page.getByRole('dialog', { name: 'Add pin', exact: true });
        await form
          .getByRole('textbox', { name: 'Paste a URL', exact: true })
          .fill('https://seventh.example/');
        await form
          .getByRole('textbox', { name: 'Label (optional)', exact: true })
          .fill('Seventh link');
        await form
          .getByRole('button', { name: 'Add pin', exact: true })
          .click();
        const added = page.locator('[data-deck="pin"]').first();
        await expect(added).toHaveAttribute('aria-label', 'Seventh link');
        await expect(page.locator('[data-deck="pin"]')).toHaveCount(1);
        await added.press('ContextMenu');
        await page
          .getByRole('menuitem', { name: 'Rename pin', exact: true })
          .click();
        const editor = page.getByRole('dialog', {
          name: 'Pin label',
          exact: true,
        });
        await editor.getByRole('textbox').fill('Renamed seventh link');
        await editor.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(added).toHaveAttribute(
          'aria-label',
          'Renamed seventh link',
        );
        await page.reload();
        await page.waitForSelector(READY);
        await page
          .getByRole('button', { name: 'More links', exact: true })
          .click();
        await expect(added).toHaveAttribute(
          'aria-label',
          'Renamed seventh link',
        );
      }
    } finally {
      await context.close();
    }
  });
}

test('a real 200 percent browser zoom keeps controls and bounded search reachable', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    const extensionPage = await page.evaluate(() =>
      chrome.runtime.getURL('src/newtab/index.html'),
    );
    await page.goto(extensionPage);
    await page.waitForSelector(READY);
    const originalRatio = await page.evaluate(() => devicePixelRatio);
    await page.evaluate(() => chrome.tabs.setZoom(2));
    await expect
      .poll(() => page.evaluate(() => devicePixelRatio))
      .toBe(originalRatio * 2);
    await assertFixed(page);
    const line = page.locator('[data-deck="line"] input');
    await line.fill('pinned');
    const results = page.locator('[data-deck="line-results"]');
    await expect(results).toBeVisible();
    const last = results.locator('[data-deck="card"]').last();
    await last.focus();
    await expect(last).toBeInViewport();
    const bounds = await results.boundingBox();
    if (!bounds) throw new Error('Missing search geometry');
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(
      await page.evaluate(() => innerHeight),
    );
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await line.focus();
    await page.keyboard.press('Escape');
    await expect(results).toHaveCount(0);
    const review = page.locator('[data-deck="resurface-trash"]');
    await review.focus();
    await expect(review).toBeInViewport();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath('pins-browser-200-percent.png'),
      animations: 'disabled',
    });
  } finally {
    await context.close();
  }
});

test('search stays bounded after changing the greeting without remounting results', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    await page.getByLabel('Settings', { exact: true }).click();
    await page.getByLabel('Your name', { exact: true }).fill('A');
    await page.getByLabel('Close settings', { exact: true }).click();
    await expect(page.locator('[data-deck="greeting"]')).toHaveText(/, A$/);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const line = page.locator('[data-deck="line"] input');
    await line.fill('pinned');
    const results = page.locator('[data-deck="line-results"]');
    const before = await results.boundingBox();
    if (!before) throw new Error('Missing initial search geometry');
    await page.getByLabel('Settings', { exact: true }).focus();
    await page.keyboard.press('Enter');
    await page
      .getByLabel('Your name', { exact: true })
      .fill('A long name '.repeat(6).trim());
    await page.getByLabel('Close settings', { exact: true }).click();
    await expect(page.locator('[data-deck="greeting"]')).toContainText(
      'A long name '.repeat(6).trim(),
    );
    const after = await results.boundingBox();
    if (!after) throw new Error('Missing updated search geometry');
    expect(after.y).toBeGreaterThan(before.y);
    expect(after.y + after.height).toBeCloseTo(before.y + before.height, 0);
    expect(after.y + after.height).toBeLessThanOrEqual(812);
    await results.locator('[data-deck="card"]').last().focus();
    await expect(results.locator('[data-deck="card"]').last()).toBeInViewport();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.getByLabel('Settings', { exact: true }).click();
    await expect(page.locator('[data-deck="settings"]')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('compact Day fallback icons keep theme contrast over local wallpaper', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seed(page);
    await page.getByLabel('Settings', { exact: true }).click();
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const paint = canvas.getContext('2d');
      if (!paint) throw new Error('Missing wallpaper canvas');
      paint.fillStyle = 'white';
      paint.fillRect(0, 0, 64, 64);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.getByLabel('Local', { exact: true }).setInputFiles({
      name: 'white.png',
      mimeType: 'image/png',
      buffer: Buffer.from(image, 'base64'),
    });
    await expect(page.locator('[data-deck="wallpaper"]')).toHaveAttribute(
      'data-loaded',
      'true',
    );
    await page.getByLabel('Close settings', { exact: true }).click();
    const themeColor = await page
      .locator('body')
      .evaluate((body) => getComputedStyle(body).color);
    await expect(
      page.locator('[data-deck="pin"] [data-deck="site-icon"]').first(),
    ).toHaveCSS('color', themeColor);
    await assertFixed(page);
    await page.screenshot({
      path: testInfo.outputPath('compact-day-white-wallpaper.png'),
      animations: 'disabled',
    });
  } finally {
    await context.close();
  }
});
