import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { launchExtension } from './extension';

const READY_SELECTOR = 'html[data-deck-ready="true"]';
const KEYBOARD_TEST_TIMEOUT_MS = 90_000;

/** Links opened by the test resolve locally; nothing leaves the machine. */
async function stubTheWeb(context: BrowserContext): Promise<void> {
  await context.route(/^https?:\/\//, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>stub</title>' }),
  );
}

async function openDeck(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('chrome://newtab/');
  await page.waitForSelector(READY_SELECTOR);
  return page;
}

const focusedCardId = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement?.closest<HTMLElement>('[data-deck="card"]')
        ?.dataset.cardId ?? null,
  );

const deckCards = (page: Page, title: string) =>
  page
    .locator('[data-deck="deck"]')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) })
    .locator('[data-deck="card"]');

test('a mouse-less session: create, note, pin, move, trash, switch page, open, export', async ({
  browserName,
}) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(KEYBOARD_TEST_TIMEOUT_MS);
  const context = await launchExtension();
  try {
    await stubTheWeb(context);
    const page = await openDeck(context);
    const keys = page.keyboard;

    // Open the drawer and land on the first card.
    await keys.press('Control+J');
    await expect(page.locator('[data-deck="drawer"][data-open]')).toBeVisible();
    await expect(page.locator('[data-deck="card"]').first()).toBeVisible();
    await keys.press('j');
    expect(await focusedCardId(page)).toBe('example_mdn');
    await keys.press('j');
    expect(await focusedCardId(page)).toBe('example_github');
    await keys.press('k');
    expect(await focusedCardId(page)).toBe('example_mdn');

    // Create: a deck, then a link in the focused deck.
    await keys.press('d');
    await expect(page.locator('[data-deck="deck"]')).toHaveCount(2);
    await keys.press('j');
    await keys.press('a');
    await expect(page.getByLabel('Paste a URL')).toBeFocused();
    await keys.type('example.org');
    await keys.press('Enter');
    await expect(deckCards(page, 'Examples')).toHaveCount(7);

    // Note, saved by leaving with Esc; focus returns to the card.
    await keys.press('j');
    expect(await focusedCardId(page)).toBe('example_mdn');
    await keys.press('n');
    await expect(page.locator('[data-deck="note"] textarea')).toBeFocused();
    await keys.type('docs first');
    await keys.press('Escape');
    await expect(page.locator('[data-deck="note"]')).toHaveCount(0);
    await expect.poll(() => focusedCardId(page)).toBe('example_mdn');

    // Pin it.
    await keys.press('p');
    await expect(page.locator('[data-deck="pin"]')).toHaveCount(1);

    // Move the next card to the new deck with the mini-Line.
    await keys.press('j');
    const moving = await focusedCardId(page);
    expect(moving).not.toBeNull();
    await keys.press('m');
    await keys.type('new');
    await keys.press('Enter');
    await expect(deckCards(page, 'New deck')).toHaveCount(1);
    await expect(
      page.locator(`[data-deck="card"][data-card-id="${moving}"]`),
    ).toHaveCount(1);

    // Trash the focused card; focus lands on the next one.
    await keys.press('h');
    await keys.press('j');
    await keys.press('j');
    const trashed = await focusedCardId(page);
    expect(trashed).not.toBeNull();
    await keys.press('x');
    await expect(
      page.locator(`[data-deck="card"][data-card-id="${trashed}"]`),
    ).toHaveCount(0);
    await expect.poll(() => focusedCardId(page)).not.toBeNull();

    // Switch pages: [ to the Inbox, ] back.
    await keys.press('[');
    await expect(
      page.locator('[data-deck="page"][data-system][data-selected]'),
    ).toBeVisible();
    await expect(page.locator('[data-deck="inbox-zero"]')).toBeVisible();
    await keys.press(']');
    await expect(page.locator('[data-deck="deck"]')).toHaveCount(2);

    // Open in a new tab.
    await keys.press('j');
    const popup = context.waitForEvent('page');
    await keys.press('Shift+Enter');
    expect((await popup).url()).toMatch(/^https:\/\//);
    await page.bringToFront();

    // Export: close the drawer, then the Line.
    await page.locator('[data-deck="card"]').first().focus();
    await keys.press('Escape');
    await expect(page.locator('[data-deck="drawer"]')).toHaveCount(0);
    await keys.press('/');
    await keys.type('>export');
    const download = page.waitForEvent('download');
    await keys.press('Enter');
    expect((await download).suggestedFilename()).toMatch(/^deck-.*\.json$/);

    // And the cheat sheet.
    await page.locator('[data-deck="line"] input').press('Escape');
    await keys.press('?');
    const help = page.getByRole('dialog', { name: 'Keyboard' });
    await expect(help).toBeVisible();
    await expect(help).toContainText('Trash');
    await expect(help).toContainText('Save the current page');
    await keys.press('Escape');
    await expect(help).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('keys: rebind in Settings, refuse a conflict, and the new key works', async () => {
  test.setTimeout(KEYBOARD_TEST_TIMEOUT_MS);
  const context = await launchExtension();
  try {
    const page = await openDeck(context);
    await page.getByLabel('Settings').click();

    await page.getByRole('button', { name: 'Trash: x' }).click();
    await page.keyboard.press('j');
    await expect(page.getByRole('alert')).toHaveText(
      'Already used by Next card.',
    );
    await page.keyboard.press('Delete');
    await expect(
      page.getByRole('button', { name: 'Trash: Delete' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset' })).toHaveCount(1);

    // Survives a reload, and the drawer obeys it.
    await page.reload();
    await page.waitForSelector(READY_SELECTOR);
    await page.keyboard.press('Control+J');
    await expect(page.locator('[data-deck="card"]').first()).toBeVisible();
    await page.keyboard.press('j');
    const target = await focusedCardId(page);
    expect(target).not.toBeNull();
    await page.keyboard.press('x');
    await expect(
      page.locator(`[data-deck="card"][data-card-id="${target}"]`),
    ).toHaveCount(1);
    await page.keyboard.press('Delete');
    await expect(
      page.locator(`[data-deck="card"][data-card-id="${target}"]`),
    ).toHaveCount(0);

    // Cheat sheet shows the binding in force.
    await page.locator('[data-deck="card"]').first().focus();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard' })).toContainText(
      'Delete',
    );
  } finally {
    await context.close();
  }
});

test('keys: a card key pressed while the drawer closes does nothing', async () => {
  const context = await launchExtension();
  try {
    const page = await openDeck(context);
    await page.keyboard.press('Control+J');
    await expect(page.locator('[data-deck="card"]').first()).toBeVisible();
    await page.keyboard.press('j');
    const target = await focusedCardId(page);
    expect(target).not.toBeNull();
    // Esc starts the 320 ms exit; x lands inside it.
    await page.keyboard.press('Escape');
    await page.keyboard.press('x');
    await page.keyboard.press('Control+J');
    await expect(
      page.locator(`[data-deck="card"][data-card-id="${target}"]`),
    ).toHaveCount(1);
  } finally {
    await context.close();
  }
});
