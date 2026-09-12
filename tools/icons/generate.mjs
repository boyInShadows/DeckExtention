/**
 * Generates Deck's extension icons.
 *
 * Committed so the PNGs are reproducible rather than mystery binaries. Colours
 * are RGB triples that mirror `tokens.css` (--deck-color-focus on
 * --deck-color-canvas); the icon is a stack of three cards - a deck.
 *
 *   node tools/icons/generate.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../apps/extension/public/icons',
);

const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;

/** Mirrors --deck-color-focus (night). */
const INK = [122, 162, 247];
/** Mirrors --deck-color-canvas (night). */
const CANVAS = [11, 13, 18];

/** Squircle-ish corner radius, as a fraction of the icon edge. */
const CORNER_RATIO = 0.22;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Coverage of a rounded rectangle at a sample point, 0 or 1. */
const isInsideRoundedRect = (x, y, left, top, width, height, radius) => {
  const right = left + width;
  const bottom = top + height;
  if (x < left || x > right || y < top || y > bottom) return false;

  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
};

const renderIcon = (size) => {
  const scale = size * SUPERSAMPLE;
  const pixels = new Uint8Array(size * size * 4);

  // Three cards, tallest at the back, each inset from the last.
  const cards = [
    { inset: 0.14, top: 0.16, height: 0.2 },
    { inset: 0.2, top: 0.4, height: 0.2 },
    { inset: 0.26, top: 0.64, height: 0.2 },
  ];

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let background = 0;
      let foreground = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px * SUPERSAMPLE + sx + 0.5) / scale;
          const y = (py * SUPERSAMPLE + sy + 0.5) / scale;

          if (!isInsideRoundedRect(x, y, 0, 0, 1, 1, CORNER_RATIO)) continue;
          background += 1;

          for (const card of cards) {
            const inside = isInsideRoundedRect(
              x,
              y,
              card.inset,
              card.top,
              1 - card.inset * 2,
              card.height,
              card.height / 2.6,
            );
            if (inside) {
              foreground += 1;
              break;
            }
          }
        }
      }

      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const alpha = clamp01(background / samples);
      const inkMix = background === 0 ? 0 : clamp01(foreground / background);

      const offset = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(
          INK[channel] * (1 - inkMix) + CANVAS[channel] * inkMix,
        );
      }
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }

  return pixels;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
};

const encodePng = (size, pixels) => {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(pixels.subarray(y * stride, (y + 1) * stride)).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUTPUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, renderIcon(size)));
  process.stdout.write(`icon-${size}.png\n`);
}
