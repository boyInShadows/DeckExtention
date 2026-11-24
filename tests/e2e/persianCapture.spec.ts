import {
  expect,
  test,
  type Worker,
  type Page,
  type BrowserContext,
} from '@playwright/test';
import { launchExtension } from './extension';
import { CAPTURE_NOTICE_KEY } from '../../packages/schema/src/capture';
import { captureStrings as fa } from '../../apps/extension/src/i18n/fa/captureStrings';
import { panelStrings as panels } from '../../apps/extension/src/i18n/fa/panelStrings';
import {
  showCaptureToast,
  type ToastModel,
} from '../../apps/extension/src/capture/toast';

async function watchNativeLabels(worker: Worker) {
  await worker.evaluate(() => {
    const fixture = globalThis as typeof globalThis & {
      nativeLabels: string[];
    };
    fixture.nativeLabels = [];
    const create = chrome.contextMenus.create.bind(chrome.contextMenus);
    chrome.contextMenus.create = (options, callback) => {
      fixture.nativeLabels.push(options.title ?? '');
      return create(options, callback);
    };
  });
}

async function selectLanguage(
  page: Page,
  worker: Worker,
  language: 'en' | 'fa',
) {
  await page.locator('[data-deck="language-select"]').selectOption(language);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect
    .poll(() => worker.evaluate(() => chrome.action.getTitle({})))
    .toBe(
      language === 'fa' ? fa.toolbarSave : "Save this page to Deck's Inbox",
    );
}

async function dispatch(worker: Worker, name: string, url?: string) {
  await worker.evaluate(
    async ({ name, url }) => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab) throw new Error('Missing fixture tab');
      const event = chrome.commands.onCommand as unknown as {
        dispatch: (name: string, tab: chrome.tabs.Tab) => void;
      };
      event.dispatch(name, {
        ...tab,
        ...(url ? { url, title: 'Mixed فارسی link' } : {}),
      });
    },
    { name, url },
  );
}

test('saved language updates real native toolbar/menu labels and worker fallback notices', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/#settings');
    await page.waitForSelector('html[data-deck-ready="true"]');
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'deck:language' }),
    );
    await watchNativeLabels(worker);
    await selectLanguage(page, worker, 'fa');
    expect(
      await worker.evaluate(
        () =>
          (globalThis as typeof globalThis & { nativeLabels: string[] })
            .nativeLabels,
      ),
    ).toEqual([fa.menuSavePage, fa.menuSaveLink]);
    await selectLanguage(page, worker, 'en');
    await selectLanguage(page, worker, 'fa');
    await worker.evaluate(() => {
      chrome.permissions.contains = async () => true;
    });
    await dispatch(worker, 'quick-save', 'chrome://version/');
    await expect
      .poll(() =>
        worker.evaluate(
          async (key) => (await chrome.storage.local.get(key))[key]?.message,
          CAPTURE_NOTICE_KEY,
        ),
      )
      .toBe(fa.unsupportedPage);
    await page.reload();
    await expect(
      page
        .locator('[data-deck="toast"]')
        .filter({ hasText: fa.unsupportedPage }),
    ).toBeVisible();
    const opened = context.waitForEvent('page');
    await dispatch(worker, 'stash');
    const summary = await opened;
    await expect(
      summary
        .locator('[data-deck="toast"]')
        .filter({ hasText: panels.stashEmpty }),
    ).toBeVisible();
    await expect(summary.locator('html')).toHaveAttribute('dir', 'rtl');
    test.info().annotations.push({
      type: 'fixture',
      description:
        'Worker command dispatch and optional-grant result are supplied; real native physical shortcuts/grant prompts remain owner checks.',
    });
  } finally {
    await context.close();
  }
});

async function captureModel(worker: Worker): Promise<ToastModel> {
  await expect
    .poll(() =>
      worker.evaluate(() =>
        Boolean(
          (globalThis as typeof globalThis & { captureModel?: ToastModel })
            .captureModel,
        ),
      ),
    )
    .toBe(true);
  return worker.evaluate(
    () =>
      (globalThis as typeof globalThis & { captureModel: ToastModel })
        .captureModel,
  );
}

async function supplyInjectionTransport(worker: Worker) {
  await worker.evaluate(() => {
    chrome.permissions.contains = async () => true;
    Object.assign(chrome, {
      scripting: {
        executeScript: async ({ args }: { args: ToastModel[] }) => {
          Object.assign(globalThis, { captureModel: args[0] });
          return [{ result: true }];
        },
      },
    });
  });
}

async function expectPhysicalPersianToast(
  context: BrowserContext,
  model: ToastModel,
) {
  const article = await context.newPage();
  await article.route('http://deck.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en" dir="ltr"><title>Article</title><h1>Article</h1></html>',
    }),
  );
  await article.goto('http://deck.test/article');
  const outcome = article.evaluate(showCaptureToast, {
    ...model,
    report: undefined,
  });
  const host = article.locator('#deck-capture-toast');
  await expect(host).toHaveAttribute('lang', 'fa');
  await expect(host).toHaveAttribute('dir', 'rtl');
  expect(await host.evaluate((node) => getComputedStyle(node).direction)).toBe(
    'rtl',
  );
  await article.keyboard.press('Enter');
  await article.keyboard.insertText('یادداشت Mixed');
  await article.keyboard.press('Enter');
  expect(await outcome).toEqual({ kind: 'note', note: 'یادداشت Mixed' });
  await article.screenshot({
    path: test.info().outputPath('persian-capture.png'),
  });
}

async function expectPersistedNote(page: Page, model: ToastModel) {
  expect(
    await page.evaluate(
      ({ report }) =>
        chrome.runtime.sendMessage({
          ...report,
          outcome: { kind: 'note', note: 'یادداشت Mixed' },
        }),
      model,
    ),
  ).toEqual({ isDone: true });
  const card = await page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('deck');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ note: string; title: string }>(
        (resolve, reject) => {
          const request = database
            .transaction('cards')
            .objectStore('cards')
            .get(id);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
    } finally {
      database.close();
    }
  }, model.report?.cardId);
  expect(card).toMatchObject({
    title: 'Mixed فارسی link',
    note: 'یادداشت Mixed',
  });
}

test('Quick Save builds a Persian RTL toast with working physical note keys on an English page', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/#settings');
    await page.waitForSelector('html[data-deck-ready="true"]');
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await selectLanguage(page, worker, 'fa');
    await supplyInjectionTransport(worker);
    await dispatch(
      worker,
      'quick-save',
      'https://example.test/persian-capture',
    );
    const model = await captureModel(worker);
    expect(model).toMatchObject({
      language: 'fa',
      mode: 'saved',
      message: fa.saved,
      labels: { addNote: fa.addNote, undo: fa.undo },
    });
    await expectPhysicalPersianToast(context, model);
    await expectPersistedNote(page, model);
    test.info().annotations.push({
      type: 'fixture',
      description:
        'Optional grant and injection transport supplied; actual worker persistence/model and physical page toast keys run. Native website injection/grant remains owner acceptance.',
    });
  } finally {
    await context.close();
  }
});
