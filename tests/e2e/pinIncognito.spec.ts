import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type BrowserContext } from '@playwright/test';
import { launchExtension } from './extension';
import { localSite } from './localSite';

let privateRequests = 0;
const test = localSite((pathname) => {
  if (pathname === '/private-current') privateRequests += 1;
  return '<title>Private pin proof</title><p>A local page for native opening.</p>';
});
const READY = 'html[data-deck-ready="true"]';
const MENU = '[data-deck="pin-menu"]';

async function openDeck(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto('chrome://newtab/');
  await page.waitForSelector(READY);
  return page;
}

async function addPin(page: Page, url: string) {
  await page.getByRole('button', { name: 'Add pin', exact: true }).click();
  await page.getByRole('textbox', { name: 'Paste a URL' }).fill(url);
  await page.getByRole('button', { name: 'Add pin', exact: true }).click();
  await expect(page.locator('[data-deck="pin"]').first()).toHaveAttribute(
    'href',
    url,
  );
}

async function storedPin(page: Page, change?: { url: string; note: string }) {
  return page.evaluate(async (patch) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const tx = db.transaction('cards', patch ? 'readwrite' : 'readonly');
        tx.onerror = () => reject(tx.error);
        const request = tx.objectStore('cards').getAll();
        let card: Record<string, unknown>;
        request.onsuccess = () => {
          const pin = request.result.find(
            (item) => item.pinned && item.deletedAt === null,
          );
          if (!pin) {
            reject(new Error('Missing saved pin'));
            return;
          }
          card = { ...pin, ...patch };
          if (patch) tx.objectStore('cards').put(card);
        };
        tx.oncomplete = () => resolve(card);
      });
    } finally {
      db.close();
    }
  }, change);
}

