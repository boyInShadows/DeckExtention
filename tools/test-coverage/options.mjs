import { resolve } from 'node:path';

/**
 * Shared settings for the merged coverage gate (AGENTS.md section 7).
 *
 * Unit tests (Vitest) and E2E tests (Playwright) each cover part of the code;
 * the 80 % floor applies to what both of them run, merged.
 */
export const COVERAGE_ROOT = resolve('coverage');
export const UNIT_COVERAGE_FILE = resolve('coverage/unit/coverage-final.json');
export const E2E_OUTPUT_DIR = resolve('coverage/e2e');
export const E2E_COVERAGE_FILE = resolve('coverage/e2e/coverage-final.json');
export const MERGED_OUTPUT_DIR = resolve('coverage/merged');

/** AGENTS.md section 7. Not a dial: lower code, not this number. */
export const COVERAGE_FLOOR_PCT = 80;
export const COVERAGE_METRICS = [
  'lines',
  'statements',
  'functions',
  'branches',
];

const SCHEMA_SOURCE = /(?:^|\/)(packages\/schema\/src\/.+)$/;
const EXTENSION_SOURCE = /(?:^|\/)src\/(.+)$/;

/**
 * One absolute path per file, whatever shape it arrives in: Vitest keys files
 * by absolute path, while the bundle's source maps name them relative to
 * `dist/assets` (`../../src/x.ts`), which the coverage tool may already have
 * trimmed. Merging only works when both runners name a file identically.
 */
export function toAbsoluteSource(sourcePath) {
  const path = sourcePath.replaceAll('\\', '/');
  if (path.includes('node_modules/')) return path;
  const schema = SCHEMA_SOURCE.exec(path);
  if (schema) return resolve(schema[1]);
  const extension = EXTENSION_SOURCE.exec(path);
  return extension ? resolve('apps/extension/src', extension[1]) : path;
}

const MEASURED_ROOTS = ['/apps/extension/src/', '/packages/schema/src/'];

/**
 * Same scope as vitest.config.ts `coverage.include` / `exclude`, so the two
 * reports describe the same files. The service worker is not measured by
 * either runner.
 */
export function isMeasuredSource(sourcePath) {
  const path = toAbsoluteSource(sourcePath).replaceAll('\\', '/');
  return (
    MEASURED_ROOTS.some((root) => path.includes(root)) &&
    /\.tsx?$/.test(path) &&
    !path.includes('/apps/extension/src/background/') &&
    !path.endsWith('/wallpaper/palette.worker.ts') &&
    !path.endsWith('.test.ts') &&
    !path.endsWith('.test.tsx') &&
    !path.endsWith('.d.ts')
  );
}

export const E2E_REPORT_OPTIONS = {
  name: 'Deck E2E coverage',
  outputDir: E2E_OUTPUT_DIR,
  entryFilter: (entry) => entry.url.startsWith('chrome-extension://'),
  sourcePath: toAbsoluteSource,
  sourceFilter: isMeasuredSource,
  reports: [['json', { file: 'coverage-final.json' }]],
};
