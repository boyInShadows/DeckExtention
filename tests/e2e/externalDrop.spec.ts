import { expect, test, type Page, type Locator } from '@playwright/test';
import { launchExtension } from './extension';

const READY = 'html[data-deck-ready="true"]';
const URL_INPUT = 'https://drop.example.com/article';

async function nativeDrop(
  page: Page,
  target: Locator,
  uriList: string,
  plainText = '',
  onOver?: () => Promise<void>,
) {
  await target.hover();
  const box = await target.boundingBox();
  if (!box) throw new Error('Missing native drop target');
  const client = await page.context().newCDPSession(page);
  try {
    const data = {
      items: [
        { mimeType: 'text/uri-list', data: uriList },
        { mimeType: 'text/plain', data: plainText },
      ],
      dragOperationsMask: 1,
    };
    const position = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      data,
    };
    for (const type of ['dragEnter', 'dragOver'] as const)
      await client.send('Input.dispatchDragEvent', { type, ...position });
    await onOver?.();
    await client.send('Input.dispatchDragEvent', { type: 'drop', ...position });
  } finally {
    await client.detach();
  }
}

async function cards(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<
      { url?: string; pinned: boolean; deckId: string }[]
    >((resolve, reject) => {
      const request = db.transaction('cards').objectStore('cards').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return records;
  });
}

for (const destination of ['pin', 'inbox', 'surface', 'deck']) {
  test(`native external link drop saves to ${destination}, reloads and stays on Deck`, async () => {
    const context = await launchExtension();
    try {
      const page = await context.newPage();
      await page.goto('chrome://newtab/');
      await page.waitForSelector(READY);
      const before = await cards(page);
      const original = page.url();
      let target =
        destination === 'pin'
          ? page.locator('[data-deck="pins"]')
          : destination === 'surface'
            ? page.locator('[data-deck="clock"]')
            : page.locator('[data-drop-inbox]');
      let deckId = 'deck_inbox';
      if (destination === 'deck') {
        await page.keyboard.press('Control+J');
        const deck = page.locator('[data-deck="deck"]').first();
        await expect(deck).toBeVisible();
        deckId = (await deck.getAttribute('data-deck-id')) ?? '';
        target = deck.locator('header').first();
      }
      await page.evaluate(() => {
        document.addEventListener(
          'drop',
          (event) =>
            (document.documentElement.dataset.lastDropTrusted = String(
              event.isTrusted,
            )),
          { once: true },
        );
      });
      await nativeDrop(
        page,
        target,
        `# external link\r\n${URL_INPUT}\r\n`,
        'https://conflicting.example/',
        async () => {
          await expect(page.locator('[data-external-drop]')).toHaveCount(1);
          if (destination === 'pin')
            await page.screenshot({
              path: 'docs/artifacts/external-drop-20261112/pin-highlight.png',
              animations: 'disabled',
            });
        },
      );
      await expect
        .poll(
          async () =>
            (await cards(page)).filter(({ url }) => url === URL_INPUT).length,
        )
        .toBe(1);
      expect(page.url()).toBe(original);
      expect(
        await page.locator('html').getAttribute('data-last-drop-trusted'),
      ).toBe('true');
      const record = (await cards(page)).find(({ url }) => url === URL_INPUT);
      expect(record).toMatchObject({ pinned: destination === 'pin', deckId });
      expect(await cards(page)).toHaveLength(before.length + 1);
      await expect(page.locator('[data-external-drop]')).toHaveCount(0);
      await page.reload();
      await page.waitForSelector(READY);
      expect((await cards(page)).find(({ url }) => url === URL_INPUT)).toEqual(
        record,
      );
    } finally {
      await context.close();
    }
  });
}

test('native invalid/multi-link drops do not navigate or write, and a failed write stays visible', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    const before = await cards(page);
    const original = page.url();
    const target = page.locator('[data-drop-inbox]');
    for (const uri of [
      'javascript:alert(1)',
      `${URL_INPUT}\nhttps://other.example/`,
    ]) {
      await nativeDrop(page, target, uri);
      await expect(page.getByRole('alert').last()).toContainText(
        'Drop one web link at a time.',
      );
      expect(page.url()).toBe(original);
      expect(await cards(page)).toEqual(before);
    }
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'cards') {
          IDBObjectStore.prototype.put = put;
          throw new Error('External save failed');
        }
        return put.apply(this, args);
      };
    });
    await nativeDrop(page, target, URL_INPUT);
    await expect(page.getByRole('alert').last()).toContainText(
      'External save failed',
    );
    expect(page.url()).toBe(original);
    expect(await cards(page)).toEqual(before);
    await nativeDrop(page, target, `${URL_INPUT}?retry=1`);
    await expect
      .poll(
        async () =>
          (await cards(page)).filter(
            ({ url }) => url === `${URL_INPUT}?retry=1`,
          ).length,
      )
      .toBe(1);
  } finally {
    await context.close();
  }
});

test('native drops on an editor do not create records, and normalized duplicates are explained', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    const before = await cards(page);
    const original = page.url();
    const line = page.locator('[data-deck="line"] input');
    await line.fill('Keep my draft');
    await nativeDrop(page, line, URL_INPUT);
    expect(page.url()).toBe(original);
    expect(await cards(page)).toEqual(before);
    await nativeDrop(
      page,
      page.locator('[data-drop-inbox]'),
      'https://www.wikipedia.org/',
    );
    await expect(
      page
        .locator('[data-deck="toast"]')
        .filter({ hasText: 'Already saved in' }),
    ).toBeVisible();
    expect(await cards(page)).toEqual(before);
  } finally {
    await context.close();
  }
});

test('file payloads are rejected without writes or navigation', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    const before = await cards(page);
    const original = page.url();
    const prevented = await page
      .locator('[data-drop-inbox]')
      .evaluate((target) => {
        const data = new DataTransfer();
        data.items.add(
          new File(['local test'], 'note.txt', { type: 'text/plain' }),
        );
        data.setData('text/plain', 'https://files.example.com/');
        const event = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(prevented).toBe(true);
    await expect(page.getByRole('alert').last()).toContainText(
      'Drop one web link at a time.',
    );
    expect(await cards(page)).toEqual(before);
    expect(page.url()).toBe(original);
  } finally {
    await context.close();
  }
});
