import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { launchExtension } from './extension';

test('Day and System light share readable surface, settings and drawer styles', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(60_000);
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    let dayPalette: string[] = [];
    for (const theme of ['Day', 'System']) {
      const line = page.locator('[data-deck="line"] input');
      await line.fill('>settings');
      await line.press('Enter');
      await page
        .getByRole('group', { name: 'Theme', exact: true })
        .getByRole('button', { name: theme, exact: true })
        .click();
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        theme.toLowerCase(),
      );
      await expect
        .poll(() =>
          page.locator('body').evaluate((body) => {
            const style = getComputedStyle(body);
            const paint = document.createElement('canvas').getContext('2d');
            if (!paint) throw new Error('Theme colour probe unavailable');
            const normalize = (value: string) => {
              paint.fillStyle = value;
              return paint.fillStyle;
            };
            return (
              normalize(style.color) ===
                normalize(style.getPropertyValue('--deck-color-text')) &&
              normalize(style.backgroundColor) ===
                normalize(style.getPropertyValue('--deck-color-canvas'))
            );
          }),
        )
        .toBe(true);
      const palette = await page.locator('body').evaluate((body) => {
        const style = getComputedStyle(body);
        return [
          style.backgroundColor,
          style.backgroundImage,
          style.color,
          ...[
            '--deck-color-panel-glass',
            '--deck-color-focus',
            '--deck-color-hairline',
          ].map((name) => style.getPropertyValue(name)),
        ];
      });
      if (theme === 'Day') dayPalette = palette;
      else expect(palette).toEqual(dayPalette);
      for (const width of [1440, 375, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const settingsScan = await new AxeBuilder({ page })
          .include('[data-deck="settings"]')
          .analyze();
        expect(settingsScan.violations).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(`settings-${theme}-${width}.png`),
          animations: 'disabled',
        });
        await page
          .getByRole('button', { name: 'Close settings', exact: true })
          .click();
        await expect(page.locator('[data-deck="settings"]')).toHaveCount(0);
        await expect(page.locator('[data-deck="toast"]')).toHaveCount(0);
        await page.screenshot({
          path: testInfo.outputPath(`surface-${theme}-${width}.png`),
          animations: 'disabled',
        });
        const surfaceScan = await new AxeBuilder({ page })
          .include('[data-deck="surface-column"]')
          .include('[data-deck="section-nav"]')
          .analyze();
        expect(surfaceScan.violations).toEqual([]);
        await page
          .getByRole('button', { name: 'Open Tasks', exact: true })
          .click();
        await expect(page.locator('[data-deck="task-manager"]')).toBeVisible();
        const drawerScan = await new AxeBuilder({ page })
          .include('[data-deck="drawer"]')
          .analyze();
        expect(drawerScan.violations).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(`drawer-${theme}-${width}.png`),
          animations: 'disabled',
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.getByLabel('Close Deck drawer', { exact: true }).click();
        await expect(page.locator('[data-deck="drawer"]')).toHaveCount(0);
        await line.fill('>settings');
        await line.press('Enter');
      }
      await page
        .getByRole('button', { name: 'Close settings', exact: true })
        .click();
      await expect(page.locator('[data-deck="settings"]')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