test('native Chrome grants, opens the current pin privately, persists its stamp and respects revocation', async ({
  siteOrigin,
}) => {
  const artifacts = resolve('docs/artifacts');
  const profile = await mkdtemp(join(artifacts, 'pin-incognito-profile-'));
  if (dirname(profile) !== artifacts)
    throw new Error('Invalid test profile cleanup path');
  let context = await launchExtension(undefined, profile);
  try {
    let page = await openDeck(context);
    const extensionId = await page.evaluate(() => chrome.runtime.id);
    let details = await context.newPage();
    await details.goto(`chrome://extensions/?id=${extensionId}`);
    const developer = details.getByRole('button', {
      name: 'Developer mode',
      exact: true,
    });
    await developer.click();
    await expect(developer).toHaveAttribute('aria-pressed', 'true');
    const access = details.getByRole('button', {
      name: /^Allow in Incognito Warning:/,
    });
    await access.click();
    await expect(access).toHaveAttribute('aria-pressed', 'true');
    // Chromium's native details UI requires restart after changing this setting.
    await context.close();
    context = await launchExtension(undefined, profile);
    page = await openDeck(context);
    expect(
      await page.evaluate(() => chrome.extension.isAllowedIncognitoAccess()),
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        chrome.permissions.contains({ permissions: ['tabs'] }),
      ),
    ).toBe(false);
    await addPin(page, `${siteOrigin}/original`);
    const pin = page.locator('[data-deck="pin"]').first();
    await pin.click({ button: 'right' });
    const current = await storedPin(page, {
      url: `${siteOrigin}/private-current`,
      note: 'Keep this newer note',
    });
    const before = await page.evaluate(async () =>
      (await chrome.windows.getAll()).map((window) => window.id),
    );
    privateRequests = 0;
    await page
      .getByRole('menuitem', { name: 'Open in incognito', exact: true })
      .click();
    await expect(page.locator(MENU)).toHaveCount(0);
    await expect.poll(() => privateRequests).toBe(1);
    const windows = await page.evaluate(() => chrome.windows.getAll());
    const created = windows.filter((window) => !before.includes(window.id));
    expect(created).toHaveLength(1);
    expect(created[0]?.incognito).toBe(true);
    const opened = await storedPin(page);
    expect(opened.lastOpenedAt).toEqual(expect.any(Number));
    expect(opened.updatedAt).toBe(opened.lastOpenedAt);
    expect(opened).toEqual({
      ...current,
      lastOpenedAt: opened.lastOpenedAt,
      updatedAt: opened.lastOpenedAt,
    });
    await expect(pin).toHaveAttribute('href', `${siteOrigin}/private-current`);
    const privateId = created[0]?.id;
    if (privateId === undefined) throw new Error('Missing private window');
    await page.evaluate((id) => chrome.windows.remove(id), privateId);
    await page.reload();
    await page.waitForSelector(READY);
    expect(await storedPin(page)).toEqual(opened);
    details = await context.newPage();
    await details.goto(`chrome://extensions/?id=${extensionId}`);
    await details
      .getByRole('button', { name: /^Allow in Incognito Warning:/ })
      .click();
    await context.close();
    context = await launchExtension(undefined, profile);
    page = await openDeck(context);
    expect(
      await page.evaluate(() => chrome.extension.isAllowedIncognitoAccess()),
    ).toBe(false);
    const count = await page.evaluate(
      async () => (await chrome.windows.getAll()).length,
    );
    await page.locator('[data-deck="pin"]').first().press('Shift+F10');
    await page
      .getByRole('menuitem', { name: 'Open in incognito', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText(
      'Allow Deck in Incognito',
    );
    expect(
      await page.evaluate(async () => (await chrome.windows.getAll()).length),
    ).toBe(count);
    expect(await storedPin(page)).toEqual(opened);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

for (const layout of ['desktop', 'narrow', 'short', 'zoom']) {
  test(`pin incognito menu stays keyboard reachable and bounded in ${layout}`, async ({
    siteOrigin,
  }, testInfo) => {
    const context = await launchExtension();
    try {
      const page = await openDeck(context);
      await addPin(page, `${siteOrigin}/readable`);
      if (layout === 'zoom') {
        const url = await page.evaluate(() =>
          chrome.runtime.getURL('src/newtab/index.html'),
        );
        await page.goto(`${url}?pin-incognito-zoom`);
        await page.waitForSelector(READY);
        await page.setViewportSize({ width: 1280, height: 1200 });
        const ratio = await page.evaluate(() => devicePixelRatio);
        await page.evaluate(async () => {
          const tab = await chrome.tabs.getCurrent();
          if (tab?.id === undefined) throw new Error('No test tab');
          await chrome.tabs.setZoom(tab.id, 2);
        });
        await expect
          .poll(() => page.evaluate(() => devicePixelRatio))
          .toBe(ratio * 2);
      } else
        await page.setViewportSize({
          width: layout === 'narrow' ? 320 : layout === 'short' ? 640 : 1440,
          height: layout === 'short' ? 360 : 900,
        });
      const line = page.locator('[data-deck="line"] input');
      await line.fill('>settings');
      await line.press('Enter');
      await page
        .locator('[data-deck="font-size-select"]')
        .selectOption('extra-large');
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-size',
        'extra-large',
      );
      await page
        .getByRole('group', { name: 'Theme', exact: true })
        .getByRole('button', {
          name: layout === 'narrow' || layout === 'zoom' ? 'Day' : 'Night',
          exact: true,
        })
        .click();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-deck="toast"]')).toHaveCount(0);
      const pin = page.locator('[data-deck="pin"]').first();
      await pin.press('Shift+F10');
      const menu = page.locator(MENU);
      const items = menu.getByRole('menuitem');
      await expect(items).toHaveCount(4);
      await expect(items.first()).toBeFocused();
      const box = await menu.boundingBox();
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      if (!box) throw new Error('Missing menu bounds');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      const action = menu.getByRole('menuitem', {
        name: 'Open in incognito',
        exact: true,
      });
      await expect(action).toBeFocused();
      await action.scrollIntoViewIfNeeded();
      const target = await action.boundingBox();
      if (!target) throw new Error('Missing action bounds');
      expect(target.width).toBeGreaterThanOrEqual(24);
      expect(target.height).toBeGreaterThanOrEqual(24);
      expect(target.y).toBeGreaterThanOrEqual(box.y);
      expect(target.y + target.height).toBeLessThanOrEqual(box.y + box.height);
      expect(
        (await new AxeBuilder({ page }).include(MENU).analyze()).violations,
      ).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath('pin-incognito-menu.png'),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await expect(pin).toBeFocused();
      await pin.press('ContextMenu');
      await page.keyboard.press('End');
      await expect(items.last()).toBeFocused();
      await page.keyboard.press('Home');
      await expect(items.first()).toBeFocused();
      await page.keyboard.press('Escape');
    } finally {
      await context.close();
    }
  });
}
