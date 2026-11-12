/**
 * Resize the owner's artwork into the manifest's transparent PNG icons.
 * Requires the project's Playwright Chromium (or PLAYWRIGHT_CHROMIUM_EXECUTABLE).
 * Run: node tools/icons/generate.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const SOURCE = new URL('./deck.png', import.meta.url);
const OUTPUT = new URL('../../apps/extension/public/icons/', import.meta.url);
const SIZES = [16, 32, 48, 128];
const source = await readFile(SOURCE);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});

try {
  const page = await browser.newPage();
  const icons = await page.evaluate(
    async ({ encoded, sizes }) => {
      const artwork = new globalThis.Image();
      artwork.src = `data:image/png;base64,${encoded}`;
      await artwork.decode();
      if (
        !artwork.naturalWidth ||
        artwork.naturalWidth !== artwork.naturalHeight
      )
        throw new Error('Deck artwork must be a nonempty square image');
      return sizes.map((size) => {
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = canvas.height = size;
        const paint = canvas.getContext('2d');
        if (!paint) throw new Error('Icon canvas unavailable');
        paint.imageSmoothingQuality = 'high';
        paint.drawImage(artwork, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      });
    },
    { encoded: source.toString('base64'), sizes: SIZES },
  );
  await mkdir(OUTPUT, { recursive: true });
  for (const [index, size] of SIZES.entries()) {
    const png = Buffer.from(icons[index], 'base64');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    await writeFile(new URL(`icon-${size}.png`, OUTPUT), png);
    process.stdout.write(`icon-${size}.png\n`);
  }
} finally {
  await browser.close();
}
