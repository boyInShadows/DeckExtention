/*
 * React's API, Preact's weight. Owner decision, 2026-09-08.
 *
 * MasterPlan section 4 sets a hard 60 kB gz budget on the surface entry
 * because P1-Instant is the property the whole product rests on. React 19 +
 * ReactDOM alone measured 58.97 kB gz - 98.3% of that budget with zero
 * product code in it, leaving 1 kB for the clock, The Line, pins, themes and
 * wallpaper. Aliasing to preact/compat measured 7.19 kB gz, freeing 52 kB.
 *
 * We keep writing ordinary React: same hooks, same JSX, same ecosystem
 * (dnd-kit in P1.S4). Only the runtime underneath changes. Reverting is
 * deleting this block.
 *
 * `react-dom/test-utils` and `react/jsx-dev-runtime` are mapped too - the
 * first is pulled in by testing libraries, the second by the dev server.
 * Missing either produces a confusing "failed to resolve" only in dev or
 * only in tests.
 *
 * Shared by vite.config.ts and the root vitest.config.ts, so components
 * render on the same runtime in unit tests as in the extension.
 */
export const PREACT_ALIAS = {
  react: '@preact/compat',
  'react-dom': '@preact/compat',
  'react-dom/client': '@preact/compat/client',
  'react-dom/test-utils': '@preact/compat/test-utils',
  'react/jsx-runtime': '@preact/compat/jsx-runtime',
  'react/jsx-dev-runtime': '@preact/compat/jsx-dev-runtime',
} as const;
