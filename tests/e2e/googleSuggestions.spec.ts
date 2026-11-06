import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { launchExtension } from './extension';
import {
  createPermissionFixture,
  removePermissionFixture,
} from './permissionFixture';

const PROVIDER = 'https://suggestqueries.google.com/**';
const NO_REQUEST_WINDOW_MS = 400;

test('default Deck never requests Google suggestions and keeps a clear search action', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const manifest = JSON.parse(
    await readFile('apps/extension/dist/manifest.json', 'utf8'),
  );
  expect(manifest.permissions).toEqual([
    'storage',
    'unlimitedStorage',
    'favicon',
    'contextMenus',
  ]);
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.optional_host_permissions).toEqual([
    'https://suggestqueries.google.com/*',
  ]);
  const context = await launchExtension();
  let requests = 0;
  try {
    await context.route(PROVIDER, (route) => {
      requests += 1;
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    const line = page.locator('[data-deck="line"] input');
    await line.fill('something entirely new');
    await expect(page.locator('[data-deck="web-search-result"]')).toContainText(
      'something entirely new',
    );
    await expect(page.locator('[data-deck="line-results"]')).not.toContainText(
      'No matches.',
    );
    await page.waitForTimeout(NO_REQUEST_WINDOW_MS);
    expect(requests).toBe(0);
    await line.fill('>settings');
    await line.press('Enter');
    const control = page.getByLabel('Google suggestions', { exact: true });
    await expect(control).not.toBeChecked();
    await control.scrollIntoViewIfNeeded();
    const scan = await new AxeBuilder({ page })
      .include('[data-deck="google-suggestions-setting"]')
      .analyze();
    expect(scan.violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath('google-opt-in-off.png'),
      animations: 'disabled',
    });
  } finally {
    await context.close();
  }
});

test('pregranted fixture: Google results, keyboard, clicks, safe text and offline fallback', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(60_000);
  const fixture = await createPermissionFixture('googleSuggestions');
  const context = await launchExtension(join(fixture, 'dist'));
  const queries: string[] = [];
  try {
    await context.route(PROVIDER, (route) => {
      const query = new URL(route.request().url()).searchParams.get('q') ?? '';
      queries.push(query);
      if (query === 'unavailable') return route.abort('failed');
      const items =
        query === 'unsafe'
          ? ['<img src=x onerror=alert(1)>']
          : [`${query} ideas`, `${query} plans`];
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([query, items]),
      });
    });
    await context.route('https://www.google.com/search?**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Search destination</title>',
      }),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const openDeck = async () => {
      await page.goto('chrome://newtab/');
      await page.waitForSelector('html[data-deck-ready="true"]');
    };
    await openDeck();
    const line = page.locator('[data-deck="line"] input');
    const suggestions = page.locator('[data-deck="google-suggestion"]');
    await line.fill('discarded');
    await line.fill('deck');
    await expect(suggestions).toHaveText(['deck ideas', 'deck plans']);
    expect(queries).toEqual(['deck']);
    await page.setViewportSize({ width: 375, height: 812 });
    const scan = await new AxeBuilder({ page })
      .include('[data-deck="line-results"]')
      .analyze();
    expect(scan.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('google-suggestions-narrow.png'),
      animations: 'disabled',
    });
    await line.press('ArrowDown');
    await expect(suggestions.first()).toHaveAttribute('data-active');
    await line.press('ArrowDown');
    await expect(suggestions.nth(1)).toHaveAttribute('data-active');
    const opened = context.waitForEvent('page');
    await line.press('Shift+Enter');
    const search = await opened;
    await search.waitForURL('https://www.google.com/search?**');
    expect(new URL(search.url()).searchParams.get('q')).toBe('deck plans');
    await search.close();
    const count = queries.length;
    for (const query of ['>settings', 'https://example.com/private', 'a']) {
      await line.fill(query);
      await page.waitForTimeout(NO_REQUEST_WINDOW_MS);
      expect(queries).toHaveLength(count);
    }
    await line.fill('unsafe');
    await expect(suggestions).toHaveText(['<img src=x onerror=alert(1)>']);
    await expect(suggestions.locator('img')).toHaveCount(0);
    await line.fill('click choice');
    await suggestions
      .first()
      .getByText('click choice ideas', { exact: true })
      .click();
    await page.waitForURL('https://www.google.com/search?**');
    expect(new URL(page.url()).searchParams.get('q')).toBe(
      'click choice ideas',
    );
    await openDeck();
    await line.fill('x'.repeat(190));
    await expect(suggestions).toHaveCount(2);
    expect(
      await suggestions
        .first()
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect(
      await page
        .locator('[data-deck="line-results"]')
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await line.fill('unavailable');
    await expect(
      page.locator('[data-deck="google-suggestions-status"]'),
    ).toContainText('Enter still searches');
    await line.press('Enter');
    await page.waitForURL('https://www.google.com/search?**');
    expect(new URL(page.url()).searchParams.get('q')).toBe('unavailable');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await removePermissionFixture(fixture);
  }
});
