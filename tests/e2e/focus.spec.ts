import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { launchExtension } from './extension';
import { readFile } from 'node:fs/promises';

const START = new Date(2026, 10, 9, 10).getTime();
const MINUTE = 60_000;

async function openFocus(page: Page) {
  await page
    .getByRole('navigation', { name: 'Workspace sections' })
    .getByRole('button', { name: 'Open Focus', exact: true })
    .click();
  await expect(page.locator('[data-deck="focus"]')).toHaveAttribute(
    'aria-busy',
    'false',
  );
}

async function jumpTo(page: Page, time: number) {
  await page.clock.setFixedTime(new Date(time));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

async function storedFocus(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const request = database
          .transaction('meta')
          .objectStore('meta')
          .get('focus');
        request.onsuccess = () => resolve(request.result?.value);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

test('focus links a task and preserves paused partial time across two tabs and reload', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(START));
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    const line = page.locator('[data-deck="line"] input');
    await line.fill('Read a chapter');
    await line.press('Control+Shift+Enter');
    await expect(line).toHaveValue('');
    await openFocus(page);
    await expect(page.getByRole('timer')).toHaveText('25:00');
    await page.getByLabel('Minutes', { exact: true }).fill('1');
    await page
      .getByLabel('Task (optional)', { exact: true })
      .selectOption({ label: 'Read a chapter' });
    await page
      .getByRole('button', { name: 'Start focus', exact: true })
      .click();
    await expect(page.getByRole('timer')).toHaveText('01:00');
    await expect(
      page.getByRole('button', { name: 'Pause focus', exact: true }),
    ).toBeEnabled();
    await jumpTo(page, START + 20_000);
    await page
      .getByRole('button', { name: 'Pause focus', exact: true })
      .click();
    await expect(page.getByRole('timer')).toHaveText('00:40');
    const other = await context.newPage();
    await other.clock.setFixedTime(new Date(START + 120_000));
    await other.goto('chrome://newtab/');
    await other.waitForSelector('html[data-deck-ready="true"]');
    await openFocus(other);
    await expect(other.getByRole('timer')).toHaveText('00:40');
    await other
      .getByRole('button', { name: 'Resume focus', exact: true })
      .click();
    await expect(
      other.getByRole('button', { name: 'Pause focus', exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Pause focus', exact: true }),
    ).toBeVisible();
    await jumpTo(other, START + 135_000);
    await other
      .getByRole('button', { name: 'Stop focus', exact: true })
      .click();
    await expect(
      other.getByRole('button', { name: 'Start focus', exact: true }),
    ).toBeVisible();
    await expect(other.locator('[data-deck="focus-history"]')).toContainText(
      '0.5 min',
    );
    await expect(other.locator('[data-deck="focus-history"]')).toContainText(
      '0 days',
    );
    await expect
      .poll(() => storedFocus(other))
      .toMatchObject({
        active: null,
        history: [
          {
            elapsedMs: 35_000,
            isCompleted: false,
            task: { title: 'Read a chapter' },
          },
        ],
      });
    await other.reload();
    await other.waitForSelector('html[data-deck-ready="true"]');
    await openFocus(other);
    await expect(other.locator('[data-deck="focus-history"]')).toContainText(
      'Read a chapter',
    );
    await expect(other.getByLabel('Minutes', { exact: true })).toHaveValue('1');
  } finally {
    await context.close();
  }
});

test('focus completes while closed, uses its deadline day and announces completion only once', async () => {
  const context = await launchExtension();
  try {
    const start = new Date(2026, 10, 9, 23, 59, 30).getTime();
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(start));
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    await openFocus(page);
    await page.getByLabel('Minutes', { exact: true }).fill('1');
    await page
      .getByRole('button', { name: 'Start focus', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Pause focus', exact: true }),
    ).toBeVisible();
    await page.close();
    const returned = await context.newPage();
    await returned.clock.setFixedTime(new Date(start + 150_000));
    await returned.goto('chrome://newtab/');
    await returned.waitForSelector('html[data-deck-ready="true"]');
    const notice = returned
      .locator('[data-deck="toast"]')
      .filter({ hasText: 'Focus complete.' });
    await expect(notice).toHaveCount(1);
    await notice
      .getByRole('button', { name: 'View focus', exact: true })
      .click();
    await expect(returned.locator('[data-deck="focus-history"]')).toContainText(
      '1 day',
    );
    await expect(returned.locator('[data-deck="focus-history"]')).toContainText(
      '1 min',
    );
    expect(await storedFocus(returned)).toMatchObject({
      active: null,
      unreadId: null,
      history: [
        { endedAt: start + MINUTE, day: '2026-11-10', isCompleted: true },
      ],
    });
    await returned.reload();
    await returned.waitForSelector('html[data-deck-ready="true"]');
    await openFocus(returned);
    await expect(
      returned.getByRole('button', { name: 'View focus', exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('focus is keyboard reachable and readable in Day/Night at narrow widths and 200 percent zoom', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(60_000);
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    for (const theme of ['Day', 'Night']) {
      await page.locator('[data-deck="line"] input').fill('>settings');
      await page.locator('[data-deck="line"] input').press('Enter');
      await page
        .getByRole('group', { name: 'Theme', exact: true })
        .getByRole('button', { name: theme, exact: true })
        .click();
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        theme.toLowerCase(),
      );
      await page
        .getByRole('button', { name: 'Close settings', exact: true })
        .click();
      await openFocus(page);
      await expect(page.locator('[data-deck="focus"]')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByLabel('Minutes', { exact: true })).toBeFocused();
      for (const [width, height, zoom] of [
        [1440, 900, 1],
        [768, 900, 1],
        [375, 812, 1],
        [320, 600, 1],
        [640, 900, 2],
      ]) {
        await page.setViewportSize({ width, height });
        await page.evaluate((value) => {
          document.documentElement.style.zoom = String(value);
        }, zoom);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const scan = await new AxeBuilder({ page })
          .include('[data-deck="focus"]')
          .include('[data-deck="section-nav"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(scan.violations).toEqual([]);
        await page
          .getByRole('button', { name: 'Start focus', exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          page.getByRole('button', { name: 'Start focus', exact: true }),
        ).toBeVisible();
        expect(
          await page
            .getByRole('button', { name: 'Start focus', exact: true })
            .evaluate((button) => {
              const box = button.getBoundingClientRect();
              return button.contains(
                document.elementFromPoint(
                  box.x + box.width / 2,
                  box.y + box.height / 2,
                ),
              );
            }),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`focus-${theme}-${width}-${zoom}.png`),
          animations: 'disabled',
        });
      }
      await page.evaluate(() => {
        document.documentElement.style.zoom = '';
      });
      await page.getByLabel('Close Deck drawer', { exact: true }).click();
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('focus deadlines finish automatically, count one streak day and retain data on write failure', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.clock.install({ time: new Date(START) });
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    await openFocus(page);
    await page.getByLabel('Minutes', { exact: true }).fill('1');
    for (let completion = 1; completion <= 2; completion += 1) {
      await page
        .getByRole('button', { name: 'Start focus', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Pause focus', exact: true }),
      ).toBeVisible();
      await page.clock.fastForward(MINUTE + 1_000);
      await expect(
        page.getByRole('button', { name: 'Start focus', exact: true }),
      ).toBeVisible();
      await expect
        .poll(() => storedFocus(page))
        .toMatchObject({
          active: null,
          history: Array.from({ length: completion }, () =>
            expect.objectContaining({ isCompleted: true, elapsedMs: MINUTE }),
          ),
        });
      await expect(page.locator('[data-deck="focus-history"]')).toContainText(
        '1 day',
      );
    }
    await expect
      .poll(() => storedFocus(page))
      .toMatchObject({ unreadId: null });
    const preserved = await storedFocus(page);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === 'meta' && (value as { key?: string }).key === 'focus')
          throw new Error('Fixture focus write failed');
        return put.call(this, value, key);
      };
    });
    await page
      .getByRole('button', { name: 'Start focus', exact: true })
      .click();
    await expect(
      page.locator('[data-deck="toast"][role="alert"]').first(),
    ).toContainText('Fixture focus write failed');
    await expect(
      page.getByRole('button', { name: 'Start focus', exact: true }),
    ).toBeEnabled();
    expect(await storedFocus(page)).toEqual(preserved);
  } finally {
    await context.close();
  }
});

test('focus export/import and Undo refresh an already open timer view', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(START));
    await page.goto('chrome://newtab/');
    await page.waitForSelector('html[data-deck-ready="true"]');
    await openFocus(page);
    await page
      .getByRole('button', { name: 'Start focus', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Pause focus', exact: true }),
    ).toBeEnabled();
    await jumpTo(page, START + 30_000);
    await page.getByRole('button', { name: 'Stop focus', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Start focus', exact: true }),
    ).toBeEnabled();
    await expect(page.locator('[data-deck="focus-history"]')).toContainText(
      '0.5 min',
    );
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.keyboard.press('Control+E'),
    ]);
    const path = await download.path();
    if (!path) throw new Error('Focus export missing');
    const json = await readFile(path, 'utf8');
    const saved = await storedFocus(page);
    await page
      .getByRole('button', { name: 'Start focus', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Pause focus', exact: true }),
    ).toBeEnabled();
    await jumpTo(page, START + MINUTE);
    await page.getByRole('button', { name: 'Stop focus', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Start focus', exact: true }),
    ).toBeEnabled();
    await expect(page.locator('[data-deck="focus-history"]')).toContainText(
      '1 min',
    );
    await page.locator('[data-deck="settings-toggle"]').click();
    await page.getByLabel('Import data', { exact: true }).setInputFiles({
      name: 'focus-export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    const preview = page.locator('[data-deck="data-import-preview"]');
    await preview.getByRole('button', { name: 'Replace', exact: true }).click();
    await preview.getByRole('button', { name: 'Import', exact: true }).click();
    await expect.poll(() => storedFocus(page)).toEqual(saved);
    await expect(page.locator('[data-deck="settings"]')).toHaveCount(0);
    await expect(page.locator('[data-deck="focus-history"]')).toContainText(
      '0.5 min',
    );
    await page
      .locator('[data-deck="toast"]')
      .filter({ hasText: 'Imported' })
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await expect(page.locator('[data-deck="focus-history"]')).toContainText(
      '1 min',
    );
  } finally {
    await context.close();
  }
});
