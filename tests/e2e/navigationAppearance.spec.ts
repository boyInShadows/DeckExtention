import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { launchExtension } from './extension';

test('navigation stays transparent with distinct icons, hover, focus and selection', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(60_000);
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    await page.evaluate(() => document.fonts.ready);
    const nav = page.getByRole('navigation', { name: 'Workspace sections' });
    const buttons = nav.getByRole('button');
    const tasks = nav.getByRole('button', { name: 'Open Tasks', exact: true });
    expect(
      new Set(
        await nav
          .locator('svg')
          .evaluateAll((icons) => icons.map((icon) => icon.innerHTML)),
      ).size,
    ).toBe(4);

    for (const theme of ['night', 'day']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      for (const width of [1440, 768, 375, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: testInfo.outputPath(`navigation-${theme}-${width}.png`),
          animations: 'disabled',
        });
        await expect(nav).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(nav).toHaveCSS('box-shadow', 'none');
        await expect(nav).toHaveCSS('backdrop-filter', 'none');
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const bounds = await nav.boundingBox();
        expect(bounds?.x).toBeGreaterThanOrEqual(0);
        expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
          width,
        );
        for (const button of await buttons.all()) {
          await expect(button).toBeVisible();
          await expect(button).toHaveCSS(
            'background-color',
            'rgba(0, 0, 0, 0)',
          );
          const target = await button.boundingBox();
          expect(target?.width).toBeGreaterThanOrEqual(44);
          expect(target?.height).toBeGreaterThanOrEqual(44);
          await button.hover();
          const label = await button.locator('span').boundingBox();
          if ((await button.getAttribute('title')) === 'Sessions') {
            await page.screenshot({
              path: testInfo.outputPath(`sessions-hover-${theme}-${width}.png`),
              animations: 'disabled',
            });
          }
          expect(label?.x).toBeGreaterThanOrEqual((target?.x ?? 0) + 8);
          expect((label?.x ?? 0) + (label?.width ?? 0)).toBeLessThanOrEqual(
            (target?.x ?? 0) + (target?.width ?? 0) - 8,
          );
          await page.mouse.move(0, 0);
        }
        await tasks.hover();
        await expect(tasks).not.toHaveCSS(
          'background-color',
          'rgba(0, 0, 0, 0)',
        );
        await page.mouse.move(0, 0);
        await page.keyboard.press('Tab');
        await buttons.first().focus();
        for (let index = 0; index < 4; index += 1) {
          const button = buttons.nth(index);
          await expect(button).toBeFocused();
          await expect(button).toHaveCSS('outline-style', 'solid');
          await expect(button).not.toHaveCSS('outline-width', '0px');
          await expect(button).not.toHaveCSS(
            'background-color',
            'rgba(0, 0, 0, 0)',
          );
          if (index < 3) await page.keyboard.press('Tab');
        }
        await tasks.focus();
        await page.keyboard.press('Enter');
        await expect(tasks).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('[data-deck="task-manager"]')).toBeVisible();
        await expect(tasks).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(tasks.locator('span')).toHaveCSS(
          'text-decoration-line',
          'underline',
        );
        if (width < 900) {
          const rail = await nav.boundingBox();
          const clock = await page.locator('[data-deck="clock"]').boundingBox();
          const drawer = await page
            .locator('[data-deck="drawer"]')
            .boundingBox();
          expect(rail?.y).toBeGreaterThanOrEqual(
            (clock?.y ?? 0) + (clock?.height ?? 0),
          );
          expect((rail?.y ?? 0) + (rail?.height ?? 0)).toBeLessThanOrEqual(
            drawer?.y ?? 0,
          );
        }
        const scan = await new AxeBuilder({ page })
          .include('[data-deck="section-nav"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(scan.violations).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(
            `navigation-selected-${theme}-${width}.png`,
          ),
          animations: 'disabled',
        });
        await page.getByLabel('Close Deck drawer', { exact: true }).click();
        await expect(page.locator('[data-deck="drawer"]')).toHaveCount(0);
        await expect(tasks).not.toHaveAttribute('aria-current', 'page');
        await page.locator('[data-deck="line"] input').focus();
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('transparent navigation remains readable on light and dark local wallpapers', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    const nav = page.getByRole('navigation', { name: 'Workspace sections' });
    const surface = page.locator('[data-deck="surface"]');
    for (const theme of ['Night', 'Day']) {
      for (const color of ['white', 'black']) {
        const line = page.locator('[data-deck="line"] input');
        await line.fill('>settings');
        await line.press('Enter');
        await page
          .getByRole('group', { name: 'Theme', exact: true })
          .getByRole('button', { name: theme, exact: true })
          .click();
        const image = await page.evaluate((fill) => {
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 64;
          const paint = canvas.getContext('2d');
          if (!paint) throw new Error('Wallpaper fixture canvas unavailable');
          paint.fillStyle = fill;
          paint.fillRect(0, 0, canvas.width, canvas.height);
          return canvas
            .toDataURL('image/png')
            .slice('data:image/png;base64,'.length);
        }, color);
        const previousStyle = await surface.getAttribute('style');
        await page.getByLabel('Local', { exact: true }).setInputFiles({
          name: `${color}.png`,
          mimeType: 'image/png',
          buffer: Buffer.from(image, 'base64'),
        });
        await expect(surface).not.toHaveAttribute('style', previousStyle ?? '');
        await expect(page.locator('[data-deck="wallpaper"]')).toHaveAttribute(
          'data-loaded',
          'true',
        );
        await page
          .getByRole('button', { name: 'Close settings', exact: true })
          .click();
        await expect(nav).toHaveCSS('color', 'rgb(255, 255, 255)');
        await expect(nav).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await page.screenshot({
          path: testInfo.outputPath(`wallpaper-${theme}-${color}.png`),
          animations: 'disabled',
        });
        await nav
          .getByRole('button', { name: 'Open Tasks', exact: true })
          .hover();
        const scan = await new AxeBuilder({ page })
          .include('[data-deck="section-nav"]')
          .analyze();
        expect(scan.violations).toEqual([]);
        await page.mouse.move(0, 0);
      }
    }
  } finally {
    await context.close();
  }
});
