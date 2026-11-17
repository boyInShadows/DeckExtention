import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { launchExtension } from './extension';

const READY = 'html[data-deck-ready="true"]';
const WEEK = '[data-deck="week"]';
const WEEK_SETTING = 'Show ISO week number with date';

async function setWeek(page: Page, isEnabled: boolean) {
  await page.locator('[data-deck="settings-toggle"]').click();
  await page
    .getByRole('checkbox', { name: WEEK_SETTING })
    .setChecked(isEnabled);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-deck="settings"]')).toHaveCount(0);
}

async function geometry(page: Page) {
  return page.evaluate(() =>
    ['clock', 'date', 'line', 'pins'].map((name) => {
      const element = document.querySelector(`[data-deck="${name}"]`);
      if (!element) throw new Error(`Missing ${name}`);
      const { x, y, width, height } = element.getBoundingClientRect();
      return { name, x, y, width, height };
    }),
  );
}

test('week is opt-in, keeps clock/date controls and survives reload and actual JSON import', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(2027, 0, 1, 12));
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await page.evaluate(() => document.fonts.ready);
    const before = await geometry(page);
    await expect(page.locator(WEEK)).toHaveCount(0);
    await page.locator('[data-deck="settings-toggle"]').click();
    const setting = page.getByRole('checkbox', { name: WEEK_SETTING });
    await expect(setting).not.toBeChecked();
    await setting.check();
    await page.getByRole('checkbox', { name: '12-hour clock' }).check();
    await page.keyboard.press('Escape');
    await expect(page.locator(WEEK)).toHaveText(' · 2026-W53');
    await expect(page.locator(WEEK)).toHaveAttribute(
      'aria-label',
      'ISO week 53, 2026',
    );
    expect(await geometry(page)).toEqual(before);
    await page.reload();
    await page.waitForSelector(READY);
    await expect(page.locator(WEEK)).toContainText('2026-W53');
    await page.locator('[data-deck="settings-toggle"]').click();
    await expect(setting).toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: '12-hour clock' }),
    ).toBeChecked();
    await page
      .getByRole('checkbox', { name: 'Show date', exact: true })
      .uncheck();
    await page.keyboard.press('Escape');
    await expect(page.locator(WEEK)).toHaveCount(0);
    await page.locator('[data-deck="settings-toggle"]').click();
    await expect(setting).toBeChecked();
    await page
      .getByRole('checkbox', { name: 'Show date', exact: true })
      .check();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export data', exact: true }).click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('Missing exported JSON');
    const json = await readFile(path, 'utf8');
    expect(JSON.parse(json).settings.showWeekNumber).toBe(true);
    await setting.uncheck();
    await page.getByLabel('Import data', { exact: true }).setInputFiles({
      name: 'week.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    const preview = page.locator('[data-deck="data-import-preview"]');
    await preview.getByRole('button', { name: 'Replace', exact: true }).click();
    await preview.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('[data-deck="settings"]')).toHaveCount(0);
    await expect(page.locator(WEEK)).toContainText('2026-W53');
    await page.locator('[data-deck="settings-toggle"]').click();
    await expect(setting).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(page.locator(WEEK)).toContainText('2026-W53');
    await setWeek(page, false);
    await page.reload();
    await page.waitForSelector(READY);
    await expect(page.locator(WEEK)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('week changes at local Monday midnight without reloading', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.clock.install({ time: new Date(2021, 0, 3, 23, 58) });
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await setWeek(page, true);
    await expect(page.locator(WEEK)).toContainText('2020-W53');
    await page.clock.fastForward(3 * 60_000);
    await expect(page.locator(WEEK)).toContainText('2021-W01');
  } finally {
    await context.close();
  }
});

for (const theme of ['day', 'night']) {
  test(`week fits stable surface geometry and scoped accessibility in ${theme}`, async ({
    browserName,
  }, testInfo) => {
    expect(browserName).toBe('chromium');
    const context = await launchExtension();
    try {
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date(2026, 8, 30, 12));
      await page.goto('chrome://newtab/');
      await page.waitForSelector(READY);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('[data-deck="settings-toggle"]').click();
      await page
        .getByRole('button', {
          name: theme === 'day' ? 'Day' : 'Night',
          exact: true,
        })
        .click();
      await page.keyboard.press('Escape');
      for (const [width, height] of [
        [1440, 720],
        [320, 720],
        [320, 600],
      ]) {
        await page.setViewportSize({ width, height });
        const before = await geometry(page);
        await setWeek(page, true);
        await expect(page.locator(WEEK)).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(await geometry(page)).toEqual(before);
        const date = page.locator('[data-deck="date"]');
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-deck="date"]')
              .analyze()
          ).violations,
        ).toEqual([]);
        const bounds = await date.boundingBox();
        if (!bounds) throw new Error('Missing date');
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(
          await date.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);
        if (height === 600)
          await expect(page.locator('[data-deck="toast"]')).toHaveCount(0);
        await page.screenshot({
          path: testInfo.outputPath(`week-${theme}-${width}-${height}.png`),
          animations: 'disabled',
        });
        await setWeek(page, false);
        expect(await geometry(page)).toEqual(before);
      }
    } finally {
      await context.close();
    }
  });
}

test('week and its setting remain reachable at real 200 percent zoom', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    const url = await page.evaluate(() =>
      chrome.runtime.getURL('src/newtab/index.html'),
    );
    await page.goto(`${url}?iso-week-zoom`);
    await page.waitForSelector(READY);
    await page.setViewportSize({ width: 1280, height: 1200 });
    const ratio = await page.evaluate(() => devicePixelRatio);
    await page.evaluate(async () => {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id === undefined) throw new Error('Missing tab');
      await chrome.tabs.setZoom(tab.id, 2);
    });
    await expect
      .poll(() => page.evaluate(() => devicePixelRatio))
      .toBe(ratio * 2);
    const before = await geometry(page);
    await page.locator('[data-deck="settings-toggle"]').click();
    const toggle = page.getByRole('checkbox', { name: WEEK_SETTING });
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(toggle).toBeFocused();
    const bounds = await toggle.boundingBox();
    const panel = await page.locator('[data-deck="settings"]').boundingBox();
    if (!bounds || !panel) throw new Error('Missing settings bounds');
    expect(bounds.y).toBeGreaterThanOrEqual(panel.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(
      panel.y + panel.height,
    );
    await page.keyboard.press('Escape');
    await expect(page.locator(WEEK)).toBeVisible();
    expect(await geometry(page)).toEqual(before);
  } finally {
    await context.close();
  }
});
