import { expect, test, type Page } from '@playwright/test';
import type { Card } from 'deck-schema';

import { launchExtension } from './extension';

const READY = 'html[data-deck-ready="true"]';

async function storedPin(page: Page, change?: Partial<Card>): Promise<Card> {
  return page.evaluate(async (patch) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = database.transaction(
        'cards',
        patch ? 'readwrite' : 'readonly',
      );
      const store = tx.objectStore('cards');
      const cards = await new Promise<Card[]>((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const card = cards.find((item) => item.pinned);
      if (!card) throw new Error('Missing fixture pin');
      const next = { ...card, ...patch };
      if (patch) store.put(next);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      });
      return next;
    } finally {
      database.close();
    }
  }, change);
}

test('opening a stale pin preserves newer edits and cannot undo a deletion', async () => {
  const context = await launchExtension();
  try {
    await context.route('https://opening.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Opened</title>',
      }),
    );
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await page.locator('[data-deck="pin-add"]').click();
    await page.getByLabel('Paste a URL').fill('https://opening.test/original');
    await page.getByLabel('Paste a URL').press('Enter');
    const pin = page.locator('[data-deck="pin"]');
    await expect(pin).toHaveCount(1);
    const edited = await storedPin(page, {
      url: 'https://opening.test/edited',
      title: 'Updated in another tab',
      note: 'A newer note that opening must preserve',
    });
    await expect(pin).toHaveAttribute('href', 'https://opening.test/original');
    const popup = context.waitForEvent('page');
    await pin.click({ modifiers: ['Control'] });
    const opened = await popup;
    await expect(opened).toHaveURL('https://opening.test/edited');
    await opened.close();
    expect(await storedPin(page)).toEqual({
      ...edited,
      lastOpenedAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });

    const deleted = await storedPin(page, { deletedAt: Date.now() });
    await pin.click();
    await expect(
      page.locator('[data-deck="toast"][role="alert"]'),
    ).toBeVisible();
    await expect(page.locator(READY)).toHaveCount(1);
    expect(await storedPin(page)).toEqual(deleted);
    await page.reload();
    await page.waitForSelector(READY);
    await expect(pin).toHaveCount(0);
  } finally {
    await context.close();
  }
});
