import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Locator } from '@playwright/test';
import { launchExtension } from './extension';
import { seedRtlWorkspace, settledRtlDrawer } from './persianFixture';
import { panelStrings as fa } from '../../apps/extension/src/i18n/fa/panelStrings';

const READY = 'html[data-deck-ready="true"]';
const DECK = '[data-deck-id="rtl_deck_a"]';

async function assertA11y(page: Page, selector?: string) {
  const scan = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
  ]);
  const { violations } = await (
    selector ? scan.include(selector) : scan
  ).analyze();
  expect(
    violations.filter(
      ({ impact, id }) =>
        impact === 'serious' ||
        impact === 'critical' ||
        id === 'label-content-name-mismatch',
    ),
  ).toEqual([]);
}

async function controlsFit(page: Page, targets: Locator, container: Locator) {
  expect(await targets.count()).toBeGreaterThan(0);
  for (const target of await targets.all()) {
    if (!(await target.isVisible())) continue;
    await target.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(target).toBeFocused();
    await target.evaluate((node) =>
      node.scrollIntoView({ block: 'center', inline: 'nearest' }),
    );
    const [b, c] = await Promise.all([
      target.boundingBox(),
      container.boundingBox(),
    ]);
    if (!b || !c) throw new Error('Missing control bounds');
    expect(b.width).toBeGreaterThanOrEqual(24);
    expect(b.height).toBeGreaterThanOrEqual(24);
    expect(b.x).toBeGreaterThanOrEqual(c.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width + 1);
    expect(b.y).toBeGreaterThanOrEqual(c.y - 1);
    expect(b.y + b.height).toBeLessThanOrEqual(c.y + c.height + 1);
  }
}

async function noDocumentScroll(page: Page) {
  expect(
    await page.evaluate(() => ({
      width: document.documentElement.scrollWidth <= innerWidth,
      height: document.documentElement.scrollHeight <= innerHeight,
    })),
  ).toEqual({ width: true, height: true });
}

async function configureViewport(page: Page, layout: string) {
  if (layout !== 'zoom') {
    await page.setViewportSize({
      width:
        { desktop: 1440, laptop: 1024, tablet: 768, narrow: 320, short: 640 }[
          layout
        ] ?? 1440,
      height: layout === 'short' ? 360 : 900,
    });
    return;
  }
  const url = await page.evaluate(() =>
    chrome.runtime.getURL('src/newtab/index.html'),
  );
  await page.goto(`${url}?persian-zoom`);
  await page.waitForSelector(READY);
  await page.setViewportSize({ width: 1280, height: 1200 });
  const ratio = await page.evaluate(() => devicePixelRatio);
  await page.evaluate(async () => {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id === undefined) throw new Error('Missing zoom fixture tab');
    await chrome.tabs.setZoom(tab.id, 2);
  });
  await expect
    .poll(() => page.evaluate(() => devicePixelRatio))
    .toBe(ratio * 2);
}

