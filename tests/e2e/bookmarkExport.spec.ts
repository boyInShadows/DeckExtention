import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { launchExtension } from './extension';

async function download(page: Page, html: boolean) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page
      .getByRole('button', {
        name: html ? 'Export bookmarks (HTML)' : 'Export data',
        exact: true,
      })
      .click(),
  ]);
  expect(file.suggestedFilename()).toMatch(
    html ? /^deck-\d{4}-\d{2}-\d{2}\.html$/ : /^deck-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const path = await file.path();
  if (!path) throw new Error('Download missing');
  return readFile(path, 'utf8');
}

async function changeCard(page: Page, changes: Record<string, unknown>) {
  await page.evaluate(async (patch) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('cards', 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        const store = tx.objectStore('cards');
        const request = store.getAll();
        request.onsuccess = () => {
          const card = request.result[0] as Record<string, unknown> | undefined;
          if (!card) throw new Error('Seed card missing');
          store.put({ ...card, ...patch });
        };
      });
    } finally {
      db.close();
    }
  }, changes);
}

test('HTML downloads preserve exact links and recover the snapshot after live corruption', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/#settings');
    await page.waitForSelector('html[data-deck-ready="true"]');
    await changeCard(page, {
      title: '<script>bad()</script> & فارسی',
      url: 'https://example.com/?a=1&b=%22quoted%22',
      note: 'PRIVATE NOTE',
    });
    await page.locator('[data-deck="snapshot-now"]').click();
    await expect(
      page.locator('[data-deck="toast"]').filter({ hasText: 'Backup saved' }),
    ).toBeVisible();
    const json = JSON.parse(await download(page, false)) as {
      cards: { title: string; url?: string; deletedAt: number | null }[];
    };
    const html = await download(page, true);
    const parsed = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      return {
        scripts: doc.querySelectorAll('script').length,
        links: [...doc.querySelectorAll('a')].map((node) => ({
          title: node.textContent,
          url: node.getAttribute('href'),
        })),
      };
    }, html);
    expect(parsed.scripts).toBe(0);
    expect(parsed.links).toEqual(
      expect.arrayContaining(
        json.cards
          .filter((card) => card.url && card.deletedAt === null)
          .map(({ title, url }) => ({ title, url })),
      ),
    );
    expect(parsed.links).toHaveLength(
      json.cards.filter((card) => card.url && card.deletedAt === null).length,
    );
    expect(html).not.toContain('PRIVATE NOTE');
    await changeCard(page, { title: 42 });
    expect(await download(page, true)).toBe(html);
  } finally {
    await context.close();
  }
});

test('unsafe HTML export shows a visible error while JSON still preserves the record', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/#settings');
    await page.waitForSelector('html[data-deck-ready="true"]');
    await changeCard(page, { url: 'javascript:alert(1)' });
    const downloads: string[] = [];
    page.on('download', (file) => downloads.push(file.suggestedFilename()));
    await page.locator('[data-deck="export-bookmarks"]').click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'cannot be safely exported' }),
    ).toBeVisible();
    expect(downloads).toEqual([]);
    expect(await download(page, false)).toContain('javascript:alert(1)');
  } finally {
    await context.close();
  }
});

test('bookmark export stays keyboard accessible in narrow Day and Night settings', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('chrome://newtab/#settings');
    await page.waitForSelector('html[data-deck-ready="true"]');
    for (const theme of ['day', 'night']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const button = page.locator('[data-deck="export-bookmarks"]');
      await button.focus();
      await expect(button).toBeFocused();
      const bounds = await button.boundingBox();
      if (!bounds) throw new Error('Export control has no bounds');
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(720);
      const [file] = await Promise.all([
        page.waitForEvent('download'),
        page.keyboard.press('Enter'),
      ]);
      expect(file.suggestedFilename()).toMatch(/\.html$/);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-deck="settings"]')
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`${theme}-320.png`),
        animations: 'disabled',
      });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    const extensionPage = await page.evaluate(() =>
      chrome.runtime.getURL('src/newtab/index.html'),
    );
    await page.goto(`${extensionPage}?bookmark-export-layout#settings`);
    await page.waitForSelector('html[data-deck-ready="true"]');
    const ratio = await page.evaluate(() => devicePixelRatio);
    await testInfo.attach('zoom-tab', {
      body: JSON.stringify(
        await page.evaluate(async () => ({
          url: location.href,
          tab: await chrome.tabs.getCurrent(),
        })),
      ),
      contentType: 'application/json',
    });
    await page.evaluate(async () => {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id === undefined)
        throw new Error('Current extension tab missing');
      await chrome.tabs.setZoom(tab.id, 2);
    });
    await expect
      .poll(() => page.evaluate(() => devicePixelRatio))
      .toBe(ratio * 2);
    await page
      .getByRole('button', { name: 'Export data', exact: true })
      .focus();
    await page.keyboard.press('Tab');
    const button = page.locator('[data-deck="export-bookmarks"]');
    await expect(button).toBeFocused();
    const bounds = await button.boundingBox();
    const panel = await page.locator('[data-deck="settings"]').boundingBox();
    if (!bounds || !panel) throw new Error('Missing zoomed export geometry');
    expect(bounds.y).toBeGreaterThanOrEqual(panel.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(
      panel.y + panel.height,
    );
    await page.screenshot({
      path: testInfo.outputPath('zoom-200.png'),
      animations: 'disabled',
    });
  } finally {
    await context.close();
  }
});
