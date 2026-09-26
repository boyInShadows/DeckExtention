import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import manifest from './manifest.config.js';

/** The surface must run on the Chrome the manifest claims to support. */
const BUILD_TARGET = 'chrome116';

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
 */
const PREACT_ALIAS = {
  react: '@preact/compat',
  'react-dom': '@preact/compat',
  'react-dom/client': '@preact/compat/client',
  'react-dom/test-utils': '@preact/compat/test-utils',
  'react/jsx-runtime': '@preact/compat/jsx-runtime',
  'react/jsx-dev-runtime': '@preact/compat/jsx-dev-runtime',
} as const;

/** Schema, storage and the libraries under them: see `manualChunks`. */
const CORE_CHUNK_PATTERN =
  /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:zod|idb|fractional-indexing)\/|\/packages\/schema\/|\/src\/storage\/(?:database|document|repository)\.ts$/;

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  resolve: { alias: { ...PREACT_ALIAS } },
  build: {
    target: BUILD_TARGET,
    /*
     * Everything is on disk inside the extension, so preload hints buy nothing
     * and only add markup. Keeping them off makes the first frame cheaper.
     */
    modulePreload: false,
    sourcemap: false,
    /*
     * The font is 48 KB; leave the default inline threshold well below it so it
     * stays a separate file rather than base64 inside the stylesheet.
     */
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        /*
         * The new tab and the service worker share the data layer. Left to
         * itself Rollup splits that shared graph into a new chunk per
         * importer combination, and every split adds import/export glue the
         * 60 kB surface pays for. One named `core` chunk keeps it whole.
         */
        manualChunks(id) {
          return CORE_CHUNK_PATTERN.test(id.replaceAll('\\', '/'))
            ? 'core'
            : undefined;
        },
      },
    },
  },
});
