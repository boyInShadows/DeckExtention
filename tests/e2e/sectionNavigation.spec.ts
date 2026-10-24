import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { launchExtension } from './extension';

test('glass sections: direct navigation, persistent tasks, undo, notes, keyboard and responsive themes', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(60_000);
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    const nav = page.getByRole('navigation', { name: 'Workspace sections' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({
      path: testInfo.outputPath('surface-desktop.png'),
      animations: 'disabled',
    });
    await nav.getByRole('button', { name: 'Open Tasks', exact: true }).click();
    const manager = page.locator('[data-deck="task-manager"]');
    const input = manager.getByRole('textbox', { name: 'What needs doing?' });
    await expect(manager).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
    for (const title of [
      'Review the homepage draft',
      'Read the saved article',
      'Plan tomorrow’s focus',
    ]) {
      await input.fill(title);
      await input.press('Enter');
      await expect(input).toHaveValue('');
      await expect(
        manager.getByRole('button', { name: title, exact: true }),
      ).toBeVisible();
    }
    const checkbox = manager.getByRole('checkbox', {
      name: 'Toggle task: Read the saved article',
    });
    await checkbox.focus();
    await checkbox.press('Space');
    await expect(checkbox).toHaveCount(0);
    await manager.getByRole('button', { name: /^Completed \d+$/ }).click();
    await expect(checkbox).toBeChecked();
    await page.reload();
    await page.waitForSelector('html[data-deck-ready="true"]');
    await nav.getByRole('button', { name: 'Open Tasks', exact: true }).click();
    await manager.getByRole('button', { name: /^Completed \d+$/ }).click();
    await expect(checkbox).toBeChecked();
    await manager.getByRole('button', { name: 'Move task to Trash' }).click();
    await expect(checkbox).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(checkbox).toBeChecked();
    await checkbox.click();
    await manager.getByRole('button', { name: /^Open \d+$/ }).click();
    await expect(checkbox).not.toBeChecked();
    await manager
      .getByRole('button', { name: 'Review the homepage draft', exact: true })
      .click();
    const note = page.locator('[data-deck="note"] textarea');
    await expect(note).toBeFocused();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (
          this.name === 'cards' &&
          (value as { note?: string }).note === 'Keep unsaved task note'
        )
          throw new Error('Fixture note write failed');
        return put.call(this, value, key);
      };
    });
    await note.fill('Keep unsaved task note');
    await nav
      .getByRole('button', { name: 'Open Sessions', exact: true })
      .click();
    await expect(note).toHaveValue('Keep unsaved task note');
    await expect(manager).toBeVisible();
    await expect(
      page.locator('[data-deck="toast"][role="alert"]').first(),
    ).toContainText('Fixture note write failed');
    await note.fill(
      'Review the homepage draft\nKeep this note when switching sections.',
    );
    await nav
      .getByRole('button', { name: 'Open Sessions', exact: true })
      .click();
    await expect(note).toHaveCount(0);
    await expect(
      page.locator('[data-deck="pages"] button[data-selected]'),
    ).toHaveAttribute('aria-label', 'Sessions');
    await nav.getByRole('button', { name: 'Open Inbox', exact: true }).click();
    await expect(page.locator('[data-deck="inbox"]')).toBeVisible();
    await nav.getByRole('button', { name: 'Open Links', exact: true }).click();
    await expect(page.locator('[data-deck="decks"]')).toBeVisible();
    await nav.getByRole('button', { name: 'Open Tasks', exact: true }).click();
    await manager
      .getByRole('button', { name: 'Review the homepage draft', exact: true })
      .click();
    await expect(note).toHaveValue(
      'Review the homepage draft\nKeep this note when switching sections.',
    );
    await note.press('Escape');
    await expect(note).toHaveCount(0);
    await expect(
      manager.getByRole('button', {
        name: 'Review the homepage draft',
        exact: true,
      }),
    ).toBeFocused();
    await page
      .locator('[data-deck="pages"]')
      .getByRole('button', { name: 'Examples', exact: true })
      .click();
    await expect(page.locator('[data-deck="decks"]')).toBeVisible();
    await nav.getByRole('button', { name: 'Open Tasks', exact: true }).click();
    await expect(manager).toBeVisible();
    await page.keyboard.press('Control+J');
    await expect(page.locator('[data-deck="drawer"]')).toHaveCount(0);
    await page.keyboard.press('Control+J');
    await expect(manager).toBeVisible();
    await page
      .locator('[data-deck="toast"][role="alert"]')
      .getByRole('button', { name: 'Dismiss', exact: true })
      .first()
      .click();
    await expect(page.locator('[data-deck="toast"][role="alert"]')).toHaveCount(
      0,
    );
    for (const theme of ['night', 'day']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 900 });
        await expect
          .poll(() =>
            page.evaluate(() =>
              document
                .getAnimations()
                .some((animation) => animation.playState === 'running'),
            ),
          )
          .toBe(false);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(
          await manager.evaluate(
            (node) => node.scrollWidth <= node.clientWidth,
          ),
        ).toBe(true);
        const axe = await new AxeBuilder({ page })
          .include('[data-deck="task-manager"]')
          .include('[data-deck="section-nav"]')
          .analyze();
        expect(axe.violations).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(`tasks-${theme}-${width}.png`),
          animations: 'disabled',
        });
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await input.focus();
    await input.press('Escape');
    await expect(page.locator('[data-deck="drawer"]')).toHaveCount(0);
    await nav.getByRole('button', { name: 'Open Tasks', exact: true }).click();
    await expect(manager).toBeFocused();
    expect(
      await page
        .locator('[data-deck="drawer"]')
        .evaluate((node) =>
          node
            .getAnimations()
            .some(
              (animation) =>
                Number(animation.effect?.getTiming().duration) > 0.01,
            ),
        ),
    ).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
