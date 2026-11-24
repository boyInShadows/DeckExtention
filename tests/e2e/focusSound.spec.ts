import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { launchExtension } from './extension';

const START = new Date(2026, 10, 20, 10).getTime();
const READY = 'html[data-deck-ready="true"]';
type SoundEvent = { kind: string; source: string };
type SoundWindow = Window & { deckSoundEvents: SoundEvent[] };

async function observeSound(
  context: BrowserContext,
  shouldRejectFirst: boolean,
) {
  await context.addInitScript((rejectFirst) => {
    const events: SoundEvent[] = [];
    (window as SoundWindow).deckSoundEvents = events;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      events.push({ kind: 'attempt', source: this.src });
      if (rejectFirst && events.length === 1)
        return Promise.reject(
          new DOMException('Fixture autoplay blocked', 'NotAllowedError'),
        );
      this.addEventListener(
        'ended',
        () => events.push({ kind: 'ended', source: this.src }),
        { once: true },
      );
      return play.call(this).then(() => {
        events.push({ kind: 'playing', source: this.src });
      });
    };
  }, shouldRejectFirst);
}

async function finishFocus(page: Page) {
  await page.clock.setFixedTime(new Date(START));
  await page.goto('chrome://newtab/');
  await page.waitForSelector(READY);
  const url = await page.evaluate(() =>
    chrome.runtime.getURL('src/newtab/index.html'),
  );
  await page.goto(`${url}?focus-sound`);
  await page.waitForSelector(READY);
  await page.getByRole('button', { name: 'Open Focus', exact: true }).click();
  await page.getByLabel('Minutes', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Start focus', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Pause focus', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Close Deck drawer', { exact: true }).click();
  await page.clock.setFixedTime(new Date(START + 60_000));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.locator('[data-deck="toast"][data-source="focus"]'),
  ).toHaveCount(1);
}

async function soundEvents(page: Page, kind: string) {
  return page.evaluate(
    (value) =>
      (window as SoundWindow).deckSoundEvents.filter(
        (event) => event.kind === value,
      ),
    kind,
  );
}

test('completion shows a persistent popup and plays the real local chime once, with replay and responsive controls', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(60_000);
  const context = await launchExtension();
  try {
    await observeSound(context, false);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await finishFocus(page);
    const notice = page.locator('[data-deck="toast"][data-source="focus"]');
    await expect(notice).toContainText('Focus complete.');
    await expect
      .poll(async () => (await soundEvents(page, 'ended')).length)
      .toBe(1);
    expect((await soundEvents(page, 'playing'))[0]?.source).toMatch(
      /^chrome-extension:\/\/[^/]+\/assets\/completion-chime-.+\.wav$/,
    );
    await notice
      .getByRole('button', { name: 'Play sound', exact: true })
      .click();
    await expect
      .poll(async () => (await soundEvents(page, 'ended')).length)
      .toBe(2);
    await expect(notice).toBeVisible();
    for (const [name, width, height] of [
      ['desktop', 1440, 900],
      ['narrow', 320, 600],
      ['short', 640, 360],
      ['zoom', 1280, 1200],
    ] as const) {
      await page.setViewportSize({ width, height });
      if (name === 'zoom') {
        const ratio = await page.evaluate(() => devicePixelRatio);
        await page.evaluate(async () => {
          const tab = await chrome.tabs.getCurrent();
          if (tab?.id === undefined) throw new Error('No test tab');
          await chrome.tabs.setZoom(tab.id, 2);
        });
        await expect
          .poll(() => page.evaluate(() => devicePixelRatio))
          .toBe(ratio * 2);
      }
      await page.evaluate(
        (theme) => {
          document.documentElement.dataset.theme = theme;
        },
        name === 'narrow' || name === 'zoom' ? 'day' : 'night',
      );
      const scan = await new AxeBuilder({ page })
        .include('[data-deck="toast-stack"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      expect(scan.violations).toEqual([]);
      for (const button of await notice.getByRole('button').all()) {
        await button.focus();
        await expect(button).toBeFocused();
        expect(
          await button.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return (
              box.x >= 0 &&
              box.right <= innerWidth &&
              box.y >= 0 &&
              box.bottom <= innerHeight &&
              box.width >= 24 &&
              box.height >= 24
            );
          }),
        ).toBe(true);
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.documentElement.scrollHeight <= innerHeight,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`focus-completion-${name}.png`),
        animations: 'disabled',
      });
      await page.locator('[data-deck="settings-toggle"]').click();
      await expect(page.locator('[data-deck="settings"]')).toBeVisible();
      await page.getByLabel('Close settings', { exact: true }).click();
      await page
        .getByLabel('Open Deck drawer: Deck · Space', { exact: true })
        .click();
      await expect(
        page.locator('[data-deck="drawer"][data-open]'),
      ).toBeVisible();
      await page.getByLabel('Close Deck drawer', { exact: true }).click();
      await expect(notice).toBeVisible();
    }
    const other = await context.newPage();
    await other.goto('chrome://newtab/');
    await other.waitForSelector(READY);
    await expect(
      other.locator('[data-deck="toast"][data-source="focus"]'),
    ).toHaveCount(0);
    expect(await soundEvents(other, 'attempt')).toEqual([]);
    await notice
      .getByRole('button', { name: 'View focus', exact: true })
      .click();
    await expect(page.locator('[data-deck="focus"]')).toBeVisible();
    await expect(page.locator('[data-deck="focus"] progress')).toHaveAttribute(
      'value',
      '1',
    );
    await page.reload();
    await page.waitForSelector(READY);
    await expect(
      page.locator('[data-deck="toast"][data-source="focus"]'),
    ).toHaveCount(0);
    expect(await soundEvents(page, 'attempt')).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a rejected autoplay keeps completion visible and native keyboard replay succeeds', async () => {
  const context = await launchExtension();
  try {
    await observeSound(context, true);
    const page = await context.newPage();
    await finishFocus(page);
    const notice = page.locator('[data-deck="toast"][data-source="focus"]');
    await expect(
      page
        .locator('[data-deck="toast"]')
        .filter({ hasText: "Sound couldn't play automatically." }),
    ).toBeVisible();
    await notice
      .getByRole('button', { name: 'Play sound', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await soundEvents(page, 'ended')).length)
      .toBe(1);
    expect(await soundEvents(page, 'attempt')).toHaveLength(2);
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(notice).toHaveCount(0);
  } finally {
    await context.close();
  }
});
