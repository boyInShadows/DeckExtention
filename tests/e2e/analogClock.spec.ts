import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { launchExtension } from './extension';

const READY = 'html[data-deck-ready="true"]';
const DIAL = '[data-deck="analog-clock"]';
const OPTION = 'Analog clock';
const START = new Date(2026, 10, 20, 15, 30, 30);

test('failed analog preference writes keep digital time and allow a visible retry', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await settings(page);
    await page.evaluate(() => {
      (window as Window & { deckFailSettings: boolean }).deckFailSettings =
        true;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (
          this.name === 'meta' &&
          (value as { key?: string }).key === 'settings' &&
          (window as Window & { deckFailSettings: boolean }).deckFailSettings
        )
          throw new Error('Fixture analog write failed');
        return put.call(this, value, key);
      };
    });
    const toggle = page.getByRole('checkbox', { name: OPTION, exact: true });
    await toggle.check();
    const error = page
      .locator('[data-deck="toast"][role="alert"]')
      .filter({ hasText: 'Fixture analog write failed' });
    await expect(error).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await expect(page.locator(DIAL)).toHaveCount(0);
    await error.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await page.evaluate(() => {
      (window as Window & { deckFailSettings: boolean }).deckFailSettings =
        false;
    });
    await toggle.check();
    await expect(page.locator(DIAL)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForSelector(READY);
    await expect(page.locator(DIAL)).toBeVisible();
  } finally {
    await context.close();
  }
});

async function settings(page: Page) {
  await page.locator('[data-deck="line"] input').fill('>settings');
  await page.locator('[data-deck="line"] input').press('Enter');
  await expect(page.locator('[data-deck="settings"]')).toBeVisible();
}

async function geometry(page: Page) {
  return page.evaluate(() =>
    ['clock', 'date', 'line', 'pins'].map((name) => {
      const element = document.querySelector(`[data-deck="${name}"]`);
      if (!element) throw new Error(`Missing ${name}`);
      const { x, y, width, height } = element.getBoundingClientRect();
      return { name, x, y, width, height };
    }),
  );
}

test('analog is off and unloaded by default; opt-in preserves geometry and survives reload and actual JSON import', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/\/assets\/AnalogClock-.+\.js/.test(request.url()))
        requests.push(request.url());
    });
    await page.clock.setFixedTime(START);
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await page.evaluate(() => document.fonts.ready);
    const before = await geometry(page);
    const time = await page.locator('[data-deck="clock"]').innerText();
    await expect(page.locator(DIAL)).toHaveCount(0);
    await settings(page);
    const toggle = page.getByRole('checkbox', { name: OPTION, exact: true });
    await expect(toggle).not.toBeChecked();
    expect(requests).toEqual([]);
    await toggle.check();
    await page.keyboard.press('Escape');
    await expect(page.locator(DIAL)).toBeVisible();
    expect(requests).toHaveLength(1);
    await expect(page.locator(DIAL)).toHaveAttribute('aria-label', time.trim());
    expect(await geometry(page)).toEqual(before);
    await page.reload();
    await page.waitForSelector(READY);
    await expect(page.locator(DIAL)).toBeVisible();
    await settings(page);
    await expect(toggle).toBeChecked();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export data', exact: true }).click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('Missing analog export');
    const json = await readFile(path, 'utf8');
    expect(JSON.parse(json).settings.showAnalogClock).toBe(true);
    await toggle.uncheck();
    await expect(page.locator(DIAL)).toHaveCount(0);
    await page.getByLabel('Import data', { exact: true }).setInputFiles({
      name: 'analog.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    const preview = page.locator('[data-deck="data-import-preview"]');
    await preview.getByRole('button', { name: 'Replace', exact: true }).click();
    await preview.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('[data-deck="settings"]')).toHaveCount(0);
    await expect(page.locator(DIAL)).toBeVisible();
    await settings(page);
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(page.locator(DIAL)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForSelector(READY);
    await expect(page.locator(DIAL)).toHaveCount(0);
    await expect(page.locator('[data-deck="clock"]')).toHaveText(time.trim());
    expect(await geometry(page)).toEqual(before);
  } finally {
    await context.close();
  }
});

