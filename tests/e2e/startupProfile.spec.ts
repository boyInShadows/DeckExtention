import {
  expect,
  test,
  type CDPSession,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { writeFile } from 'node:fs/promises';

import { launchExtension } from './extension';
import {
  observeDatabaseOpen,
  observeDatabaseTransactions,
  observeSurfaceRender,
} from './startupProbe';

const READY = 'html[data-deck-ready="true"]';
const WARM_SAMPLES = 20;
const TRACED_SAMPLES = 3;
const DIAGNOSTIC_TIMEOUT_MS = 90_000;
const PAINT_TIMEOUT_MS = 2_000;

async function prepareWarmStore(page: Page) {
  await page.locator('[data-deck="pin-add"]').click();
  await page.getByLabel('Paste a URL').fill('https://example.com/');
  await page.getByLabel('Paste a URL').press('Enter');
  await expect(page.locator('[data-deck="pin"]')).toHaveCount(1);
  await page.reload();
  await page.waitForSelector(READY);
  const downloading = page.waitForEvent('download');
  await page.getByLabel('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Export data', exact: true }).click();
  await downloading;
}

async function startupSample(page: Page, isTraced: boolean) {
  return page.evaluate((traced) => {
    const profile = window.__deckStartupProfile;
    if (!profile) throw new Error('Startup instrumentation missing');
    if (profile.renderMs === null)
      throw new Error('First surface commit missing');
    const mark = (name: string) => {
      const entry = performance.getEntriesByName(name)[0];
      if (!entry) throw new Error(`Missing ${name}`);
      return entry.startTime;
    };
    return {
      instrumented: true,
      isTraced: traced,
      isAcceptanceSample: false,
      mainMs: mark('deck-start'),
      readyMs: mark('deck-ready'),
      renderMs: profile.renderMs,
      spans: profile.spans,
      paints: performance
        .getEntriesByType('paint')
        .map((entry) => entry.toJSON()),
    };
  }, isTraced);
}

async function finishTrace(session: CDPSession, path: string) {
  const complete = new Promise<{ stream?: string; dataLossOccurred: boolean }>(
    (resolve) => session.once('Tracing.tracingComplete', resolve),
  );
  await session.send('Tracing.end');
  const { stream, dataLossOccurred } = await complete;
  if (!stream) throw new Error('Startup trace stream missing');
  const chunks: Buffer[] = [];
  try {
    if (dataLossOccurred) throw new Error('Startup trace lost events');
    for (;;) {
      const chunk = await session.send('IO.read', { handle: stream });
      chunks.push(
        Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8'),
      );
      if (chunk.eof) break;
    }
  } finally {
    await session.send('IO.close', { handle: stream });
  }
  await writeFile(path, Buffer.concat(chunks));
}

async function recordSamples(
  page: Page,
  session: CDPSession,
  testInfo: TestInfo,
) {
  const samples = [];
  for (let index = 0; index < WARM_SAMPLES + TRACED_SAMPLES; index += 1) {
    const isTraced = index >= WARM_SAMPLES;
    if (isTraced)
      await session.send('Tracing.start', {
        categories:
          'devtools.timeline,blink.user_timing,v8,disabled-by-default-devtools.timeline',
        transferMode: 'ReturnAsStream',
      });
    await page.reload();
    await page.waitForSelector(READY);
    await page.waitForFunction(
      () => performance.getEntriesByName('first-contentful-paint').length > 0,
      undefined,
      { timeout: PAINT_TIMEOUT_MS },
    );
    samples.push(await startupSample(page, isTraced));
    if (isTraced)
      await finishTrace(
        session,
        testInfo.outputPath(`startup-${index}.trace.json`),
      );
  }
  return samples;
}

function assertSamples(samples: Awaited<ReturnType<typeof recordSamples>>) {
  expect(samples).toHaveLength(WARM_SAMPLES + TRACED_SAMPLES);
  for (const sample of samples) {
    const opened = sample.spans.find((span) => span.kind === 'database-open');
    if (!opened) throw new Error('Database opening was not observed');
    expect(opened.startMs).toBeGreaterThanOrEqual(sample.mainMs);
    expect(opened.endMs).toBeLessThanOrEqual(sample.renderMs);
    expect(sample.renderMs).toBeGreaterThanOrEqual(sample.mainMs);
    expect(sample.readyMs).toBeGreaterThanOrEqual(sample.renderMs);
    for (const store of ['pages', 'decks', 'cards', 'meta'])
      expect(
        sample.spans.some(
          (span) =>
            span.kind === 'transaction:readonly' &&
            span.stores.includes(store) &&
            span.startMs < sample.renderMs,
        ),
      ).toBe(true);
    expect(
      sample.spans.every(
        (span) => !span.isFailure && span.endMs >= span.startMs,
      ),
    ).toBe(true);
  }
}

test('startup diagnostics: database, render and frame stages (instrumented, not latency acceptance)', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(DIAGNOSTIC_TIMEOUT_MS);
  const context = await launchExtension();
  try {
    await context.addInitScript(observeDatabaseOpen);
    await context.addInitScript(observeDatabaseTransactions);
    await context.addInitScript(observeSurfaceRender);
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    await prepareWarmStore(page);
    const session = await context.newCDPSession(page);
    const samples = await recordSamples(page, session, testInfo);
    await testInfo.attach('startup-profile.json', {
      body: JSON.stringify({
        instrumented: true,
        isAcceptanceReport: false,
        isCoverageInstrumented: process.env.DECK_COVERAGE === '1',
        fixture:
          'one persisted pin and completed export, matching phase1 warm setup',
        samples,
      }),
      contentType: 'application/json',
    });
    assertSamples(samples);
  } finally {
    await context.close();
  }
});

test('startup observer preserves native transaction aborts and reports them', async () => {
  const context = await launchExtension();
  try {
    await context.addInitScript(observeDatabaseTransactions);
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await page.waitForSelector(READY);
    const outcome = await page.evaluate(async () => {
      const request = indexedDB.open('deck');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const tx = database.transaction('cards');
        const aborted = new Promise<boolean>((resolve) => {
          tx.onabort = () => resolve(true);
        });
        tx.abort();
        return {
          didAbort: await aborted,
          span: window.__deckStartupProfile?.spans.find(
            (span) => span.isFailure,
          ),
        };
      } finally {
        database.close();
      }
    });
    expect(outcome.didAbort).toBe(true);
    expect(outcome.span).toMatchObject({
      kind: 'transaction:readonly',
      stores: ['cards'],
      isFailure: true,
    });
  } finally {
    await context.close();
  }
});
