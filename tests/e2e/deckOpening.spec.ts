import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { launchExtension } from './extension';
import { join } from 'node:path';
import {
  createPermissionFixture,
  removePermissionFixture,
} from './permissionFixture';

const LINK_COUNT = 65;
const SLOW_TAB_DELAY_MS = 100;
// Sequential Chrome calls can exceed Playwright's default wait on instrumented builds.
const TAB_BATCH_TIMEOUT_MS = 15_000;
const READY = 'html[data-deck-ready="true"]';

async function waitForPages(context: BrowserContext, page: Page) {
  const count = await page.evaluate(() =>
    chrome.tabs.query({}).then((tabs) => tabs.length),
  );
  await expect.poll(() => context.pages().length).toBe(count);
}

async function seed(page: Page) {
  await page.evaluate(async (count) => {
    const request = indexedDB.open('deck');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = database.transaction(['pages', 'decks', 'cards'], 'readwrite');
    const time = Date.now();
    const timestamps = { createdAt: time, updatedAt: time, deletedAt: null };
    tx.objectStore('pages').put({
      id: 'page_open',
      title: 'Opening',
      order: 'b00',
      ...timestamps,
    });
    for (const kind of ['normal', 'session']) {
      const id = `deck_open_${kind}`;
      tx.objectStore('decks').put({
        id,
        pageId: 'page_open',
        title: `Research ${kind}`,
        kind,
        order: 'a0',
        color: 'amber',
        isCollapsed: false,
        ...timestamps,
      });
      for (let i = 0; i < (kind === 'normal' ? count : 2); i += 1) {
        tx.objectStore('cards').put({
          id: `card_open_${kind}_${i}`,
          deckId: id,
          title: `Research ${i}`,
          url: `http://opening.test/${kind}/${i}`,
          hostname: 'opening.test',
          order: `b${String(i).padStart(2, '0')}`,
          pinned: false,
          lastOpenedAt: null,
          ...timestamps,
        });
      }
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    database.close();
  }, LINK_COUNT);
  await page.reload();
  await page.waitForSelector(READY);
  await page
    .getByRole('button', { name: 'Open Deck drawer', exact: true })
    .click();
  await page.getByRole('button', { name: 'Opening', exact: true }).click();
}

async function openedTabs(page: Page, initialIds: number[]) {
  return page.evaluate(async (baseline) => {
    const current = await chrome.tabs.getCurrent();
    if (!current) throw new Error('Missing extension tab');
    return (await chrome.tabs.query({ windowId: current.windowId })).filter(
      (tab) => tab.id !== current.id && !baseline.includes(tab.id ?? -1),
    );
  }, initialIds);
}

async function expectFullBatch(page: Page, initialIds: number[]) {
  await expect
    .poll(async () => (await openedTabs(page, initialIds)).length, {
      timeout: TAB_BATCH_TIMEOUT_MS,
    })
    .toBe(LINK_COUNT);
}

async function delayTabCreation(page: Page) {
  await page.evaluate((delayMs) => {
    const create = chrome.tabs.create.bind(chrome.tabs);
    Object.assign(chrome.tabs, {
      create: async (options: chrome.tabs.CreateProperties) => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return create(options);
      },
    });
  }, SLOW_TAB_DELAY_MS);
}

test('slow native tab creation still completes the exact 65-link batch', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    await context.route('http://opening.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Saved research</title>',
      }),
    );
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    const initialIds = await page.evaluate(async () =>
      (await chrome.tabs.query({ currentWindow: true })).flatMap((tab) =>
        tab.id === undefined ? [] : [tab.id],
      ),
    );
    await seed(page);
    await delayTabCreation(page);
    await page.locator('[data-deck-id="deck_open_normal"]').focus();
    const started = Date.now();
    await page.keyboard.press('n');
    try {
      await expectFullBatch(page, initialIds);
    } finally {
      await testInfo.attach('slow-tab-opening.json', {
        body: JSON.stringify({
          delayPerTabMs: SLOW_TAB_DELAY_MS,
          elapsedMs: Date.now() - started,
          count: (await openedTabs(page, initialIds)).length,
        }),
        contentType: 'application/json',
      });
    }
    await expect(page.locator('[data-deck="toast"]')).toContainText(
      '65 tabs opened',
    );
    await waitForPages(context, page);
  } finally {
    await context.close();
  }
});

