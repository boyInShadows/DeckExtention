import { expect, type Page } from '@playwright/test';
import { SETTINGS_DEFAULTS } from '../../packages/schema/src/constants';

const BASE = { createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null };
const PAGES = [
  { ...BASE, id: 'rtl_page_a', title: 'کارهای من · Work', order: 'a0' },
  { ...BASE, id: 'rtl_page_b', title: 'صفحهٔ دوم · Second', order: 'a1' },
];
const DECK_BASE = {
  ...BASE,
  pageId: 'rtl_page_a',
  kind: 'normal',
  color: null,
  isCollapsed: false,
};
const DECKS = [
  { ...DECK_BASE, id: 'rtl_deck_a', title: 'دستهٔ نخست · First', order: 'a0' },
  { ...DECK_BASE, id: 'rtl_deck_b', title: 'دستهٔ دوم · Second', order: 'a1' },
  {
    ...DECK_BASE,
    id: 'deck_inbox',
    title: 'ورودی',
    kind: 'inbox',
    order: 'a2',
  },
];
const CARD_BASE = {
  ...BASE,
  deckId: 'rtl_deck_a',
  pinned: false,
  lastOpenedAt: null,
};
const CARDS = [
  {
    ...CARD_BASE,
    id: 'rtl_link',
    order: 'a0',
    title: 'پیوند بلند فارسی و English برای بررسی خوانایی',
    url: 'https://mixed.example/docs?q=سلام',
    hostname: 'mixed.example',
    note: 'متن فارسی و **Mixed English**',
  },
  {
    ...CARD_BASE,
    id: 'rtl_task',
    order: 'a1',
    kind: 'task',
    title: 'یک کار فارسی با عنوان بلند و Mixed English',
    hostname: '',
    done: false,
  },
  {
    ...CARD_BASE,
    id: 'rtl_second',
    deckId: 'rtl_deck_b',
    order: 'a0',
    title: 'پیوند دوم',
    url: 'https://second.example/',
    hostname: 'second.example',
  },
  {
    ...CARD_BASE,
    id: 'rtl_inbox',
    deckId: 'deck_inbox',
    order: 'a0',
    title: 'ورودی Mixed',
    url: 'https://inbox.example/',
    hostname: 'inbox.example',
  },
  {
    ...CARD_BASE,
    id: 'rtl_trash',
    order: 'a2',
    title: 'حذف‌شده · Deleted',
    url: 'https://trash.example/',
    hostname: 'trash.example',
    deletedAt: Date.now(),
  },
  ...Array.from({ length: 6 }, (_, index) => ({
    ...CARD_BASE,
    id: `rtl_pin_${index}`,
    order: `a${index + 3}`,
    title: `سنجاق · Pin ${index}`,
    pinned: true,
    url: `https://pin${index}.example/`,
    hostname: `pin${index}.example`,
  })),
];
const settingsFor = (theme: string) => ({
  ...SETTINGS_DEFAULTS,
  language: 'fa',
  theme,
  fontSize: 'extra-large',
  rowDensity: 'comfortable',
  showGoogleSuggestions: false,
  showResurface: false,
  showShelf: true,
  shelfDeckIds: ['rtl_deck_b'],
});

export async function seedRtlWorkspace(page: Page, theme = 'night') {
  await page.evaluate(
    async ({ records, settings }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('deck');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const tx = database.transaction(
          ['pages', 'decks', 'cards', 'meta'],
          'readwrite',
        );
        for (const [store, items] of Object.entries(records)) {
          tx.objectStore(store).clear();
          for (const item of items) tx.objectStore(store).put(item);
        }
        tx.objectStore('meta').put({ key: 'settings', value: settings });
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        database.close();
      }
    },
    {
      records: { pages: PAGES, decks: DECKS, cards: CARDS },
      settings: settingsFor(theme),
    },
  );
  await page.reload();
  await expect(
    page.locator('html[data-deck-ready="true"][lang="fa"][dir="rtl"]'),
  ).toHaveCount(1);
}

export async function settledRtlDrawer(page: Page) {
  const drawer = page.locator('[data-deck="drawer"][data-open]');
  await expect(drawer).toBeVisible();
  await expect
    .poll(() =>
      drawer.evaluate((node) =>
        node
          .getAnimations()
          .some((animation) => animation.playState === 'running'),
      ),
    )
    .toBe(false);
}
