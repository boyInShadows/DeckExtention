import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

import { launchExtension } from './extension';

const SCREEN_DIR = resolve('docs/screens');
const CAPTURE = process.env.DECK_CAPTURE_S13 === '1';
const SETTINGS_WIDTH = 820;
const COMPACT_WIDTH = 680;
const CENTER_TOLERANCE_PX = 2;

test('polished surface and panels adapt to theme and viewport', async () => {
  test.setTimeout(120_000);
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('chrome://newtab/');
    await expect(page.locator('html[data-deck-ready="true"]')).toHaveCount(1);
    await expect(page.locator('[data-deck="date"]')).toBeVisible();
    await expect(page.locator('[data-deck="pins-empty"]')).toBeVisible();
    if (CAPTURE) {
      mkdirSync(SCREEN_DIR, { recursive: true });
      await page.screenshot({ path: resolve(SCREEN_DIR, 's13-night.png') });
    }

    await page.locator('[data-deck="settings-toggle"]').click();
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await page.getByLabel('Close settings').click();
    await expect(page.locator('html[data-theme="day"]')).toHaveCount(1);
    await expect(page.locator('[data-deck="toast"]')).toHaveCount(0);
    if (CAPTURE)
      await page.screenshot({ path: resolve(SCREEN_DIR, 's13-day.png') });

    await page.setViewportSize({ width: SETTINGS_WIDTH, height: 700 });
    await page.locator('[data-deck="settings-toggle"]').click();
    const settings = page.locator('[data-deck="settings"]');
    await expect(settings).toBeVisible();
    expect((await settings.boundingBox())?.width).toBe(SETTINGS_WIDTH);
    if (CAPTURE)
      await page.screenshot({
        path: resolve(SCREEN_DIR, 's13-settings-820.png'),
      });
    await page.getByLabel('Close settings').click();

    await page.setViewportSize({ width: COMPACT_WIDTH, height: 700 });
    await page.locator('[data-deck="drawer-handle"]').click();
    const rail = page.locator('[data-deck="pages"]');
    await expect(rail).toBeVisible();
    expect((await rail.boundingBox())?.width).toBeLessThan(80);
    const clock = await page.locator('[data-deck="clock"]').boundingBox();
    expect(clock).not.toBeNull();
    expect(
      Math.abs((clock?.x ?? 0) + (clock?.width ?? 0) / 2 - COMPACT_WIDTH / 2),
    ).toBeLessThan(CENTER_TOLERANCE_PX);
    if (CAPTURE)
      await page.screenshot({
        path: resolve(SCREEN_DIR, 's13-drawer-680.png'),
      });
  } finally {
    await context.close();
  }
});
