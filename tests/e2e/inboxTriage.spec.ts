import { expect, test, type Page } from '@playwright/test';

import { expectWithinBudget } from './coverage';
import { launchExtension } from './extension';

const READY_SELECTOR = 'html[data-deck-ready="true"]';
const INBOX_SIZE = 20;
const TRIAGE_BUDGET_MS = 60_000;
const TRIAGE_TEST_TIMEOUT_MS = 90_000;

interface StoredCard {
  id: string;
  deckId: string;
  pinned: boolean;
  deletedAt: number | null;
  note?: string;
}

/** Writes Quick-Save-shaped cards straight into the Inbox. */
async function fillInbox(page: Page, count: number): Promise<void> {
  await page.evaluate(async (total) => {
    const database = await new Promise<IDBDatabase>((done, fail) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => done(request.result);
      request.onerror = () => fail(request.error);
    });
    const store = database
      .transaction('cards', 'readwrite')
      .objectStore('cards');
    for (let index = 0; index < total; index += 1) {
      const id = `triage_${String(index).padStart(2, '0')}`;
      store.put({
        id,
        deckId: 'deck_inbox',
        url: `https://saved-${index}.test/`,
        title: `Saved link ${index}`,
        hostname: `saved-${index}.test`,
        order: `a${String.fromCharCode(97 + index)}`,
        pinned: false,
        lastOpenedAt: null,
        createdAt: index,
        updatedAt: index,
        deletedAt: null,
      });
    }
    await new Promise<void>((done, fail) => {
      store.transaction.oncomplete = () => done();
      store.transaction.onerror = () => fail(store.transaction.error);
    });
    database.close();
  }, count);
}

async function readCards(page: Page): Promise<StoredCard[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((done, fail) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => done(request.result);
      request.onerror = () => fail(request.error);
    });
    const cards = await new Promise<StoredCard[]>((done, fail) => {
      const all = database.transaction('cards').objectStore('cards').getAll();
      all.onsuccess = () => done(all.result as StoredCard[]);
      all.onerror = () => fail(all.error);
    });
    database.close();
    return cards;
  });
}

test('inbox: 20 saved links triaged to Inbox zero by keyboard alone', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(TRIAGE_TEST_TIMEOUT_MS);
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY_SELECTOR);
    await fillInbox(page, INBOX_SIZE);
    await page.reload();
    await page.waitForSelector(READY_SELECTOR);

    await page.keyboard.press('Control+J');
    await page.locator('[data-deck="page"][data-system]').click();
    const list = page.getByRole('listbox', { name: 'Inbox' });
    await expect(list).toBeFocused();
    await expect(list.getByRole('option')).toHaveCount(INBOX_SIZE);

    const started = Date.now();
    const keys = page.keyboard;
    // 1. Five at once: select with Shift+Down, move by typing the deck.
    for (let step = 0; step < 4; step += 1) await keys.press('Shift+ArrowDown');
    await keys.press('m');
    await keys.type('exa');
    await keys.press('Enter');
    await expect(list.getByRole('option')).toHaveCount(15);
    await expect(list).toBeFocused();
    // 2. A note on the next one, then trash it and four more.
    await keys.press('n');
    await expect(page.locator('[data-deck="note"] textarea')).toBeFocused();
    await keys.type('skim later');
    await keys.press('Escape');
    await expect(page.locator('[data-deck="note"]')).toHaveCount(0);
    await expect(list).toBeFocused();
    for (let step = 0; step < 5; step += 1) await keys.press('x');
    await expect(list.getByRole('option')).toHaveCount(10);
    // 3. Two pins.
    await keys.press('p');
    await keys.press('p');
    await expect(list.getByRole('option')).toHaveCount(8);
    // 4. The rest to the remembered destination: m, Enter.
    for (let step = 0; step < 8; step += 1) {
      await keys.press('ArrowRight');
      await keys.press('Enter');
    }
    await expect(page.locator('[data-deck="inbox-zero"]')).toHaveText(
      'Inbox zero.',
    );
    const elapsedMs = Date.now() - started;

    const cards = (await readCards(page)).filter(({ id }) =>
      id.startsWith('triage_'),
    );
    const live = cards.filter(({ deletedAt }) => deletedAt === null);
    expect(live.filter(({ deckId }) => deckId === 'deck_inbox')).toEqual([]);
    expect(cards.filter(({ deletedAt }) => deletedAt !== null)).toHaveLength(5);
    expect(live.filter(({ pinned }) => pinned)).toHaveLength(2);
    expect(
      live.filter(({ deckId }) => deckId === 'deck_examples'),
    ).toHaveLength(15);
    expect(
      cards.find(({ note }) => note === 'skim later')?.deletedAt,
    ).not.toBeNull();

    await testInfo.attach('triage-timing.json', {
      body: JSON.stringify({ cards: INBOX_SIZE, elapsedMs }),
      contentType: 'application/json',
    });
    expectWithinBudget('triage ms', elapsedMs, { max: TRIAGE_BUDGET_MS });
  } finally {
    await context.close();
  }
});
