import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import manifest from './manifest.config.js';

/** The surface must run on the Chrome the manifest claims to support. */
const BUILD_TARGET = 'chrome116';

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
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
  },
});
