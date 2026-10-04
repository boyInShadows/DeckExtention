import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      include: [
        'packages/schema/src/**/*.ts',
        'apps/extension/src/**/*.{ts,tsx}',
      ],
      exclude: [
        'apps/extension/src/background/**',
        'apps/extension/src/wallpaper/palette.worker.ts',
      ],
      /*
       * No thresholds here: the 80 % floor applies to unit + E2E merged, and
       * tools/test-coverage/run.mjs (`pnpm test:coverage`) enforces it.
       */
      reportsDirectory: 'coverage/unit',
      reporter: ['json', 'text-summary'],
    },
  },
});