test('pregranted fixture: real tab groups exceed 60 links; Restore keeps or recoverably removes a session', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(90_000);
  const profile = await createPermissionFixture('tabGroups');
  const context = await launchExtension(join(profile, 'dist'));
  try {
    await context.route('http://opening.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Saved research</title>',
      }),
    );
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    const initialIds = await page.evaluate(async () =>
      (await chrome.tabs.query({ currentWindow: true })).flatMap((tab) =>
        tab.id === undefined ? [] : [tab.id],
      ),
    );
    await waitForPages(context, page);
    const initialPages = new Set(context.pages());
    const closeTabs = async () => {
      await waitForPages(context, page);
      for (const tab of context.pages()) {
        if (!initialPages.has(tab)) await tab.close();
      }
      await page.bringToFront();
      await expect
        .poll(async () => (await openedTabs(page, initialIds)).length)
        .toBe(0);
    };
    await seed(page);
    const normal = page.locator('[data-deck-id="deck_open_normal"]');
    await normal.focus();
    await page.keyboard.press('n');
    await expectFullBatch(page, initialIds);
    await expect(page.locator('[data-deck="toast"]')).toContainText(
      '65 tabs opened',
    );
    expect(
      await page.evaluate(() =>
        chrome.permissions.contains({ permissions: ['tabs'] }),
      ),
    ).toBe(false);
    await closeTabs();

    await normal
      .getByRole('button', { name: 'Deck menu', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Open as tab group', exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          chrome.permissions.contains({ permissions: ['tabGroups'] }),
        ),
      )
      .toBe(true);
    await expectFullBatch(page, initialIds);
    await expect
      .poll(() =>
        page.evaluate(() =>
          chrome.tabGroups.query({ title: 'Research normal' }),
        ),
      )
      .toMatchObject([{ color: 'yellow', title: 'Research normal' }]);
    const groups = new Set(
      (await openedTabs(page, initialIds)).map((tab) => tab.groupId),
    );
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeGreaterThanOrEqual(0);
    await closeTabs();

    await page.getByRole('button', { name: 'Sessions', exact: true }).click();
    const session = page.locator('[data-deck-id="deck_open_session"]');
    await session
      .getByRole('button', { name: 'Deck menu', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Restore', exact: true }).click();
    await expect
      .poll(async () => (await openedTabs(page, initialIds)).length)
      .toBe(2);
    await expect(session).toBeVisible();
    await closeTabs();
    await session
      .getByRole('button', { name: 'Deck menu', exact: true })
      .click();
    await page.setViewportSize({ width: 640, height: 720 });
    await expect(
      page.getByRole('menuitem', {
        name: 'Restore and move to Trash',
        exact: true,
      }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath('session-restore-menu.png'),
    });
    await page
      .getByRole('menuitem', { name: 'Restore and move to Trash', exact: true })
      .click();
    await expect
      .poll(async () => (await openedTabs(page, initialIds)).length)
      .toBe(2);
    await expect(session).toHaveCount(0);
    await closeTabs();
    await page.getByRole('button', { name: 'Trash', exact: true }).click();
    await expect(
      page.getByText('Research session', { exact: true }),
    ).toBeVisible();
    await page
      .locator('[data-deck="trash-item"]')
      .filter({ hasText: 'Research session' })
      .getByRole('button', { name: 'Restore', exact: true })
      .click();
    await page.getByRole('button', { name: 'Sessions', exact: true }).click();
    await expect(session.locator('[data-deck="card"]')).toHaveCount(2);
    const stamps = await page.evaluate(async () => {
      const request = indexedDB.open('deck');
      const database = await new Promise<IDBDatabase>((resolve) => {
        request.onsuccess = () => resolve(request.result);
      });
      const tx = database.transaction('cards');
      const read = tx.objectStore('cards').getAll();
      const cards = await new Promise<
        { id: string; lastOpenedAt: number | null }[]
      >((resolve) => {
        read.onsuccess = () => resolve(read.result);
      });
      database.close();
      return cards
        .filter((card) => card.id.startsWith('card_open_'))
        .map((card) => card.lastOpenedAt);
    });
    expect(stamps).toHaveLength(LINK_COUNT + 2);
    expect(
      stamps.every((stamp) => typeof stamp === 'number' && stamp > 0),
    ).toBe(true);
  } finally {
    await context.close();
    await removePermissionFixture(profile);
  }
});