async function verifySettings(page: Page) {
  await page.locator('[data-deck="settings-toggle"]').click();
  const settings = page.locator('[data-deck="settings"]');
  await expect(page.locator('[data-deck="language-select"]')).toHaveValue('fa');
  await controlsFit(page, settings.locator('select'), settings);
  await assertA11y(page, '[data-deck="settings"]');
  await expect(page.locator('[data-deck="language-select"]')).toHaveValue('fa');
  await page.screenshot({
    path: test.info().outputPath('settings-fa.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
}

async function verifySurface(page: Page) {
  await noDocumentScroll(page);
  await controlsFit(
    page,
    page.locator(
      '[data-deck="settings-toggle"], [data-deck="line"] input, [data-deck="pin"], [data-deck="section-nav"] button',
    ),
    page.locator('[data-deck="surface"]'),
  );
  const center = await page
    .locator('[data-deck="drawer-handle"]')
    .evaluate((node) => {
      const b = node.getBoundingClientRect();
      return Math.abs(b.x + b.width / 2 - innerWidth / 2);
    });
  expect(center).toBeLessThan(2);
  await assertA11y(page);
  await page.screenshot({
    path: test.info().outputPath('surface-fa.png'),
    animations: 'disabled',
  });
}

async function verifyDrawer(page: Page) {
  await page.keyboard.press('Control+J');
  await settledRtlDrawer(page);
  await expect(
    page.getByRole('button', { name: `${fa.inbox} ۱`, exact: true }),
  ).toBeVisible();
  await controlsFit(
    page,
    page.locator(
      `${DECK} [data-deck="card-edit"], ${DECK} [data-deck="card-done"], ${DECK} [data-deck="add-card"]`,
    ),
    page.locator('[data-deck="drawer"]'),
  );
  const rail = await page.locator('[data-deck="pages"]').boundingBox();
  const main = await page.locator('[data-deck="decks"]').boundingBox();
  expect(rail && main && rail.x > main.x).toBe(true);
  await assertA11y(page, '[data-deck="drawer"]');
  await page.screenshot({
    path: test.info().outputPath('drawer-fa.png'),
    animations: 'disabled',
  });
  await page.locator('[data-deck="drawer-close"]').click();
}

for (const [theme, layout] of [
  ['night', 'desktop'],
  ['day', 'desktop'],
  ['night', 'tablet'],
  ['day', 'laptop'],
  ['day', 'narrow'],
  ['night', 'narrow'],
  ['night', 'short'],
  ['day', 'zoom'],
  ['system', 'desktop'],
  ['system-dark', 'desktop'],
]) {
  test(`Persian ${theme} controls fit with extra-large text in ${layout}`, async () => {
    const context = await launchExtension();
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      const requests: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        if (/^https?:/.test(request.url())) requests.push(request.url());
      });
      await page.goto('chrome://newtab/');
      await page.waitForSelector(READY);
      await seedRtlWorkspace(
        page,
        theme.startsWith('system') ? 'system' : theme,
      );
      await context.setOffline(true);
      await page.emulateMedia({
        reducedMotion: 'reduce',
        colorScheme: theme === 'system' ? 'light' : 'dark',
      });
      await configureViewport(page, layout);
      await verifySettings(page);
      await verifySurface(page);
      await verifyDrawer(page);
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test('RTL grid arrows move physically left and right while letter bindings keep logical order', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seedRtlWorkspace(page);
    await page.keyboard.press('Control+J');
    await settledRtlDrawer(page);
    const first = page.locator('[data-card-id="rtl_link"]');
    const second = page.locator('[data-card-id="rtl_second"]');
    const [a, b] = await Promise.all([
      first.boundingBox(),
      second.boundingBox(),
    ]);
    expect(a && b && a.x > b.x).toBe(true);
    await first.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(second).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(first).toBeFocused();
    await page.keyboard.press('l');
    await expect(second).toBeFocused();
    await page.keyboard.press('h');
    await expect(first).toBeFocused();
  } finally {
    await context.close();
  }
});

async function keyboardDrop(
  page: Page,
  handle: Locator,
  dragged: Locator,
  key: string,
  target: Locator,
  overId: string,
) {
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(dragged).toHaveAttribute('data-dragging', 'true');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.keyboard.press(key);
  await expect(target).toHaveAttribute('data-drag-over', 'true');
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(overId);
  await page.keyboard.press('Space');
  await expect(dragged).not.toHaveAttribute('data-dragging');
}

async function expectOrder(
  items: Locator,
  attribute: string,
  expected: string[],
) {
  await expect
    .poll(() =>
      items.evaluateAll(
        (nodes, name) => nodes.map((node) => node.getAttribute(name)),
        attribute,
      ),
    )
    .toEqual(expected);
}

async function reorderCards(page: Page) {
  const card = page.locator('[data-card-id="rtl_link"]');
  await keyboardDrop(
    page,
    card.locator('[data-deck="card-drag"]'),
    card,
    'ArrowDown',
    page.locator('[data-card-id="rtl_task"]'),
    'card:rtl_task',
  );
  await expectOrder(
    page.locator(
      DECK +
        ' [data-card-id="rtl_task"], ' +
        DECK +
        ' [data-card-id="rtl_link"]',
    ),
    'data-card-id',
    ['rtl_task', 'rtl_link'],
  );
}

async function reorderDecksAndPages(page: Page) {
  const deck = page.locator(DECK);
  await keyboardDrop(
    page,
    deck.locator('[data-deck="deck-drag"]'),
    deck,
    'ArrowLeft',
    page.locator('[data-deck="deck"][data-deck-id="rtl_deck_b"]'),
    'deck:rtl_deck_b',
  );
  await expectOrder(
    page.locator('[data-deck="decks"] [data-deck="deck"]'),
    'data-deck-id',
    ['rtl_deck_b', 'rtl_deck_a'],
  );
  const pages = page.locator('[data-deck="page"]:not([data-system])');
  await keyboardDrop(
    page,
    pages.first(),
    pages.first(),
    'ArrowDown',
    pages.nth(1),
    'page:rtl_page_b',
  );
  await expectOrder(pages, 'aria-label', [
    'صفحهٔ دوم · Second',
    'کارهای من · Work',
  ]);
}

test('Persian keyboard drag persists card, deck and page order after reload', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seedRtlWorkspace(page);
    await page.keyboard.press('Control+J');
    await settledRtlDrawer(page);
    await reorderCards(page);
    await reorderDecksAndPages(page);
    await page.reload();
    await page.waitForSelector(READY);
    await page.keyboard.press('Control+J');
    await settledRtlDrawer(page);
    await expectOrder(
      page.locator('[data-deck="page"]:not([data-system])'),
      'aria-label',
      ['صفحهٔ دوم · Second', 'کارهای من · Work'],
    );
    await page
      .getByRole('button', { name: 'کارهای من · Work', exact: true })
      .click();
    await expectOrder(
      page.locator('[data-deck="decks"] [data-deck="deck"]'),
      'data-deck-id',
      ['rtl_deck_b', 'rtl_deck_a'],
    );
    await expectOrder(
      page.locator(
        DECK +
          ' [data-card-id="rtl_task"], ' +
          DECK +
          ' [data-card-id="rtl_link"]',
      ),
      'data-card-id',
      ['rtl_task', 'rtl_link'],
    );
  } finally {
    await context.close();
  }
});

