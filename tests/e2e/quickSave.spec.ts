import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  showCaptureToast,
  TOAST_HOST_ID,
  type ToastModel,
  type ToastOutcome,
} from '../../apps/extension/src/capture/toast';
import { launchExtension } from './extension';

const READY_SELECTOR = 'html[data-deck-ready="true"]';
const ARTICLE_URL = 'http://deck.test/article';
const ARTICLE_TITLE = 'Deck test article';

const MODEL: ToastModel = {
  css: readFileSync(resolve('apps/extension/src/capture/toast.css'), 'utf8'),
  theme: 'night',
  mode: 'saved',
  message: 'Saved to Inbox',
  hint: '↩ add note · ⌫ undo',
  labels: {
    addNote: 'Add note',
    undo: 'Undo',
    openDeck: 'Open Deck',
    notePlaceholder: 'Note, then Enter',
    noteSaved: 'Note saved',
    undone: 'Removed from Inbox',
  },
  durationMs: 2_500,
  confirmMs: 100,
  noteIdleMs: 20_000,
};

/** A local stand-in for a web page. Nothing leaves the machine. */
async function serveArticle(context: BrowserContext): Promise<void> {
  await context.route('http://deck.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>${ARTICLE_TITLE}</title><h1>Article</h1><textarea></textarea>`,
    }),
  );
}

async function openArticle(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(ARTICLE_URL);
  return page;
}

function startToast(page: Page, model: ToastModel): Promise<ToastOutcome> {
  return page.evaluate(showCaptureToast, model);
}

test('toast: Backspace undoes, Enter adds a note, and it times out alone', async () => {
  const context = await launchExtension();
  try {
    await serveArticle(context);
    const page = await openArticle(context);

    const undo = startToast(page, MODEL);
    await expect(page.locator(`#${TOAST_HOST_ID}`)).toHaveCount(1);
    await page.keyboard.press('Backspace');
    expect(await undo).toEqual({ kind: 'undo' });

    const note = startToast(page, MODEL);
    await page.keyboard.press('Enter');
    await page.keyboard.type('read on the train');
    await page.keyboard.press('Enter');
    expect(await note).toEqual({ kind: 'note', note: 'read on the train' });

    const timeout = startToast(page, { ...MODEL, durationMs: 200 });
    expect(await timeout).toEqual({ kind: 'timeout' });
    await expect(page.locator(`#${TOAST_HOST_ID}`)).toHaveCount(0);

    const open = startToast(page, { ...MODEL, mode: 'duplicate' });
    await page.keyboard.press('Enter');
    expect(await open).toEqual({ kind: 'open' });
  } finally {
    await context.close();
  }
});

test('toast: page scripts cannot fake a keystroke, and typing in the page is left alone', async () => {
  const context = await launchExtension();
  try {
    await serveArticle(context);
    const page = await openArticle(context);

    const outcome = startToast(page, { ...MODEL, durationMs: 1_000 });
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    });
    await page.locator('textarea').focus();
    await page.keyboard.press('Backspace');
    expect(await outcome).toEqual({ kind: 'timeout' });
  } finally {
    await context.close();
  }
});

interface StubbedWindow {
  chrome: { runtime?: { sendMessage: (message: unknown) => Promise<unknown> } };
  sentMessages: unknown[];
  nextReply: unknown;
}

/** Stands in for the service worker so the page-side report path runs for real. */
async function stubServiceWorker(page: Page, reply: unknown): Promise<void> {
  await page.evaluate((value) => {
    const stub = window as unknown as StubbedWindow;
    stub.sentMessages = [];
    stub.nextReply = value;
    stub.chrome.runtime = {
      sendMessage: (message) => {
        stub.sentMessages.push(message);
        return Promise.resolve(stub.nextReply);
      },
    };
  }, reply);
}

const REPORT = {
  type: 'deck:toast-decision',
  cardId: 'card_000001',
  pageId: 'inbox',
};