test('analog uses the existing clock ticks, seconds preference and readable 12-hour text', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.clock.install({ time: new Date(2026, 10, 20, 11, 59, 58) });
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await settings(page);
    await page.getByRole('checkbox', { name: OPTION, exact: true }).check();
    await page
      .getByRole('checkbox', { name: 'Show seconds', exact: true })
      .check();
    await page
      .getByRole('checkbox', { name: '12-hour clock', exact: true })
      .check();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-deck="analog-second"]')).toBeVisible();
    await page.clock.fastForward(4_000);
    const current = await page.evaluate(() =>
      new Date().toLocaleTimeString(undefined, {
        timeStyle: 'medium',
        hour12: true,
      }),
    );
    await expect(page.locator(DIAL)).toHaveAttribute('aria-label', current);
    const actual = await page.evaluate(() => {
      const now = new Date();
      const hours = now.getHours() % 12;
      const minutes = now.getMinutes();
      const seconds = now.getSeconds();
      return {
        hour: hours * 30 + minutes / 2 + seconds / 120,
        minute: minutes * 6 + seconds / 10,
        second: seconds * 6,
      };
    });
    for (const [hand, angle] of Object.entries(actual)) {
      const transform = await page
        .locator(`[data-deck="analog-${hand}"]`)
        .getAttribute('transform');
      expect(Number(transform?.slice(7).split(' ')[0])).toBeCloseTo(angle, 5);
    }
    await settings(page);
    await page
      .getByRole('checkbox', { name: 'Show seconds', exact: true })
      .uncheck();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-deck="analog-second"]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

for (const theme of ['Day', 'Night']) {
  test(`analog fits the existing clock and stays accessible in ${theme}, narrow/short and native zoom`, async ({
    browserName,
  }, testInfo) => {
    expect(browserName).toBe('chromium');
    test.setTimeout(60_000);
    const context = await launchExtension();
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.clock.setFixedTime(START);
      await page.goto('chrome://newtab/');
      await page.waitForSelector(READY);
      const url = await page.evaluate(() =>
        chrome.runtime.getURL('src/newtab/index.html'),
      );
      await page.goto(`${url}?analog-clock-layout`);
      await page.waitForSelector(READY);
      await settings(page);
      await page.getByRole('button', { name: theme, exact: true }).click();
      await page.keyboard.press('Escape');
      for (const [name, width, height] of [
        ['desktop', 1440, 900],
        ['tablet', 768, 900],
        ['narrow', 320, 600],
        ['short', 640, 360],
        ['zoom', 1280, 1200],
      ] as const) {
        await page.setViewportSize({ width, height });
        if (name === 'zoom') {
          const ratio = await page.evaluate(() => devicePixelRatio);
          await page.evaluate(async () => {
            const tab = await chrome.tabs.getCurrent();
            if (tab?.id === undefined)
              throw new Error('Missing analog test tab');
            await chrome.tabs.setZoom(tab.id, 2);
          });
          await expect
            .poll(() => page.evaluate(() => devicePixelRatio))
            .toBe(ratio * 2);
        }
        await settings(page);
        const toggle = page.getByRole('checkbox', {
          name: OPTION,
          exact: true,
        });
        await toggle.focus();
        await page.keyboard.press('Space');
        await expect(toggle).toBeChecked();
        await page.keyboard.press('Escape');
        await expect(page.locator(DIAL)).toHaveCount(1);
        const analogBounds = await geometry(page);
        const dial = page.locator(DIAL);
        if (name === 'short') await expect(dial).toBeHidden();
        else await expect(dial).toBeInViewport();
        await expect(dial).toHaveCSS('animation-name', 'none');
        expect(
          await dial.evaluate(
            (element) => element.getAnimations({ subtree: true }).length,
          ),
        ).toBe(0);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await expect(dial).toHaveCSS('transition-duration', '0s');
        await expect(dial).toHaveCSS('animation-name', 'none');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <= innerWidth &&
              document.documentElement.scrollHeight <= innerHeight,
          ),
        ).toBe(true);
        if (name !== 'short') {
          expect(
            (
              await new AxeBuilder({ page })
                .include('[data-deck="clock"]')
                .analyze()
            ).violations,
          ).toEqual([]);
        }
        await expect(
          page.locator('[data-deck="toast"][data-kind="success"]'),
        ).toHaveCount(0);
        await page.screenshot({
          path: testInfo.outputPath(`analog-${theme}-${name}.png`),
          animations: 'disabled',
        });
        await page.getByLabel('Open Deck drawer', { exact: true }).click();
        if (name === 'short') await expect(dial).toBeHidden();
        else await expect(dial).toBeInViewport();
        await expect(page.locator('[data-deck="clock"]')).toHaveCSS(
          'position',
          'fixed',
        );
        await page.getByLabel('Close Deck drawer', { exact: true }).click();
        await expect(page.locator('[data-deck="drawer"]')).toHaveCount(0);
        await settings(page);
        await toggle.uncheck();
        await page.keyboard.press('Escape');
        await expect(dial).toHaveCount(0);
        expect(await geometry(page)).toEqual(analogBounds);
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
