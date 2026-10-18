import { expect, test, type Page } from '@playwright/test';
import { launchExtension } from './extension';
import { TITLE_MAX_LENGTH } from '../../packages/schema/src/constants';

const READY = 'html[data-deck-ready="true"]';
const MAX_FOCUS_STEPS = 60;

async function focusLineByKeyboard(page: Page) {
  const line = page.locator('[data-deck="line"] input');
  for (let step = 0; step < MAX_FOCUS_STEPS; step += 1) {
    await page.keyboard.press('Tab');
    if (await line.evaluate((element) => element === document.activeElement))
      return;
  }
  throw new Error('Could not reach the Line by keyboard');
}

async function command(page: Page, text: string) {
  const line = page.locator('[data-deck="line"] input');
  await line.fill(text);
  await expect(page.locator('[data-deck="action-result"]')).toHaveCount(1);
  await line.press('Enter');
}

test('Line creates named pages and decks in the existing keyboard workspace', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await command(page, '>new page Work notes');
    const selectedPage = page.locator('[data-deck="page"][data-selected]');
    await expect(selectedPage).toHaveText('Work notes');
    await expect(page.locator('[data-deck="deck"]')).toHaveCount(0);
    await expect(page.locator('[data-deck="line"] input')).toHaveValue('');

    await page.getByLabel('Close Deck drawer').click();
    await command(page, '>new deck');
    const editor = page.locator(
      '[data-deck="deck"] input[aria-label="Deck name"]',
    );
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('New deck');
    await editor.fill('Reading');
    await editor.press('Enter');
    await expect(page.locator('[data-deck="deck-title"]')).toHaveText(
      'Reading',
    );
    await expect(selectedPage).toHaveText('Work notes');

    await page.getByLabel('Close Deck drawer').click();
    await expect(page.locator('[data-deck="drawer"]')).toHaveCount(0);
    await page.getByLabel('Open Deck drawer').click();
    await expect(editor).toHaveCount(0);
    await expect(page.locator('[data-deck="deck-title"]')).toHaveText(
      'Reading',
    );
    await page.getByLabel('Close Deck drawer').click();
    await command(page, '>new page Another page');
    await expect(selectedPage).toHaveText('Another page');
    await expect(page.locator('[data-deck="deck"]')).toHaveCount(0);

    await page.reload();
    await page.waitForSelector(READY);
    await page.getByLabel('Open Deck drawer').click();
    await expect(selectedPage).toHaveText('Another page');
    await page.getByRole('button', { name: 'Work notes', exact: true }).click();
    await expect(page.locator('[data-deck="deck-title"]')).toHaveText(
      'Reading',
    );
    await page.getByLabel('Close Deck drawer').click();
    const line = page.locator('[data-deck="line"] input');
    const oversized = `>new page ${'x'.repeat(TITLE_MAX_LENGTH + 1)}`;
    await command(page, oversized);
    await expect(
      page.locator('[data-deck="toast"][role="alert"]'),
    ).toBeVisible();
    await expect(line).toHaveValue(oversized);
    await expect(page.locator('[data-deck="drawer"][data-open]')).toHaveCount(
      0,
    );
  } finally {
    await context.close();
  }
});

test('workspace commands preserve an open note when its write fails, then save before navigating', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await page.keyboard.press('Control+J');
    await page
      .locator('[data-card-id="example_mdn"]')
      .getByRole('button', { name: 'Edit note' })
      .click();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (
          this.name === 'cards' &&
          (value as { note?: string }).note === 'Unsaved note'
        )
          throw new Error('Fixture write failed');
        return put.call(this, value, key);
      };
    });
    const note = page.locator('[data-deck="note"] textarea');
    await note.fill('Unsaved note');
    await focusLineByKeyboard(page);
    await expect(page.locator('[data-deck="line"] input')).toBeFocused();
    await command(page, '>new page After note');
    await expect(
      page.locator('[data-deck="toast"][role="alert"]').first(),
    ).toBeVisible();
    await expect(note).toHaveValue('Unsaved note');
    await expect(page.locator('[data-deck="line"] input')).toHaveValue(
      '>new page After note',
    );
    await expect(
      page.getByRole('button', { name: 'After note', exact: true }),
    ).toHaveCount(0);

    await note.fill('Recovered note');
    await focusLineByKeyboard(page);
    await command(page, '>new page After note');
    await expect(page.locator('[data-deck="page"][data-selected]')).toHaveText(
      'After note',
    );
    const saved = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('deck');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<string>((resolve, reject) => {
          const request = database
            .transaction('cards')
            .objectStore('cards')
            .get('example_mdn');
          request.onsuccess = () => resolve(request.result.note);
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    });
    expect(saved).toBe('Recovered note');
  } finally {
    await context.close();
  }
});
