import { expect, test } from '@playwright/test';

import { launchExtension } from './extension';

test('plain searches use Google while saved results and typed URLs remain explicit', async () => {
  const context = await launchExtension();
  try {
    await context.route('https://www.google.com/search?**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Search destination</title>',
      }),
    );
    await context.route('https://archive.org/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Saved destination</title>',
      }),
    );
    const page = await context.newPage();
    const openDeck = async () => {
      await page.goto('chrome://newtab/');
      await page.waitForSelector('html[data-deck-ready="true"]');
    };
    const line = page.locator('[data-deck="line"] input');
    for (const query of ['archive', 'weather tomorrow & فارسی', '?cats']) {
      await openDeck();
      await line.fill(query);
      if (query === 'archive')
        await expect(
          page.locator('[data-deck="line-results"] [data-deck="card"]'),
        ).toContainText('Internet Archive');
      await line.press('Enter');
      await page.waitForURL('https://www.google.com/search?**');
      expect(new URL(page.url()).searchParams.get('q')).toBe(
        query.replace(/^\?/, ''),
      );
    }
    await openDeck();
    await line.fill('archive');
    await line.press('ArrowDown');
    await line.press('Enter');
    await page.waitForURL('https://archive.org/');
    await openDeck();
    await line.fill('archive.org');
    await line.press('Enter');
    await page.waitForURL('https://archive.org/');
    await openDeck();
    const deckUrl = page.url();
    await line.fill('new tab search');
    const opened = context.waitForEvent('page');
    await line.press('Shift+Enter');
    const result = await opened;
    await result.waitForURL('https://www.google.com/search?**');
    expect(new URL(result.url()).searchParams.get('q')).toBe('new tab search');
    expect(page.url()).toBe(deckUrl);
  } finally {
    await context.close();
  }
});
