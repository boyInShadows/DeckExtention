import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { launchExtension } from './extension';

const READY = 'html[data-deck-ready="true"]';
const URL_INPUT = 'https://paste.example.com/new';
const form = (page: Page) => page.locator('[data-deck="pin-add-form"]');

async function paste(page: Page, text: string, selector = 'body') {
  return page.locator(selector).evaluate((target, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }, text);
}

async function cards(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<
      {
        url?: string;
        pinned: boolean;
        deckId: string;
        title: string;
        pinLabel?: string;
      }[]
    >((resolve, reject) => {
      const request = db.transaction('cards').objectStore('cards').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return records;
  });
}

for (const destination of ['inbox', 'pin']) {
  test(`outside-input paste saves only to ${destination} and survives reload`, async () => {
    const context = await launchExtension();
    try {
      const page = await context.newPage();
      await page.goto('chrome://newtab/');
      await page.waitForSelector(READY);
      const before = await cards(page);
      expect(await paste(page, URL_INPUT)).toBe(true);
      await expect(form(page)).toHaveAttribute('aria-label', 'Save link');
      await expect(
        form(page).getByRole('button', { name: 'Save to Inbox', exact: true }),
      ).toBeEnabled();
      await expect(
        form(page).getByRole('button', { name: 'Add pin', exact: true }),
      ).toBeEnabled();
      expect(await cards(page)).toEqual(before);
      await form(page)
        .getByRole('textbox', { name: 'Label (optional)' })
        .fill('My pasted link');
      if (destination === 'inbox')
        await form(page)
          .getByRole('textbox', { name: 'Paste a URL' })
          .press('Enter');
      else
        await form(page)
          .getByRole('button', { name: 'Add pin', exact: true })
          .click();
      await expect(form(page)).toHaveCount(0);
      const saved = (await cards(page)).filter(({ url }) => url === URL_INPUT);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        pinned: destination === 'pin',
        deckId: 'deck_inbox',
        ...(destination === 'inbox'
          ? { title: 'My pasted link' }
          : { pinLabel: 'My pasted link' }),
      });
      expect(await cards(page)).toHaveLength(before.length + 1);
      await page.reload();
      await page.waitForSelector(READY);
      expect(
        (await cards(page)).filter(({ url }) => url === URL_INPUT),
      ).toEqual(saved);
      if (destination === 'inbox') {
        await page
          .getByRole('button', { name: 'Open Inbox', exact: true })
          .click();
        await expect(
          page
            .locator('[data-deck="card"]')
            .filter({ hasText: 'My pasted link' }),
        ).toBeVisible();
      } else
        await expect(
          page.locator(
            '[data-deck="pin"][href="https://paste.example.com/new"]',
          ),
        ).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test('full pins still permit paste to Inbox and Cancel restores Line focus', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await page.evaluate(
      async (orders) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('deck');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const tx = db.transaction('cards', 'readwrite');
        for (let index = 0; index < 12; index += 1)
          tx.objectStore('cards').put({
            id: `full_pin_${index}`,
            deckId: 'deck_inbox',
            title: `Pin ${index}`,
            url: `https://full${index}.example.com/`,
            hostname: `full${index}.example.com`,
            order: orders[index],
            pinned: true,
            lastOpenedAt: null,
            createdAt: 1,
            updatedAt: 1,
            deletedAt: null,
          });
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'aA', 'aB'],
    );
    await page.reload();
    await page.waitForSelector(READY);
    await expect(
      page.getByRole('button', { name: '12 pins max', exact: true }),
    ).toBeDisabled();
    expect(await paste(page, URL_INPUT)).toBe(true);
    await expect(
      form(page).getByRole('button', { name: 'Add pin', exact: true }),
    ).toBeDisabled();
    await form(page)
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await expect(form(page)).toHaveCount(0);
    await expect(page.locator('[data-deck="line"] input')).toBeFocused();
    expect(await paste(page, URL_INPUT)).toBe(true);
    await form(page)
      .getByRole('button', { name: 'Save to Inbox', exact: true })
      .click();
    await expect(form(page)).toHaveCount(0);
    const records = await cards(page);
    expect(records.filter(({ pinned }) => pinned)).toHaveLength(12);
    expect(
      records.filter(({ url, pinned }) => url === URL_INPUT && !pinned),
    ).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test('normal text fields and invalid pasted URLs are left alone', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    expect(await paste(page, URL_INPUT, '[data-deck="line"] input')).toBe(
      false,
    );
    await page.evaluate(() => {
      const textarea = document.createElement('textarea');
      textarea.id = 'paste-test-textarea';
      document.body.append(textarea);
      const editable = document.createElement('div');
      editable.id = 'paste-test-editable';
      editable.contentEditable = 'true';
      document.body.append(editable);
    });
    for (const selector of ['#paste-test-textarea', '#paste-test-editable'])
      expect(await paste(page, URL_INPUT, selector)).toBe(false);
    for (const text of [
      'ordinary text',
      'javascript:alert(1)',
      'https://',
      'https://bad host/',
    ]) {
      const diagnostic = await page.evaluate((input) => {
        const data = new DataTransfer();
        data.setData('text/plain', input);
        try {
          return {
            input,
            clipboard: data.getData('text/plain'),
            hostname: new URL(input).hostname,
            urlType: String(URL),
          };
        } catch (error) {
          return {
            input,
            clipboard: data.getData('text/plain'),
            error: String(error),
          };
        }
      }, text);
      expect(await paste(page, text), JSON.stringify(diagnostic)).toBe(false);
    }
    await expect(form(page)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('failed Inbox paste save retains the draft and duplicate checks remain active', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    expect(await paste(page, 'https://www.wikipedia.org/')).toBe(true);
    await form(page)
      .getByRole('button', { name: 'Save to Inbox', exact: true })
      .click();
    await expect(
      form(page).locator('[data-deck="duplicate-link"]'),
    ).toContainText('Already saved in');
    await form(page)
      .getByRole('textbox', { name: 'Paste a URL' })
      .fill(URL_INPUT);
    await form(page)
      .getByRole('textbox', { name: 'Label (optional)' })
      .fill('Keep this draft');
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'cards') throw new Error('Paste save failed');
        return original.apply(this, args);
      };
    });
    await form(page)
      .getByRole('button', { name: 'Save to Inbox', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText('Paste save failed');
    await expect(
      form(page).getByRole('textbox', { name: 'Paste a URL' }),
    ).toHaveValue(URL_INPUT);
    await expect(
      form(page).getByRole('textbox', { name: 'Label (optional)' }),
    ).toHaveValue('Keep this draft');
    expect(
      (await cards(page)).filter(({ url }) => url === URL_INPUT),
    ).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test('destination controls fit narrow Day/Night and remain keyboard reachable at 200 percent zoom', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    const extensionPage = await page.evaluate(() =>
      chrome.runtime.getURL('src/newtab/index.html'),
    );
    await page.goto(extensionPage);
    await page.waitForSelector(READY);
    expect(await paste(page, URL_INPUT)).toBe(true);
    await expect(form(page)).toBeVisible();
    for (const theme of ['day', 'night']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.setViewportSize({ width: 320, height: 568 });
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-deck="pin-add-form"]')
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: `docs/artifacts/paste-destination-20261112/${theme}-320.png`,
        animations: 'disabled',
      });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    const ratio = await page.evaluate(() => devicePixelRatio);
    await page.evaluate(() => chrome.tabs.setZoom(2));
    await expect
      .poll(() => page.evaluate(() => devicePixelRatio))
      .toBe(ratio * 2);
    await form(page).getByRole('textbox', { name: 'Paste a URL' }).focus();
    await page.keyboard.press('Tab');
    for (const name of ['Save to Inbox', 'Add pin']) {
      await page.keyboard.press('Tab');
      const control = form(page).getByRole('button', { name, exact: true });
      await expect(control).toBeFocused();
      const bounds = await control.boundingBox();
      const panel = await form(page).boundingBox();
      if (!bounds || !panel) throw new Error('Missing paste control geometry');
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(
        panel.y + panel.height,
      );
      expect(bounds.y).toBeGreaterThanOrEqual(panel.y);
    }
    await page.screenshot({
      path: 'docs/artifacts/paste-destination-20261112/zoom-200.png',
      animations: 'disabled',
    });
  } finally {
    await context.close();
  }
});
