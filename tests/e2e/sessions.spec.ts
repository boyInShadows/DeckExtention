import { expect, test, type BrowserContext } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { launchExtension } from './extension';

const TAB_COUNT = 30;
const FIXTURE_BYTES = 4 * 1024 * 1024;
const runFile = promisify(execFile);

async function memoryBytes(context: BrowserContext): Promise<number | null> {
  if (process.platform !== 'win32') return null;
  const browser = context.browser();
  if (!browser) return null;
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    const ids = processInfo.map(({ id }) => id);
    if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0))
      throw new Error('Invalid browser process ids');
    const { stdout } = await runFile('powershell.exe', [
      '-NoProfile',
      '-Command',
      `(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSet64 -Sum).Sum`,
    ]);
    const bytes = Number(stdout.trim());
    if (!Number.isFinite(bytes) || bytes <= 0)
      throw new Error('Browser memory was not measured');
    return bytes;
  } finally {
    await cdp.detach();
  }
}

test('stash saves 30 tabs, preserves pinned/internal tabs, offers Undo, and keeps sessions searchable', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(90_000);
  const context = await launchExtension();
  try {
    await context.route('http://session.test/**', (route) => {
      const key = new URL(route.request().url()).pathname.slice(1);
      return route.fulfill({
        contentType: 'text/html',
        body: `<title>${key} research</title><p>${key}</p><script>globalThis.fixtureData=new Uint8Array(${FIXTURE_BYTES}).fill(42)</script>`,
      });
    });
    const deck = await context.newPage();
    await deck.goto('chrome://newtab/');
    await deck.waitForSelector('html[data-deck-ready="true"]');
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const fixtures: { id: number; url: string; title: string }[] = [];
    const pinned = await context.newPage();
    await pinned.goto('http://session.test/pinned');
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id === undefined) throw new Error('Missing pinned fixture');
      await chrome.tabs.update(tab.id, { pinned: true });
    });
    const internal = await context.newPage();
    await internal.goto('chrome://version/');
    const keys = Array.from(
      { length: TAB_COUNT },
      (_, i) =>
        `${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`,
    );
    for (const key of keys) {
      const page = await context.newPage();
      await page.goto(`http://session.test/${key}`);
      const id = await worker.evaluate(
        async () =>
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
            ?.id,
      );
      if (id === undefined) throw new Error('Missing fixture tab');
      fixtures.push({ id, url: page.url(), title: await page.title() });
    }
    // Native optional-permission UI is an owner check. Only its sensitive
    // metadata is supplied here; Chrome still creates and closes real tabs.
    await worker.evaluate((items) => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      const get = chrome.tabs.get.bind(chrome.tabs);
      const contains = chrome.permissions.contains.bind(chrome.permissions);
      const addMetadata = (tab: chrome.tabs.Tab) => ({
        ...tab,
        ...items.find(({ id }) => id === tab.id),
      });
      const tabs = chrome.tabs as unknown as Record<string, unknown>;
      tabs.query = async (info: chrome.tabs.QueryInfo) =>
        (await query(info)).map(addMetadata);
      tabs.get = async (id: number) => addMetadata(await get(id));
      (chrome.permissions as unknown as Record<string, unknown>).contains = (
        info: chrome.permissions.Permissions,
      ) =>
        info.permissions?.includes('tabs')
          ? Promise.resolve(true)
          : contains(info);
    }, fixtures);
    testInfo.annotations.push({
      type: 'fixture',
      description:
        'Optional tabs grant and URL/title metadata supplied in worker; native grant remains a manual check.',
    });
    const before = await memoryBytes(context);
    const next = context.waitForEvent('page');
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const command = chrome.commands.onCommand as unknown as {
        dispatch: (name: string, tab: chrome.tabs.Tab) => void;
      };
      if (!tab) throw new Error('Missing active tab');
      command.dispatch('stash', tab);
    });
    const summary = await next;
    await summary.waitForSelector('html[data-deck-ready="true"]');
    await expect(summary.locator('[data-deck="toast"]')).toContainText(
      'Stashed 30 tabs',
    );
    await expect(summary.locator('[data-deck="card"]')).toHaveCount(TAB_COUNT);
    await expect(
      summary.getByRole('button', { name: 'Sessions', exact: true }),
    ).toContainText('1');
    expect(pinned.isClosed()).toBe(false);
    expect(internal.isClosed()).toBe(false);
    const after = await memoryBytes(context);
    await testInfo.attach('session-memory.json', {
      body: JSON.stringify({
        fixture: '30 tabs, each holding a touched 4 MiB Uint8Array',
        beforeBytes: before,
        afterBytes: after,
        releasedBytes:
          before !== null && after !== null ? before - after : null,
      }),
      contentType: 'application/json',
    });
    if (before !== null && after !== null) expect(after).toBeLessThan(before);
    const existingPages = new Set(context.pages());
    await summary.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(
        () => context.pages().filter((page) => !existingPages.has(page)).length,
      )
      .toBe(TAB_COUNT);
    for (const restored of context
      .pages()
      .filter((page) => !existingPages.has(page))) {
      await restored.bringToFront();
      await restored.waitForURL(/^http:\/\/session.test\/[a-z]{2}$/);
    }
    await summary.bringToFront();

    const session = summary.locator('[data-deck="deck"]');
    await session.focus();
    await summary.keyboard.press('p');
    await expect(session.locator('[data-deck="session-kept"]')).toHaveText(
      'Kept',
    );
    await summary.screenshot({
      path: testInfo.outputPath('sessions-kept.png'),
    });
    await summary.reload();
    await summary.waitForSelector('html[data-deck-ready="true"]');
    await summary
      .getByRole('button', { name: 'Open Deck drawer', exact: true })
      .click();
    await expect(summary.locator('[data-deck="session-kept"]')).toHaveText(
      'Kept',
    );
    await summary.keyboard.press('Escape');
    for (const key of keys) {
      await summary.locator('[data-deck="line"] input').fill(key);
      await expect(
        summary
          .locator('[data-deck="line-results"] [data-deck="card"]')
          .first(),
      ).toContainText(`${key} research`);
    }
    await summary.locator('[data-deck="line"] input').fill('az');
    const opened = context.waitForEvent('page');
    await summary.locator('[data-deck="line"] input').press('Shift+Enter');
    await (await opened).waitForURL('http://session.test/az');
  } finally {
    await context.close();
  }
});

