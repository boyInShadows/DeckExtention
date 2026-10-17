import { expect, test, type Page } from '@playwright/test';
import { launchExtension } from './extension';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';

const LINK_COUNT = 65;
const READY = 'html[data-deck-ready="true"]';

async function grantedFixture() {
  const root = resolve('scratch');
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, 'deck-opening-'));
  if (!path.startsWith(root + sep))
    throw new Error('Test fixture escaped scratch');
  const extensionPath = join(path, 'dist');
  await cp(resolve('apps/extension/dist'), extensionPath, { recursive: true });
  // Pregrant only in this disposable test copy. Production keeps tabGroups
  // optional; native dialog acceptance is an owner check.
  const file = join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.permissions = [...manifest.permissions, 'tabGroups'];
  manifest.optional_permissions = manifest.optional_permissions.filter(
    (permission: string) => permission !== 'tabGroups',
  );
  await writeFile(file, JSON.stringify(manifest));
  return path;
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

test('pregranted fixture: real tab groups exceed 60 links; Restore keeps or recoverably removes a session', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(90_000);
  const profile = await grantedFixture();
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
    const initialPages = new Set(context.pages());
    const closeTabs = async () => {
      for (const tab of context.pages()) {
        if (!initialPages.has(tab)) await tab.close();
      }
      await page.bringToFront();
    };
    await seed(page);
    const normal = page.locator('[data-deck-id="deck_open_normal"]');
    await normal.focus();
    await page.keyboard.press('n');
    await expect
      .poll(async () => (await openedTabs(page, initialIds)).length)
      .toBe(LINK_COUNT);
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
    await expect
      .poll(async () => (await openedTabs(page, initialIds)).length)
      .toBe(LINK_COUNT);
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
    await rm(profile, { recursive: true, force: true });
  }
});
