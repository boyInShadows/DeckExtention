import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { launchExtension } from './extension';

const READY = 'html[data-deck-ready="true"]';
const HINT_TEXT = 'Type >help and press Enter for shortcuts.';
const hint = (page: Page) =>
  page.locator('[data-deck="toast"]').filter({ hasText: HINT_TEXT });

test('first-run hint opens help by keyboard and returns focus to the Line', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await expect(hint(page)).toBeVisible();
    await page.screenshot({
      path: 'docs/artifacts/first-run-hint-20261112/narrow-hint.png',
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const action = hint(page).getByRole('button', { name: 'Show shortcuts' });
    await action.focus();
    await action.press('Enter');
    await expect(
      page.getByRole('dialog', { name: 'Keyboard', exact: true }),
    ).toBeVisible();
    await expect(hint(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-deck="help"]')).toHaveCount(0);
    await expect(page.locator('[data-deck="line"] input')).toBeFocused();
    await page.reload();
    await page.waitForSelector(READY);
    await expect(page.locator('[data-deck="toast-stack"]')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem('deck:first-run-hint')),
      )
      .toBe('shown');
  } finally {
    await context.close();
  }
});

test('hint controls fit Day, Night, narrow windows and actual 200 percent zoom', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await expect(hint(page)).toBeVisible();
    for (const theme of ['day', 'night']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(
          hint(page).getByRole('button', { name: 'Show shortcuts' }),
        ).toBeInViewport();
        await expect(
          hint(page).getByRole('button', { name: 'Dismiss', exact: true }),
        ).toBeInViewport();
        const box = await hint(page).boundingBox();
        if (!box) throw new Error('Missing shortcut hint geometry');
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: `docs/artifacts/first-run-hint-20261112/${theme}-${width}.png`,
          animations: 'disabled',
        });
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    const extensionPage = await page.evaluate(() => {
      localStorage.removeItem('deck:first-run-hint');
      return chrome.runtime.getURL('src/newtab/index.html');
    });
    await page.goto(extensionPage);
    await page.waitForSelector(READY);
    await expect(hint(page)).toBeVisible();
    const originalRatio = await page.evaluate(() => devicePixelRatio);
    await page.evaluate(() => chrome.tabs.setZoom(2));
    await expect
      .poll(() => page.evaluate(() => devicePixelRatio))
      .toBe(originalRatio * 2);
    await expect(
      hint(page).getByRole('button', { name: 'Show shortcuts' }),
    ).toBeInViewport();
    await expect(
      hint(page).getByRole('button', { name: 'Dismiss', exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: 'docs/artifacts/first-run-hint-20261112/zoom-200.png',
      animations: 'disabled',
    });
    await page.locator('[data-deck="line"] input').click();
    await expect(hint(page)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('concurrent tabs share one hint claim and dismissal survives another tab', async () => {
  const context = await launchExtension();
  try {
    const pages = [await context.newPage(), await context.newPage()] as const;
    await Promise.all(
      pages.map(async (page) => {
        await page.goto('chrome://newtab/');
        await page.waitForSelector(READY);
      }),
    );
    await expect
      .poll(async () =>
        (await Promise.all(pages.map((page) => hint(page).count()))).reduce(
          (sum, count) => sum + count,
          0,
        ),
      )
      .toBe(1);
    const claimant = (await hint(pages[0]).count()) ? pages[0] : pages[1];
    await claimant.bringToFront();
    await hint(claimant)
      .getByRole('button', { name: 'Dismiss', exact: true })
      .click();
    await expect(hint(claimant)).toHaveCount(0);
    const next = await context.newPage();
    await next.goto('chrome://newtab/');
    await next.waitForSelector(READY);
    await expect
      .poll(() =>
        next.evaluate(() => localStorage.getItem('deck:first-run-hint')),
      )
      .toBe('shown');
    await expect(hint(next)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('hint is accessible without moving the surface and disappears on typing', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await expect(hint(page)).toBeVisible();
    const geometry = () =>
      page
        .locator('[data-deck="clock"], [data-deck="line"]')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          }),
        );
    const before = await geometry();
    await expect(
      hint(page).getByRole('button', { name: 'Show shortcuts' }),
    ).toBeInViewport();
    await expect(
      hint(page).getByRole('button', { name: 'Dismiss', exact: true }),
    ).toBeInViewport();
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-deck="toast-stack"]')
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.keyboard.press('Tab');
    await expect(hint(page)).toBeVisible();
    await page.locator('[data-deck="line"] input').press('x');
    await expect(hint(page)).toHaveCount(0);
    expect(await geometry()).toEqual(before);
    await page.screenshot({
      path: 'docs/artifacts/first-run-hint-20261112/narrow-dismissed.png',
    });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
