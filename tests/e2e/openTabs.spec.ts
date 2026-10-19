import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { join } from 'node:path';
import { launchExtension } from './extension';
import {
  createPermissionFixture,
  removePermissionFixture,
} from './permissionFixture';

const TAB_COUNT = 40;
const READY = 'html[data-deck-ready="true"]';

test('pregranted fixture: each of 40 tabs across two windows switches with Enter; s saves and x closes safely', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(120_000);
  const fixture = await createPermissionFixture('tabs');
  const context = await launchExtension(join(fixture, 'dist'));
  try {
    await context.route('http://tabs.test/**', (route) => {
      const key = new URL(route.request().url()).pathname.slice(1);
      return route.fulfill({
        contentType: 'text/html',
        body: `<title>Research ${key}</title><p>${key}</p>`,
      });
    });
    const deck = await context.newPage();
    await deck.goto('chrome://newtab/');
    await deck.waitForSelector(READY);
    const fixtures = [];
    for (let index = 0; index < TAB_COUNT; index += 1) {
      const key = `target${String(index + 1).padStart(2, '0')}`;
      const page = await context.newPage();
      await page.goto(`http://tabs.test/${key}`);
      fixtures.push({ key, page });
    }
    const targets = await deck.evaluate(async () =>
      (await chrome.tabs.query({ url: 'http://tabs.test/*' })).flatMap((tab) =>
        tab.id === undefined || !tab.url ? [] : [{ id: tab.id, url: tab.url }],
      ),
    );
    expect(targets).toHaveLength(TAB_COUNT);
    const otherWindowId = await deck.evaluate(
      async (ids) => {
        const [first, ...rest] = ids;
        if (first === undefined) throw new Error('Missing tab fixture');
        const window = await chrome.windows.create({ tabId: first });
        if (window.id === undefined) throw new Error('Missing window fixture');
        await chrome.tabs.move(rest, { windowId: window.id, index: -1 });
        return window.id;
      },
      targets.slice(TAB_COUNT / 2).map((tab) => tab.id),
    );
    const line = deck.locator('[data-deck="line"] input');
    for (const { key } of fixtures) {
      await deck.bringToFront();
      await line.fill(key);
      const row = deck.locator('[data-deck="tab-activate"]');
      await expect(row).toHaveCount(8);
      await expect(row.first()).toContainText(`Research ${key}`);
      const target = targets.find((tab) => tab.url.endsWith(key));
      if (!target) throw new Error('Missing target fixture');
      await line.press('Enter');
      await expect
        .poll(() =>
          deck.evaluate(async (id) => {
            const tab = await chrome.tabs.get(id);
            return (
              tab.active && (await chrome.windows.get(tab.windowId)).focused
            );
          }, target.id),
        )
        .toBe(true);
    }
    expect(
      await deck.evaluate(() =>
        chrome.tabs
          .query({ url: 'http://tabs.test/*' })
          .then((tabs) => tabs.length),
      ),
    ).toBe(TAB_COUNT);
    await deck.bringToFront();
    await line.fill('>tabs');
    const allRows = deck.locator('[data-deck="tab-activate"]');
    await expect(allRows).toHaveCount(8);
    await line.press('ArrowDown');
    await deck.keyboard.press('ArrowUp');
    await expect(allRows.last()).toBeFocused();
    const lastRowBox = await allRows.last().boundingBox();
    if (!lastRowBox) throw new Error('Missing focused tab row');
    expect(lastRowBox.y).toBeGreaterThanOrEqual(0);
    expect(lastRowBox.y + lastRowBox.height).toBeLessThanOrEqual(
      await deck.evaluate(() => innerHeight),
    );
    await deck.keyboard.press('Escape');
    await expect(line).toBeFocused();
    await line.fill('"target40');
    await expect(deck.locator('[data-deck="tab-result"]')).toContainText(
      'Window 2',
    );
    await line.press('s');
    await line.fill('"target40');
    await line.press('x');
    expect(
      await deck.evaluate(() =>
        chrome.tabs
          .query({ url: 'http://tabs.test/*' })
          .then((tabs) => tabs.length),
      ),
    ).toBe(TAB_COUNT);
    await line.fill('"target40');
    await line.press('ArrowDown');
    const selected = deck.locator('[data-deck="tab-activate"]');
    await expect(selected).toBeFocused();
    await deck.keyboard.press('s');
    await expect(deck.locator('[data-deck="toast"]')).toContainText(
      'Saved to Inbox',
    );
    await expect(
      deck.locator('[data-deck="line-results"] [data-deck="card"]'),
    ).toHaveCount(1);
    await expect(selected).toHaveAttribute('data-active');
    for (const theme of ['night', 'day']) {
      await deck.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await deck.setViewportSize({
        width: theme === 'night' ? 1280 : 640,
        height: 800,
      });
      await deck.screenshot({
        path: testInfo.outputPath(`open-tabs-${theme}.png`),
      });
      expect(
        await deck.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    const accessibility = await new AxeBuilder({ page: deck })
      .include('[data-deck="line-shell"]')
      .analyze();
    expect(
      accessibility.violations.filter((issue) =>
        ['serious', 'critical'].includes(issue.impact ?? ''),
      ),
    ).toEqual([]);
    await selected.focus();
    await deck.keyboard.press('x');
    await expect
      .poll(() =>
        deck.evaluate(() =>
          chrome.tabs
            .query({ url: 'http://tabs.test/*' })
            .then((tabs) => tabs.length),
        ),
      )
      .toBe(TAB_COUNT - 1);
    await expect(line).toBeFocused();
    await expect(
      deck.locator('[data-deck="line-results"] [data-deck="card"]'),
    ).toHaveCount(1);
    await line.fill('"target11');
    await expect(deck.locator('[data-deck="tab-result"]')).toHaveCount(1);
    const external = fixtures.find((fixture) => fixture.key === 'target11');
    if (!external) throw new Error('Missing external tab fixture');
    await external.page.evaluate(() => {
      document.title = 'Renamed research';
    });
    await expect(deck.locator('[data-deck="tab-result"]')).toHaveCount(0);
    await line.fill('renamed');
    await expect(deck.locator('[data-deck="tab-activate"]')).toContainText(
      'Renamed research',
    );
    await external.page.close();
    await expect(deck.locator('[data-deck="tab-result"]')).toHaveCount(0);
    expect(
      await deck.evaluate(
        (id) =>
          chrome.windows
            .get(id)
            .then((window) => window.tabs?.length ?? window.id !== undefined),
        otherWindowId,
      ),
    ).toBeTruthy();
  } finally {
    await context.close();
    await removePermissionFixture(fixture);
  }
});

test('production: missing tab access leaves saved search usable and >tabs explains access without prompting', async () => {
  const context = await launchExtension();
  try {
    const deck = await context.newPage();
    await deck.goto('chrome://newtab/');
    await deck.waitForSelector(READY);
    const line = deck.locator('[data-deck="line"] input');
    await line.fill('MDN');
    await expect(
      deck.locator('[data-deck="line-results"] [data-deck="card"]'),
    ).toContainText('MDN');
    await expect(deck.locator('[data-deck="tab-result"]')).toHaveCount(0);
    await line.fill('>tabs');
    await line.press('Enter');
    await expect(deck.locator('[data-deck="toast"]')).toContainText(
      'Deck needs tab access to find open tabs',
    );
    await expect(
      deck.getByRole('button', { name: 'Allow', exact: true }),
    ).toBeVisible();
    await deck.getByRole('button', { name: 'Dismiss', exact: true }).click();
    expect(
      await deck.evaluate(() =>
        chrome.permissions.contains({ permissions: ['tabs'] }),
      ),
    ).toBe(false);
    await line.fill('MDN');
    await expect(
      deck.locator('[data-deck="line-results"] [data-deck="card"]'),
    ).toContainText('MDN');
  } finally {
    await context.close();
  }
});
