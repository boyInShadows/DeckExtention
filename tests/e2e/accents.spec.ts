import { readFile, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { launchExtension } from './extension';

const READY = 'html[data-deck-ready="true"]';
const COLORS = ['warm', 'slate', 'blue', 'green', 'amber', 'rose'];
const NAMES = ['Warm (default)', 'Slate', 'Blue', 'Green', 'Amber', 'Rose'];
const GROUP = '[data-deck="accent-swatches"]';

async function choose(page: Page, index: number) {
  await page
    .locator(GROUP)
    .getByRole('button', { name: NAMES[index], exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute(
    'data-accent',
    COLORS[index],
  );
}

async function whiteWallpaper(page: Page) {
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const paint = canvas.getContext('2d');
    if (!paint) throw new Error('Missing fixture canvas');
    paint.fillStyle = 'white';
    paint.fillRect(0, 0, 64, 64);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Local', { exact: true }).setInputFiles({
    name: 'bright.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await expect(page.locator('[data-deck="wallpaper"]')).toHaveAttribute(
    'data-loaded',
    'true',
  );
}

async function contrast(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const paint = canvas.getContext('2d', { willReadFrequently: true });
    if (!paint) throw new Error('Missing color reader');
    const rgba = (color: string) => {
      if (!CSS.supports('color', color))
        throw new Error(`Invalid color: ${color}`);
      paint.clearRect(0, 0, 1, 1);
      paint.fillStyle = color;
      paint.fillRect(0, 0, 1, 1);
      return [...paint.getImageData(0, 0, 1, 1).data];
    };
    const luminance = (rgb: number[]) =>
      rgb.slice(0, 3).reduce((sum, value, i) => {
        const c = value / 255;
        return (
          sum +
          (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][i]
        );
      }, 0);
    const ratio = (a: number[], b: number[]) => {
      const l = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (l[0] + 0.05) / (l[1] + 0.05);
    };
    const style = (selector: string, pseudo?: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      return getComputedStyle(element, pseudo);
    };
    const selected = style('[data-deck="accent-swatch"][aria-pressed="true"]');
    const panel = rgba(style('[data-deck="settings"]').backgroundColor);
    const outline = rgba(selected.outlineColor);
    const focus = [0, 255].map((background) =>
      ratio(
        outline,
        panel
          .slice(0, 3)
          .map((c) => (c * panel[3]) / 255 + background * (1 - panel[3] / 255)),
      ),
    );
    const selection = [
      '[data-deck="clock"]',
      '[data-deck="settings"] input',
    ].map((selector) => {
      const css = style(selector, '::selection');
      return ratio(rgba(css.color), rgba(css.backgroundColor));
    });
    const surface = style('[data-deck="surface"]');
    const scrim = Number(surface.getPropertyValue('--deck-auto-scrim'));
    const surfaceFocus = ratio(
      rgba(surface.getPropertyValue('--deck-color-focus')),
      [255, 255, 255].map((value) => value * (1 - scrim)),
    );
    const root = getComputedStyle(document.documentElement);
    const tint = rgba(root.getPropertyValue('--deck-color-selection'));
    const raised = rgba(root.getPropertyValue('--deck-color-canvas-raised'));
    const tintedText = ratio(
      rgba(root.getPropertyValue('--deck-color-text')),
      raised
        .slice(0, 3)
        .map(
          (value, i) => (tint[i] * tint[3]) / 255 + value * (1 - tint[3] / 255),
        ),
    );
    return {
      focus,
      selection,
      surfaceFocus,
      tintedText,
      check: ratio(rgba(selected.color), rgba(selected.backgroundColor)),
      color: selected.outlineColor,
    };
  });
}

for (const [theme, scheme] of [
  ['Day', 'light'],
  ['Night', 'dark'],
  ['System', 'light'],
  ['System', 'dark'],
] as const) {
  for (const bright of [false, true]) {
    test(`${theme}/${scheme} ${bright ? 'white wallpaper' : 'canvas'}: six accents meet focus/selection contrast`, async ({
      browserName,
    }, testInfo) => {
      expect(browserName).toBe('chromium');
      const context = await launchExtension();
      try {
        const page = await context.newPage();
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto('chrome://newtab/#settings');
        await page.waitForSelector(READY);
        await page
          .getByRole('group', { name: 'Theme', exact: true })
          .getByRole('button', { name: theme, exact: true })
          .click();
        if (bright) await whiteWallpaper(page);
        const measured = [];
        for (let i = 0; i < COLORS.length; i++) {
          await choose(page, i);
          const selected = page.locator(`${GROUP} [aria-pressed="true"]`);
          await page.keyboard.press('Tab');
          await page.keyboard.press('Shift+Tab');
          await expect(selected).toBeFocused();
          const result = await contrast(page);
          if (i === 0)
            expect(result.color).toBe(
              theme === 'Day' || (theme === 'System' && scheme === 'light')
                ? 'rgb(152, 83, 41)'
                : 'rgb(237, 189, 145)',
            );
          for (const value of result.focus)
            expect(value).toBeGreaterThanOrEqual(3);
          for (const value of result.selection)
            expect(value).toBeGreaterThanOrEqual(4.5);
          if (bright) expect(result.surfaceFocus).toBeGreaterThanOrEqual(3);
          expect(result.tintedText).toBeGreaterThanOrEqual(4.5);
          expect(result.check).toBeGreaterThanOrEqual(3);
          measured.push({ color: COLORS[i], ...result });
        }
        expect(new Set(measured.map((row) => row.color)).size).toBe(6);
        expect(
          (await new AxeBuilder({ page }).include(GROUP).analyze()).violations,
        ).toEqual([]);
        await testInfo.attach('contrast.json', {
          body: JSON.stringify(measured),
          contentType: 'application/json',
        });
        await writeFile(
          testInfo.outputPath('contrast.json'),
          JSON.stringify(measured),
        );
      } finally {
        await context.close();
      }
    });
  }
}