test('toast: hands decisions to the service worker by message, not by waiting', async () => {
  const context = await launchExtension();
  try {
    await serveArticle(context);
    const page = await openArticle(context);
    await stubServiceWorker(page, { isDone: true });

    const shown = await page.evaluate(showCaptureToast, {
      ...MODEL,
      report: REPORT,
    });
    expect(shown).toBe(true);
    await page.keyboard.press('Enter');
    await page.keyboard.type('check pricing');
    await page.keyboard.press('Enter');
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as StubbedWindow).sentMessages),
      )
      .toEqual([
        { ...REPORT, outcome: { kind: 'note', note: 'check pricing' } },
      ]);

    // A timeout is not a decision: nothing is sent.
    await stubServiceWorker(page, { isDone: true });
    await page.evaluate(showCaptureToast, {
      ...MODEL,
      durationMs: 150,
      report: REPORT,
    });
    await expect(page.locator(`#${TOAST_HOST_ID}`)).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as unknown as StubbedWindow).sentMessages,
      ),
    ).toEqual([]);
  } finally {
    await context.close();
  }
});

test('manifest: no content script, four install permissions, capture is optional', async () => {
  const manifest = JSON.parse(
    readFileSync(resolve('apps/extension/dist/manifest.json'), 'utf8'),
  ) as Record<string, unknown>;
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.permissions).toEqual([
    'storage',
    'unlimitedStorage',
    'favicon',
    'contextMenus',
  ]);
  expect(manifest.optional_permissions).toEqual(
    expect.arrayContaining(['activeTab', 'scripting']),
  );
});

test('quick save: one-time grant is revocable, and notices reach the next new tab', async () => {
  const context = await launchExtension();
  try {
    const deck = await context.newPage();
    await deck.goto('chrome://newtab/#settings');
    await deck.waitForSelector(READY_SELECTOR);
    await deck.getByRole('button', { name: 'Allow' }).click();
    await expect(deck.getByRole('button', { name: 'Revoke' })).toBeVisible();
    expect(await deck.evaluate(hasCapturePermissions)).toBe(true);
    await deck.getByRole('button', { name: 'Revoke' }).click();
    await expect(deck.getByRole('button', { name: 'Allow' })).toBeVisible();
    expect(await deck.evaluate(hasCapturePermissions)).toBe(false);

    // What the service worker leaves when a toast cannot show on the page.
    await deck.evaluate(
      (message) =>
        chrome.storage.local.set({
          'deck:capture-notice': { message, createdAt: Date.now() },
        }),
      NOTICE,
    );
    await deck.goto('chrome://newtab/');
    await deck.waitForSelector(READY_SELECTOR);
    await expect(deck.getByRole('alert')).toHaveText(NOTICE);
    await expect
      .poll(() =>
        deck.evaluate(async () =>
          Object.keys(await chrome.storage.local.get('deck:capture-notice')),
        ),
      )
      .toEqual([]);

    // Quick Save's "open Deck" link lands in the drawer on that page.
    // Opened exactly as the service worker opens it: a fresh tab on the
    // extension's own new-tab URL with the hash.
    const linkUrl = await deck.evaluate(() =>
      chrome.runtime.getURL('src/newtab/index.html#page=inbox'),
    );
    const linked = await context.newPage();
    await linked.goto(linkUrl);
    await linked.waitForSelector(READY_SELECTOR);
    // Used once: a reload of this tab must start calm.
    await expect.poll(() => linked.url()).not.toContain('#page=');
    await expect(
      linked.locator('[data-deck="drawer"][data-open]'),
    ).toBeVisible();
    await expect(
      linked.locator('[data-deck="page"][data-system][data-selected]'),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

const NOTICE = 'Deck can’t save this page. Only web pages can be saved.';

function hasCapturePermissions(): Promise<boolean> {
  return chrome.permissions.contains({
    permissions: ['activeTab', 'scripting'],
  });
}
