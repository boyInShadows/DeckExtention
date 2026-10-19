import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { launchExtension } from './extension';

test('surface, drawer, Settings, and help have no serious accessibility violations', async () => {
  test.setTimeout(120_000);
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await expect(page.locator('html[data-deck-ready="true"]')).toHaveCount(1);
    const findings: string[] = [];
    const scan = async (screen: string) => {
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      findings.push(
        ...violations
          .filter(({ impact }) => impact === 'serious' || impact === 'critical')
          .map(
            ({ id, nodes }) =>
              `${screen}: ${id} (${nodes.map(({ target }) => target.join(' ')).join(', ')})`,
          ),
      );
    };

    await scan('surface');
    await page.getByLabel('Open Deck drawer').click();
    await expect(page.locator('[data-deck="drawer"][data-open]')).toBeVisible();
    await scan('drawer');
    await page.getByLabel('Close Deck drawer').click();
    await expect(page.locator('[data-deck="drawer"]')).toHaveCount(0);
    await page.locator('[data-deck="settings-toggle"]').click();
    await expect(page.locator('[data-deck="settings"]')).toBeVisible();
    await scan('Settings');
    await page.getByLabel('Close settings').click();
    await page.keyboard.press('?');
    await expect(page.locator('[data-deck="help"]')).toBeVisible();
    await scan('help');
    expect(findings).toEqual([]);
  } finally {
    await context.close();
  }
});