test('all six choices survive reload and Warm restores the original tokens', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/#settings');
    await page.waitForSelector(READY);
    await expect(
      page.locator(`${GROUP} [aria-pressed="true"]`),
    ).toHaveAttribute('aria-label', NAMES[0]);
    const original = (await contrast(page)).color;
    for (let i = 0; i < COLORS.length; i++) {
      await choose(page, i);
      await page.reload();
      await page.waitForSelector(READY);
      await expect(page.locator('html')).toHaveAttribute(
        'data-accent',
        COLORS[i],
      );
      await page.locator('[data-deck="settings-toggle"]').click();
      await expect(
        page.locator(`${GROUP} [aria-pressed="true"]`),
      ).toHaveAttribute('aria-label', NAMES[i]);
    }
    await choose(page, 0);
    expect((await contrast(page)).color).toBe(original);
  } finally {
    await context.close();
  }
});

test('actual JSON export and replacement import restores the accent', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/#settings');
    await page.waitForSelector(READY);
    await choose(page, 2);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export data', exact: true }).click(),
    ]);
    const path = await download.path();
    if (!path) throw new Error('Missing export');
    const json = await readFile(path, 'utf8');
    expect(JSON.parse(json).settings.accentColor).toBe('blue');
    await choose(page, 4);
    await page.getByLabel('Import data', { exact: true }).setInputFiles({
      name: 'accent.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    const preview = page.locator('[data-deck="data-import-preview"]');
    await preview.getByRole('button', { name: 'Replace', exact: true }).click();
    await preview.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue');
  } finally {
    await context.close();
  }
});

for (const zoom of [false, true]) {
  test(`accent swatches support keyboard and bounds at ${zoom ? 'actual 200 percent zoom' : '320px'}`, async ({
    browserName,
  }, testInfo) => {
    expect(browserName).toBe('chromium');
    const context = await launchExtension();
    try {
      const page = await context.newPage();
      await page.goto('chrome://newtab/');
      await page.waitForSelector(READY);
      if (zoom) {
        const url = await page.evaluate(() =>
          chrome.runtime.getURL('src/newtab/index.html'),
        );
        await page.goto(`${url}?accent-zoom`);
        await page.waitForSelector(READY);
        await page.setViewportSize({ width: 1280, height: 1200 });
        const ratio = await page.evaluate(() => devicePixelRatio);
        await page.evaluate(async () => {
          const tab = await chrome.tabs.getCurrent();
          if (tab?.id === undefined) throw new Error('Missing tab');
          await chrome.tabs.setZoom(tab.id, 2);
        });
        await expect
          .poll(() => page.evaluate(() => devicePixelRatio))
          .toBe(ratio * 2);
      } else await page.setViewportSize({ width: 320, height: 720 });
      const line = page.locator('[data-deck="line"] input');
      await line.fill('>settings');
      await line.press('Enter');
      await page
        .locator(GROUP)
        .getByRole('button', { name: NAMES[0], exact: true })
        .focus();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Space');
        await expect(page.locator('html')).toHaveAttribute(
          'data-accent',
          COLORS[i],
        );
        const selected = page.locator(`${GROUP} [aria-pressed="true"]`);
        await expect(selected).toBeFocused();
        const b = await selected.boundingBox();
        const p = await page.locator('[data-deck="settings"]').boundingBox();
        if (!b || !p) throw new Error('Missing bounds');
        expect(b.x).toBeGreaterThanOrEqual(p.x);
        expect(b.x + b.width).toBeLessThanOrEqual(p.x + p.width);
        expect(b.y).toBeGreaterThanOrEqual(p.y);
        expect(b.y + b.height).toBeLessThanOrEqual(p.y + p.height);
        if (i < 5) await page.keyboard.press('Tab');
      }
      await expect(page.locator('[data-deck="toast"]')).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath('swatches.png'),
        animations: 'disabled',
      });
    } finally {
      await context.close();
    }
  });
}

test('a failed accent write leaves the old choice and reports an error, then retry succeeds', async () => {
  const context = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto('chrome://newtab/#settings');
    await page.waitForSelector(READY);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        ...args: Parameters<IDBObjectStore['put']>
      ) {
        if (this.name === 'meta' && args[0]?.key === 'settings') {
          IDBObjectStore.prototype.put = put;
          throw new Error('Accent write failed');
        }
        return put.apply(this, args);
      };
    });
    await page
      .locator(GROUP)
      .getByRole('button', { name: 'Blue', exact: true })
      .click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Accent write failed' }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'warm');
    await expect(
      page.locator(`${GROUP} [aria-pressed="true"]`),
    ).toHaveAttribute('aria-label', NAMES[0]);
    await choose(page, 2);
  } finally {
    await context.close();
  }
});
