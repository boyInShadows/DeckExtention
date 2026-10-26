import { expect, test, type Page } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';

import { launchExtension } from './extension';

const READY = 'html[data-deck-ready="true"]';
const WARM_SAMPLES = 20;
const OBSERVATION_DELAY_MS = 250;
const DIAGNOSTIC_TIMEOUT_MS = 90_000;
const PAINT_TIMEOUT_MS = 2_000;
const OBSERVATION_ORDER = ['active', 'delayed', 'delayed', 'active'] as const;
type ObservationMode = (typeof OBSERVATION_ORDER)[number];

async function prepareWarmStore(page: Page) {
  await page.locator('[data-deck="pin-add"]').click();
  const input = page.getByLabel('Paste a URL');
  await input.fill('https://example.com/');
  await input.press('Enter');
  await expect(page.locator('[data-deck="pin"]')).toHaveCount(1);
  await page.reload();
  await page.waitForSelector(READY);
  await expect(page.locator('[data-deck="pin"]')).toHaveCount(1);
  const downloading = page.waitForEvent('download');
  await page.getByLabel('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Export data', exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(
    /^deck-\d{4}-\d{2}-\d{2}\.json$/,
  );
}

async function readObservation(page: Page) {
  const observation = await page.evaluate(() => {
    const readTime = (name: string) => {
      const value = performance.getEntriesByName(name).at(-1)?.startTime;
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error(`Missing startup timing: ${name}`);
      return value;
    };
    const navigation = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    if (!navigation) throw new Error('Navigation timing missing');
    const readyMs = readTime('deck-ready');
    return {
      isReady: document.documentElement.dataset.deckReady === 'true',
      mainMs: readTime('deck-start'),
      readyMs,
      firstPaintMs: readTime('first-paint'),
      firstContentfulPaintMs: readTime('first-contentful-paint'),
      responseEndMs: navigation.responseEnd,
      domInteractiveMs: navigation.domInteractive,
      resources: performance
        .getEntriesByType('resource')
        .filter(
          (entry) => entry.name.endsWith('.js') && entry.startTime < readyMs,
        )
        .map((entry) => ({
          name: new URL(entry.name).pathname,
          startMs: entry.startTime,
          endMs: entry.startTime + entry.duration,
        })),
    };
  });
  expect(observation.isReady).toBe(true);
  expect(observation.readyMs).toBeGreaterThanOrEqual(observation.mainMs);
  expect(observation.firstContentfulPaintMs).toBeGreaterThanOrEqual(
    observation.firstPaintMs,
  );
  return observation;
}

async function recordSamples(page: Page, mode: ObservationMode) {
  const samples = [];
  for (let index = 0; index < WARM_SAMPLES; index += 1) {
    await page.reload();
    const started = performance.now();
    if (mode === 'active') {
      await page.waitForSelector(READY);
      await page.waitForFunction(
        () => performance.getEntriesByName('first-contentful-paint').length > 0,
        undefined,
        { timeout: PAINT_TIMEOUT_MS },
      );
    }
    await delay(
      Math.max(0, OBSERVATION_DELAY_MS - (performance.now() - started)),
    );
    samples.push(await readObservation(page));
  }
  expect(samples).toHaveLength(WARM_SAMPLES);
  return samples;
}

test('startup observation: active versus delayed reads (diagnostic, not latency acceptance)', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(DIAGNOSTIC_TIMEOUT_MS);
  for (const [index, mode] of OBSERVATION_ORDER.entries()) {
    const context = await launchExtension();
    try {
      const page = await context.newPage();
      await page.goto('chrome://newtab/');
      await page.waitForSelector(READY);
      await prepareWarmStore(page);
      const samples = await recordSamples(page, mode);
      await testInfo.attach(`startup-observation-${index}-${mode}.json`, {
        body: JSON.stringify({
          mode,
          isAcceptanceReport: false,
          isTraced: false,
          isCoverageInstrumented: process.env.DECK_COVERAGE === '1',
          observationDelayMs: OBSERVATION_DELAY_MS,
          fixture: 'one persisted pin and completed export',
          samples,
        }),
        contentType: 'application/json',
      });
    } finally {
      await context.close();
    }
  }
});
