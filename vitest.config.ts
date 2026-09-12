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
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
