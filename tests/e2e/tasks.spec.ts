import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { launchExtension } from './extension';

const READY = 'html[data-deck-ready="true"]';
const TITLE =
  'Plan a quiet morning and read the long paper before opening more tabs';

async function readTask(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('deck');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const read = db.transaction('cards').objectStore('cards').getAll();
      const cards = await new Promise<
        {
          id: string;
          kind?: string;
          url?: string;
          note?: string;
          done?: boolean;
          deckId: string;
        }[]
      >((resolve, reject) => {
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
      return cards.find((card) => card.kind === 'task');
    } finally {
      db.close();
    }
  });
}

test('tasks: quick entry, Notes editing, task-mode keyboard completion and safe mixed-deck opening', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(90_000);
  const context = await launchExtension();
  try {
    await context.route('https://**/*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Wikipedia</title>',
      }),
    );
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    const line = page.locator('[data-deck="line"] input');
    await line.fill(TITLE);
    await line.press('Control+Shift+Enter');
    await expect(line).toHaveValue('');
    const task = await readTask(page);
    expect(task).toMatchObject({
      kind: 'task',
      note: TITLE,
      deckId: 'deck_inbox',
      done: false,
    });
    expect(task).not.toHaveProperty('url');
    if (!task) throw new Error('Missing saved task');
    const originalPages = context.pages().length;

    await line.fill('quiet morning');
    await expect(page.locator('[data-deck="note-result"]')).toContainText(
      TITLE,
    );
    await line.press('Enter');
    const note = page.locator('[data-deck="note"] textarea');
    await expect(note).toBeFocused();
    await expect(note).toHaveValue(TITLE);
    expect(context.pages()).toHaveLength(originalPages);
    await note.fill(`${TITLE}\nBring a notebook.`);
    await note.press('Escape');
    await expect(note).toHaveCount(0);
    await expect
      .poll(async () => (await readTask(page))?.note)
      .toContain('Bring a notebook.');

    const inbox = page.getByRole('listbox', { name: 'Inbox' });
    await inbox.focus();
    await page.keyboard.press('m');
    const move = page.getByRole('combobox', { name: 'Move to' });
    await expect(move).toBeFocused();
    await move.fill('exa');
    await move.press('Enter');
    await expect
      .poll(async () => (await readTask(page))?.deckId)
      .toBe('deck_examples');
    await page
      .locator('[data-deck="pages"]')
      .getByRole('button', { name: 'Examples', exact: true })
      .click();
    const deck = page.locator('[data-deck-id="deck_examples"]');
    await expect(deck).toBeVisible();
    await deck.getByRole('button', { name: 'Deck menu', exact: true }).click();
    await page
      .getByRole('menuitemcheckbox', { name: 'Task mode', exact: true })
      .click();
    await expect(deck).toHaveAttribute('data-task-mode', 'true');
    const row = deck.locator(`[data-card-id="${task.id}"]`);
    const checkbox = row.getByRole('checkbox', { name: 'Toggle done' });
    await checkbox.focus();
    await checkbox.press('Space');
    await expect(checkbox).toBeChecked();
    const total = await deck.locator('[data-deck="card"]').count();
    await expect(deck.locator('[data-deck="deck-count"]')).toHaveText(
      `1 / ${total}`,
    );

    await row.getByRole('button', { name: 'Card menu', exact: true }).click();
    await expect(
      page.getByRole('menuitem', { name: 'Pin link', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('menuitem', { name: 'Open in incognito', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForSelector(READY);
    await page.keyboard.press('Control+J');
    await expect(deck).toHaveAttribute('data-task-mode', 'true');
    await expect(checkbox).toBeChecked();
    await row.locator('[data-deck="task-title"]').click();
    await expect(note).toHaveValue(`${TITLE}\nBring a notebook.`);
    await note.press('Escape');

    for (const { theme, width, height } of [
      { theme: 'night', width: 1280, height: 800 },
      { theme: 'day', width: 640, height: 900 },
      { theme: 'day', width: 375, height: 812 },
    ]) {
      await page.keyboard.press('Control+J');
      await page.getByLabel('Settings', { exact: true }).click();
      await page
        .getByRole('button', {
          name: theme === 'day' ? 'Day' : 'Night',
          exact: true,
        })
        .click();
      await page.getByLabel('Close settings', { exact: true }).click();
      await expect(page.locator('[data-deck="toast"]')).toHaveCount(0);
      await page.setViewportSize({ width, height });
      await page.keyboard.press('Control+J');
      await expect
        .poll(() =>
          page.evaluate(() =>
            document
              .getAnimations()
              .some((animation) => animation.playState === 'running'),
          ),
        )
        .toBe(false);
      await row.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await deck.focus();
      expect(
        await checkbox.evaluate((node) => getComputedStyle(node).opacity),
      ).toBe('1');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`tasks-${theme}-${width}.png`),
        animations: 'disabled',
      });
      const axe = await new AxeBuilder({ page })
        .include('[data-deck-id="deck_examples"]')
        .analyze();
      expect(
        axe.violations.filter((issue) =>
          ['serious', 'critical'].includes(issue.impact ?? ''),
        ),
      ).toEqual([]);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await deck.getByRole('button', { name: 'Deck menu', exact: true }).click();
    const before = new Set(context.pages());
    await page.getByRole('menuitem', { name: 'Open all', exact: true }).click();
    await expect
      .poll(() => context.pages().filter((tab) => !before.has(tab)).length)
      .toBe(total - 1);
    expect((await readTask(page))?.url).toBeUndefined();
    expect(
      context
        .pages()
        .filter((tab) => !before.has(tab))
        .every(
          (tab) => !['about:blank', 'chrome://newtab/'].includes(tab.url()),
        ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});
