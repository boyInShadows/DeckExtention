import { configDefaults, defineConfig } from 'vitest/config';

import { PREACT_ALIAS } from './apps/extension/preactAlias.js';

export default defineConfig({
  resolve: { alias: { ...PREACT_ALIAS } },
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
        'apps/extension/src/testing/**',
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