async function cancelCenteredDialog(page: Page, selector: string) {
  const dialog = page.locator(selector);
  await expect(dialog).toBeVisible();
  const offset = await dialog.evaluate((node) => {
    const b = node.getBoundingClientRect();
    const parent = node
      .closest('[data-deck="drawer"]')
      ?.getBoundingClientRect();
    if (!parent) throw new Error('Dialog has no drawer containing block');
    return {
      x: Math.abs(b.x + b.width / 2 - parent.x - parent.width / 2),
      y: Math.abs(b.y + b.height / 2 - parent.y - parent.height / 2),
    };
  });
  expect(offset.x).toBeLessThan(2);
  expect(offset.y).toBeLessThan(2);
  await assertA11y(page, selector);
  await dialog.getByRole('button', { name: fa.cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function verifyNote(page: Page) {
  const card = page.locator('[data-card-id="rtl_link"]');
  await card.getByRole('button', { name: fa.editNote, exact: true }).click();
  const text = page.locator('[data-deck="note-text"]');
  await expect(text).toHaveValue('متن فارسی و **Mixed English**');
  await text.fill('متن جدید و **Mixed English**');
  await page.locator('[data-deck="note-save"]').click();
  await expect(page.locator('[data-deck="note-status"]')).toHaveText(fa.saved);
  await assertA11y(page, '[data-deck="note"]');
  await page.locator('[data-deck="note-close"]').click();
  await expect(page.locator('[data-deck="note"]')).toHaveCount(0);
  await expect(card).toBeFocused();
}

test('Persian notes, tasks, inbox, focus, help and centered confirmations stay usable', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await seedRtlWorkspace(page);
    await page.keyboard.press('Control+J');
    await settledRtlDrawer(page);
    await verifyNote(page);
    const custom = page
      .locator('[data-deck="page"]:not([data-system])')
      .first();
    await custom.press('Delete');
    await cancelCenteredDialog(page, '[data-deck="page-delete-sheet"]');
    const nav = page.locator('[data-deck="drawer-sections"]');
    for (const [name, selector] of [
      [fa.tasks, 'task-manager'],
      [`${fa.inbox} ۱`, 'inbox'],
      [fa.focus, 'focus'],
    ]) {
      await nav.getByRole('button', { name, exact: true }).click();
      await expect(page.locator(`[data-deck="${selector}"]`)).toBeVisible();
      await assertA11y(page, `[data-deck="${selector}"]`);
    }
    await nav.getByRole('button', { name: fa.trash, exact: true }).click();
    await page.locator('[data-deck="trash-empty"]').click();
    await cancelCenteredDialog(page, '[data-deck="trash-confirm"]');
    await page.keyboard.press('?');
    await expect(page.locator('[data-deck="help"]')).toContainText(
      fa.quickSave,
    );
    await assertA11y(page, '[data-deck="help"]');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-deck="help"]')).toHaveCount(0);
    await expect(page.locator('[data-deck="drawer"][data-open]')).toBeVisible();
  } finally {
    await context.close();
  }
});
