import { expect, test } from '@playwright/test';

import { launchExtension } from './extension';

test('pins have inline editing, an anchored keyboard menu, and a letter fallback', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    await page.getByRole('button', { name: 'Add pin' }).click();
    await page
      .getByRole('textbox', { name: 'Paste a URL' })
      .fill('https://www.wikipedia.org/');
    await page.getByRole('button', { name: 'Add pin' }).click();
    const pin = page.locator('[data-deck="pin"]').first();
    await expect(pin).toHaveAttribute('aria-label', 'Wikipedia');

    await pin.click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('pin-menu.png') });
    const pinBox = await pin.boundingBox();
    const menuBox = await menu.boundingBox();
    if (!pinBox || !menuBox)
      throw new Error('Pin menu has no visible geometry');
    expect(Math.abs(menuBox.x - pinBox.x)).toBeLessThan(40);
    await page.keyboard.press('ArrowDown');
    await expect(
      menu.getByRole('menuitem', { name: 'Emoji icon' }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(pin).toBeFocused();

    await pin.press('Space');
    await expect(pin).toHaveAttribute('data-dragging', 'true');
    await expect(pin).toBeFocused();
    await page.evaluate(
      () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    );
    await pin.press('Escape');
    await expect(pin).not.toHaveAttribute('data-dragging', 'true');

    await pin.press('ContextMenu');
    await menu.getByRole('menuitem', { name: 'Rename pin' }).click();
    const editor = page.getByRole('dialog', { name: 'Pin label' });
    await editor.getByRole('textbox', { name: 'Pin label' }).fill('Research');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('[data-deck="pin"]').first()).toHaveAttribute(
      'aria-label',
      'Research',
    );

    await page.getByRole('button', { name: 'Add pin' }).click();
    await page
      .getByRole('textbox', { name: 'Paste a URL' })
      .fill('https://void-site.invalid/');
    await page.getByRole('button', { name: 'Add pin' }).click();
    const fallback = page
      .locator('[data-deck="pin"]')
      .nth(1)
      .locator('[data-deck="site-icon"] span');
    await expect(fallback).toHaveText('V');
    await expect(fallback).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('pins.png') });

    await page.locator('[data-deck="pin"]').nth(1).press('Delete');
    await expect(page.locator('[data-deck="pin"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('[data-deck="pin"]')).toHaveCount(2);
  } finally {
    await context.close();
  }
});
