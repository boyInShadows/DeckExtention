import { expect, test, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { launchExtension } from './extension';

const READY = 'html[data-deck-ready="true"]';
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
  { width: 320, height: 568 },
  { width: 640, height: 360 },
] as const;

async function expectReadablePanel(panel: Locator) {
  await expect(panel).toBeVisible();
  const audit = await panel.evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const tinyText: string[] = [];
    while (walker.nextNode()) {
      const text = walker.currentNode;
      const element = text.parentElement;
      if (
        !text.textContent?.trim() ||
        !element?.checkVisibility() ||
        element.closest('svg, style, script')
      )
        continue;
      if (parseFloat(getComputedStyle(element).fontSize) < 13)
        tinyText.push(text.textContent.trim());
    }
    const spillingTitles = [
      ...node.querySelectorAll<HTMLElement>('[data-deck="deck-title"]'),
    ]
      .filter(
        (title) =>
          title.scrollWidth > title.clientWidth &&
          getComputedStyle(title).overflowX !== 'hidden',
      )
      .map((title) => title.textContent);
    return {
      tinyText,
      spillingTitles,
      overflow: node.scrollWidth > node.clientWidth,
    };
  });
  expect(audit.tinyText).toEqual([]);
  expect(audit.spillingTitles).toEqual([]);
  expect(audit.overflow).toBe(false);
}

for (const count of [0, 6]) {
  test(`Add pin fits without popup scrolling with ${count} existing pins`, async ({
    browserName,
  }, testInfo) => {
    expect(browserName).toBe('chromium');
    const context = await launchExtension();
    try {
      const page = await context.newPage();
      await page.goto('chrome://newtab/');
      await page.waitForSelector(READY);
      for (let index = 0; index < count; index += 1) {
        await page
          .getByRole('button', { name: 'Add pin', exact: true })
          .click();
        const dialog = page.getByRole('dialog', {
          name: 'Add pin',
          exact: true,
        });
        await dialog
          .getByRole('textbox', { name: 'Paste a URL', exact: true })
          .fill(`https://spacing${index}.example/`);
        await dialog
          .getByRole('button', { name: 'Add pin', exact: true })
          .click();
      }
      for (const theme of ['Day', 'Night']) {
        await page.getByLabel('Settings', { exact: true }).click();
        await page.getByRole('button', { name: theme, exact: true }).click();
        await page.getByLabel('Close settings', { exact: true }).click();
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport);
          await page
            .getByRole('button', { name: 'Add pin', exact: true })
            .click();
          const dialog = page.getByRole('dialog', {
            name: 'Add pin',
            exact: true,
          });
          await expect(dialog.getByRole('textbox').first()).toBeFocused();
          await page.screenshot({
            path: testInfo.outputPath(
              `add-pin-${count}-${theme}-${viewport.width}.png`,
            ),
            animations: 'disabled',
          });
          const geometry = await dialog.evaluate((node) => {
            const panel = node.getBoundingClientRect();
            return {
              scrollWidth: node.scrollWidth,
              clientWidth: node.clientWidth,
              scrollHeight: node.scrollHeight,
              clientHeight: node.clientHeight,
              start: panel.y,
              end: panel.bottom,
              controls: [...node.querySelectorAll('input, button')].map(
                (control) => {
                  const box = control.getBoundingClientRect();
                  return {
                    unobstructed: control.contains(
                      document.elementFromPoint(
                        box.x + box.width / 2,
                        box.y + box.height / 2,
                      ),
                    ),
                    inside:
                      box.x >= panel.x &&
                      box.right <= panel.right &&
                      box.y >= panel.y &&
                      box.bottom <= panel.bottom,
                    font: parseFloat(getComputedStyle(control).fontSize),
                    height: box.height,
                  };
                },
              ),
            };
          });
          expect(geometry.scrollWidth).toBeLessThanOrEqual(
            geometry.clientWidth,
          );
          expect(geometry.scrollHeight).toBeLessThanOrEqual(
            geometry.clientHeight,
          );
          expect(geometry.start).toBeGreaterThanOrEqual(0);
          expect(geometry.end).toBeLessThanOrEqual(viewport.height);
          expect(geometry.controls.every(({ inside }) => inside)).toBe(true);
          expect(geometry.controls.every(({ font }) => font >= 13)).toBe(true);
          expect(geometry.controls.every(({ height }) => height >= 44)).toBe(
            true,
          );
          expect(
            geometry.controls.every(({ unobstructed }) => unobstructed),
          ).toBe(true);
          if (viewport.width === 1440 && theme === 'Day') {
            const scan = await new AxeBuilder({ page })
              .include('[data-deck="pin-add-form"]')
              .analyze();
            expect(scan.violations).toEqual([]);
          }
          await dialog.getByRole('textbox').last().press('Escape');
          await expect(dialog).toHaveCount(0);
          await expect(
            page.getByRole('button', { name: 'Add pin', exact: true }),
          ).toBeFocused();
          expect(await page.evaluate(() => scrollY)).toBe(0);
        }
      }
      const scan = await new AxeBuilder({ page })
        .include('[data-deck="pins"]')
        .analyze();
      expect(scan.violations).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test('primary section order and readable controls stay consistent when the drawer opens', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    for (const viewport of [VIEWPORTS[0], VIEWPORTS[1]]) {
      await page.setViewportSize(viewport);
      const nav = page.getByRole('navigation', {
        name: 'Workspace sections',
        exact: true,
      });
      const closedOrder = await nav
        .locator('[data-deck="section-label"]')
        .allTextContents();
      expect(closedOrder).toEqual([
        'Links',
        'Tasks',
        'Inbox',
        'Sessions',
        'Focus',
      ]);
      await nav
        .getByRole('button', { name: 'Open Inbox', exact: true })
        .click();
      const rail = page.locator('[data-deck="pages"]');
      await expect(rail).toBeVisible();
      await expect(rail.getByRole('button').first()).toBeVisible();
      const openedOrder = await rail
        .getByRole('button')
        .evaluateAll((buttons) =>
          buttons
            .slice(0, 5)
            .map((button) => button.getAttribute('aria-label')),
        );
      await page.screenshot({
        path: testInfo.outputPath(`drawer-order-${viewport.width}.png`),
        animations: 'disabled',
      });
      expect(openedOrder).toEqual(closedOrder);
      await page.getByLabel('Close Deck drawer', { exact: true }).click();
    }
  } finally {
    await context.close();
  }
});

