import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { CoverageReport } from 'monocart-coverage-reports';

import { E2E_REPORT_OPTIONS } from '../../tools/test-coverage/options.mjs';

/**
 * V8 coverage for the E2E run, merged with Vitest's by `pnpm test:coverage`
 * (tools/test-coverage/run.mjs). Off unless DECK_COVERAGE=1, so a normal E2E run
 * pays nothing for it.
 */
const IS_COVERAGE_RUN = process.env.DECK_COVERAGE === '1';

const report = new CoverageReport(E2E_REPORT_OPTIONS);

/** Every page's coverage starts as it opens, before its first navigation. */
function trackPages(context: BrowserContext): Map<Page, Promise<void>> {
  const started = new Map<Page, Promise<void>>();
  context.on('page', (page) => {
    started.set(
      page,
      page.coverage.startJSCoverage({ resetOnNavigation: false }),
    );
  });
  return started;
}

async function collect(
  page: Page,
  started: Map<Page, Promise<void>>,
): Promise<void> {
  const start = started.get(page);
  started.delete(page);
  if (!start || page.isClosed()) return;
  await start;
  const entries = await page.coverage.stopJSCoverage();
  if (entries.length === 0) {
    test.info().annotations.push({
      type: 'empty V8 capture',
      description: page.url(),
    });
    return;
  }
  await report.add(entries);
}

function bindTo<T extends object>(
  target: T,
  overrides: Partial<Record<keyof T, unknown>>,
): T {
  return new Proxy(target, {
    get(object, key) {
      if (key in overrides) return overrides[key as keyof T];
      const value: unknown = Reflect.get(object, key, object);
      return typeof value === 'function' ? value.bind(object) : value;
    },
  });
}

/**
 * Returns the context unchanged outside a coverage run. Inside one, closing a
 * page or the context first hands that page's coverage to the report - after
 * `close()` it is gone.
 */
export function withCoverage(context: BrowserContext): BrowserContext {
  if (!IS_COVERAGE_RUN) return context;
  const started = trackPages(context);
  const wrapped = new WeakMap<Page, Page>();

  const coveredPage = (page: Page): Page => {
    const existing = wrapped.get(page);
    if (existing) return existing;
    const result = bindTo(page, {
      close: async (...args: Parameters<Page['close']>) => {
        await collect(page, started);
        return page.close(...args);
      },
    });
    wrapped.set(page, result);
    return result;
  };

  return bindTo(context, {
    pages: () => context.pages().map(coveredPage),
    newPage: async () => {
      const page = await context.newPage();
      await started.get(page);
      return coveredPage(page);
    },
    close: async (...args: Parameters<BrowserContext['close']>) => {
      await Promise.all(
        [...started.keys()].map((page) => collect(page, started)),
      );
      return context.close(...args);
    },
  });
}

/**
 * Speed budgets are measured by the normal `pnpm e2e` run. The coverage build
 * is unminified and instrumented, so its timings say nothing about Deck; the
 * coverage run records them as an annotation instead of failing on them.
 */
export function expectWithinBudget(
  label: string,
  actual: number,
  budget: { max: number } | { min: number },
): void {
  if (IS_COVERAGE_RUN) {
    test.info().annotations.push({
      type: 'budget not enforced (coverage build)',
      description: `${label}: ${actual}`,
    });
    return;
  }
  if ('max' in budget) expect(actual, label).toBeLessThan(budget.max);
  else expect(actual, label).toBeGreaterThan(budget.min);
}
