import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import manifest from './manifest.config.js';
import { PREACT_ALIAS } from './preactAlias.js';

/** The surface must run on the Chrome the manifest claims to support. */
const BUILD_TARGET = 'chrome116';

/*
 * `pnpm test:coverage` builds with DECK_COVERAGE=1 so Playwright's V8
 * coverage can be mapped back to source and merged with Vitest's
 * (tools/test-coverage). Never a shipping build: inline maps and unminified
 * code would blow the budgets.
 */
const IS_COVERAGE_BUILD = process.env.DECK_COVERAGE === '1';

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
    sourcemap: IS_COVERAGE_BUILD ? 'inline' : false,
    minify: !IS_COVERAGE_BUILD,
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
