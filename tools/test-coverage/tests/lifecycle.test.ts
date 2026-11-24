import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from '@playwright/test';

const mocks = vi.hoisted(() => ({
  annotations: [] as { type: string; description: string }[],
  add: vi.fn(),
}));
vi.mock('@playwright/test', () => ({
  test: { info: () => ({ annotations: mocks.annotations }) },
  expect: vi.fn(),
}));
vi.mock('monocart-coverage-reports', () => ({
  CoverageReport: class {
    add = mocks.add;
  },
}));

function fixture(isClosed: boolean, error?: Error) {
  const page = {
    coverage: {
      startJSCoverage: vi.fn(() =>
        error ? Promise.reject(error) : Promise.resolve(),
      ),
      stopJSCoverage: vi.fn().mockResolvedValue([{ url: 'deck.js' }]),
    },
    isClosed: () => isClosed,
    url: () => 'chrome-extension://deck/transient',
  } as unknown as Page;
  let onPage: (page: Page) => void;
  const context = {
    on: (_event: string, listener: typeof onPage) => {
      onPage = listener;
    },
    newPage: async () => {
      onPage(page);
      return page;
    },
    pages: () => [page],
    close: vi.fn(),
  } as unknown as BrowserContext;
  return { page, context, emitPage: () => onPage(page) };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('DECK_COVERAGE', '1');
  mocks.annotations.length = 0;
  mocks.add.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

it('records an expected attach failure on an already closed page without an unhandled rejection', async () => {
  const f = fixture(
    true,
    new Error(
      'coverage.startJSCoverage: Target page, context or browser has been closed',
    ),
  );
  const { withCoverage } = await import('../../../tests/e2e/coverage');
  const context = withCoverage(f.context);
  f.emitPage();
  await expect(context.close()).resolves.toBeUndefined();
  expect(mocks.annotations).toEqual([
    { type: 'closed V8 capture', description: f.page.url() },
  ]);
  expect(mocks.add).not.toHaveBeenCalled();
});

it.each([false, true])(
  'propagates genuine attach failures even when isClosed=%s',
  async (isClosed) => {
    const error = new Error('V8 capture unavailable');
    const f = fixture(isClosed, error);
    const { withCoverage } = await import('../../../tests/e2e/coverage');
    const context = withCoverage(f.context);
    f.emitPage();
    await expect(context.close()).rejects.toBe(error);
    expect(mocks.annotations).toEqual([]);
    expect(mocks.add).not.toHaveBeenCalled();
  },
);

it('awaits a live page attach and collects its actual entries', async () => {
  const f = fixture(false);
  const { withCoverage } = await import('../../../tests/e2e/coverage');
  const context = withCoverage(f.context);
  await context.newPage();
  await context.close();
  expect(f.page.coverage.stopJSCoverage).toHaveBeenCalledOnce();
  expect(mocks.add).toHaveBeenCalledWith([{ url: 'deck.js' }]);
});
