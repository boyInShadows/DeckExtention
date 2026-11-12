import { expect, test } from '@playwright/test';
import { launchExtension } from './extension';

for (const alias of ['>help', '>keys', '>shortcuts']) {
  test(`${alias} opens existing help and Escape restores the unchanged Line`, async () => {
    const context = await launchExtension();
    try {
      const page = await context.newPage();
      await page.goto('chrome://newtab/');
      await page.waitForSelector('html[data-deck-ready="true"]');
      const line = page.locator('[data-deck="line"] input');
      const help = page.getByRole('dialog', { name: 'Keyboard', exact: true });
      await line.fill(alias);
      await expect(help).toHaveCount(0);
      await line.press('Enter');
      await expect(help).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(help).toHaveCount(0);
      await expect(line).toBeFocused();
      await expect(line).toHaveValue(alias);
    } finally {
      await context.close();
    }
  });
}
