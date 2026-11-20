import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { launchExtension } from './extension';

const START = new Date(2026, 10, 20, 10).getTime();
const READY = 'html[data-deck-ready="true"]';

test('compact progress stays in Focus navigation across panels, tabs, pause and reload', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(START));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    const url = await page.evaluate(() =>
      chrome.runtime.getURL('src/newtab/index.html'),
    );
    await page.goto(`${url}?focus-compact`);
    await page.waitForSelector(READY);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve(null)),
          ),
        ),
    );
    const nav = page.getByRole('navigation', { name: 'Workspace sections' });
    await page.getByRole('button', { name: 'Open Focus', exact: true }).click();
    await page.getByLabel('Minutes', { exact: true }).fill('1');
    const bounds = await nav.boundingBox();
    await page
      .getByRole('button', { name: 'Start focus', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Pause focus', exact: true }),
    ).toBeEnabled();
    await page.clock.setFixedTime(new Date(START + 30_000));
    await expect(
      page.locator('[data-deck="focus-compact-countdown"]'),
    ).toHaveText('00:30');
    await page
      .getByRole('button', { name: 'Pause focus', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Resume focus', exact: true }),
    ).toBeEnabled();
    await page.getByLabel('Close Deck drawer', { exact: true }).click();
    await expect(page.locator('[data-deck="focus"]')).toHaveCount(0);
    expect(await nav.boundingBox()).toEqual(bounds);
    const indicator = page.locator('[data-deck="focus-indicator"]');
    await expect(indicator).toHaveAttribute('title', 'Focus paused · 00:30');
    await expect(indicator.locator('progress')).toHaveAttribute('value', '0.5');
    for (const [name, width, height] of [
      ['desktop', 1440, 900],
      ['narrow', 320, 600],
      ['short', 640, 360],
      ['zoom', 1280, 1200],
    ] as const) {
      await page.setViewportSize({ width, height });
      if (name === 'zoom') {
        const ratio = await page.evaluate(() => devicePixelRatio);
        await page.evaluate(async () => {
          const tab = await chrome.tabs.getCurrent();
          if (tab?.id === undefined) throw new Error('No test tab');
          await chrome.tabs.setZoom(tab.id, 2);
        });
        await expect
          .poll(() => page.evaluate(() => devicePixelRatio))
          .toBe(ratio * 2);
      }
      await expect(indicator).toBeInViewport();
      await page
        .getByRole('button', { name: 'Open Focus', exact: true })
        .focus();
      await expect(
        page.getByRole('button', { name: 'Open Focus', exact: true }),
      ).toBeFocused();
      const scan = await new AxeBuilder({ page })
        .include('[data-deck="section-nav"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      expect(scan.violations).toEqual([]);
      expect(
        await indicator.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const parent = element.closest('button')?.getBoundingClientRect();
          return (
            parent &&
            box.width > 0 &&
            box.x >= parent.x &&
            box.right <= parent.right &&
            box.y >= parent.y &&
            box.bottom <= parent.bottom
          );
        }),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`focus-compact-${name}.png`),
        animations: 'disabled',
      });
    }
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-deck="focus"]')).toBeVisible();
    await expect(page.locator('[data-deck="focus"] progress')).toHaveAttribute(
      'value',
      '0.5',
    );
    const other = await context.newPage();
    await other.clock.setFixedTime(new Date(START + 120_000));
    await other.goto('chrome://newtab/');
    await other.waitForSelector(READY);
    await expect(
      other.locator('[data-deck="focus-compact-countdown"]'),
    ).toHaveText('00:30');
    await other.reload();
    await other.waitForSelector(READY);
    await expect(
      other.locator('[data-deck="focus-indicator"] progress'),
    ).toHaveAttribute('value', '0.5');
    await other
      .getByRole('button', { name: 'Open Focus', exact: true })
      .click();
    await other
      .getByRole('button', { name: 'Stop focus', exact: true })
      .click();
    await expect(other.locator('[data-deck="focus-indicator"]')).toHaveCount(0);
    await page.bringToFront();
    await expect(page.locator('[data-deck="focus-indicator"]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('focus progress fills from timestamps and fits narrow, short and native zoom layouts', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date(START));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    const url = await page.evaluate(() =>
      chrome.runtime.getURL('src/newtab/index.html'),
    );
    await page.goto(`${url}?focus-progress`);
    await page.waitForSelector(READY);
    await page.getByRole('button', { name: 'Open Focus', exact: true }).click();
    await page.getByLabel('Minutes', { exact: true }).fill('1');
    await page
      .getByRole('button', { name: 'Start focus', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Pause focus', exact: true }),
    ).toBeEnabled();
    const progress = page.locator('[data-deck="focus"] progress');
    await expect(progress).toHaveAttribute('value', '0');
    await page.clock.setFixedTime(new Date(START + 30_000));
    await expect(progress).toHaveAttribute('value', '0.5');
    await expect(page.getByRole('timer')).toHaveText('00:30');
    for (const [name, width, height] of [
      ['desktop', 1440, 900],
      ['narrow', 320, 600],
      ['short', 640, 360],
      ['zoom', 1280, 1200],
    ] as const) {
      await page.setViewportSize({ width, height });
      if (name === 'zoom') {
        const ratio = await page.evaluate(() => devicePixelRatio);
        await page.evaluate(async () => {
          const tab = await chrome.tabs.getCurrent();
          if (tab?.id === undefined) throw new Error('No test tab');
          await chrome.tabs.setZoom(tab.id, 2);
        });
        await expect
          .poll(() => page.evaluate(() => devicePixelRatio))
          .toBe(ratio * 2);
      }
      await progress.scrollIntoViewIfNeeded();
      await expect(progress).toBeInViewport();
      expect(
        await progress.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.width > 0 &&
            box.height > 0 &&
            box.x >= 0 &&
            box.right <= innerWidth
          );
        }),
      ).toBe(true);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.documentElement.scrollHeight <= innerHeight,
        ),
      ).toBe(true);
      const scan = await new AxeBuilder({ page })
        .include('[data-deck="focus"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      expect(scan.violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`focus-progress-${name}.png`),
        animations: 'disabled',
      });
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