test('stash permission can be dismissed and the Line delegates a granted stash', async () => {
  const context = await launchExtension();
  try {
    const deck = await context.newPage();
    await deck.goto('chrome://newtab/');
    await deck.waitForSelector('html[data-deck-ready="true"]');
    await deck.locator('[data-deck="line"] input').fill('>stash');
    await deck.locator('[data-deck="line"] input').press('Enter');
    await expect(
      deck.getByText(
        'Deck needs tab access to save this window before closing its tabs.',
      ),
    ).toBeVisible();
    await deck.getByRole('button', { name: 'Dismiss', exact: true }).click();
    expect(
      await deck.evaluate(() =>
        chrome.permissions.contains({ permissions: ['tabs'] }),
      ),
    ).toBe(false);
    expect(deck.isClosed()).toBe(false);
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await worker.evaluate(() => {
      (chrome.permissions as unknown as Record<string, unknown>).contains =
        () => Promise.resolve(true);
    });
    await deck.evaluate(() => {
      (chrome.permissions as unknown as Record<string, unknown>).contains =
        () => Promise.resolve(true);
    });
    const next = context.waitForEvent('page');
    await deck.locator('[data-deck="line"] input').fill('>stash');
    await deck.locator('[data-deck="line"] input').press('Enter');
    const summary = await next;
    await summary.waitForSelector('html[data-deck-ready="true"]');
    await expect(summary.locator('[data-deck="toast"]')).toContainText(
      'No unpinned web tabs',
    );
    await expect(summary.locator('[data-deck="sessions-empty"]')).toContainText(
      '>stash',
    );
    for (const width of [1280, 640]) {
      await summary.setViewportSize({ width, height: 720 });
      const heights = await summary
        .locator('[data-deck="page"][data-system]')
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getBoundingClientRect().height),
        );
      expect(heights).toHaveLength(4);
      expect(Math.max(...heights)).toBeLessThanOrEqual(48);
      await expect(
        summary.getByRole('button', { name: 'Examples', exact: true }),
      ).toBeVisible();
      await summary.screenshot({
        path: test.info().outputPath(`sessions-rail-${width}.png`),
      });
    }
  } finally {
    await context.close();
  }
});