test('Add pin stays fully visible at real 200 percent zoom and preserves invalid drafts', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    const url = await page.evaluate(() =>
      chrome.runtime.getURL('src/newtab/index.html'),
    );
    await page.goto(url);
    await page.waitForSelector(READY);
    const ratio = await page.evaluate(() => devicePixelRatio);
    await page.evaluate(() => chrome.tabs.setZoom(2));
    await expect
      .poll(() => page.evaluate(() => devicePixelRatio))
      .toBe(ratio * 2);
    const trigger = page.getByRole('button', { name: 'Add pin', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Add pin', exact: true });
    const input = dialog.getByRole('textbox').first();
    await input.fill('invalid URL');
    await input.press('Enter');
    await expect(
      page.locator('[data-deck="toast"][data-kind="error"]'),
    ).toBeVisible();
    await expect(input).toHaveValue('invalid URL');
    const bounds = await dialog.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        viewport: innerHeight,
        overflow:
          node.scrollHeight > node.clientHeight ||
          node.scrollWidth > node.clientWidth,
      };
    });
    expect(bounds.overflow).toBe(false);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewport);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(0);
  } finally {
    await context.close();
  }
});

test('surface, Settings, help and every primary section keep readable type and bounded spacing', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(60_000);
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
      await page.setViewportSize(viewport);
      for (const theme of ['Day', 'Night']) {
        await page.getByLabel('Settings', { exact: true }).click();
        await page.getByRole('button', { name: theme, exact: true }).click();
        await expectReadablePanel(page.locator('[data-deck="settings"]'));
        await page.screenshot({
          path: testInfo.outputPath(`settings-${theme}-${viewport.width}.png`),
          animations: 'disabled',
        });
        await page.getByLabel('Close settings', { exact: true }).click();
        await expect(page.locator('[data-deck="toast"]')).toHaveCount(0);
        await expectReadablePanel(page.locator('[data-deck="surface"]'));
        await page
          .locator('[data-deck="line"] input')
          .evaluate((input) => input.blur());
        await page.keyboard.press('?');
        await expectReadablePanel(page.locator('[data-deck="help"]'));
        await page.screenshot({
          path: testInfo.outputPath(`help-${theme}-${viewport.width}.png`),
          animations: 'disabled',
        });
        await page.keyboard.press('Escape');
        for (const section of ['Links', 'Tasks', 'Inbox', 'Sessions']) {
          await page
            .getByRole('button', { name: `Open ${section}`, exact: true })
            .click();
          await expectReadablePanel(page.locator('[data-deck="drawer"]'));
          await page.screenshot({
            path: testInfo.outputPath(
              `${section}-${theme}-${viewport.width}.png`,
            ),
            animations: 'disabled',
          });
          await page.getByLabel('Close Deck drawer', { exact: true }).click();
        }
      }
    }
  } finally {
    await context.close();
  }
});
