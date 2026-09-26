interface PaletteRequest {
  bitmap: ImageBitmap;
}

const SAMPLE_SIZE = 64;
const COLOR_COUNT = 8;

function linearChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

self.onmessage = ({ data }: MessageEvent<PaletteRequest>) => {
  const canvas = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Deck: palette canvas is unavailable.');
  context.drawImage(data.bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  data.bitmap.close();
  const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  const buckets = new Map<
    string,
    { red: number; green: number; blue: number; count: number }
  >();
  let maximumLuminance = 0;
  for (let index = 0; index < pixels.length; index += 16) {
    const red = pixels[index] ?? 0;
    const green = pixels[index + 1] ?? 0;
    const blue = pixels[index + 2] ?? 0;
    const key = `${red >> 5}-${green >> 5}-${blue >> 5}`;
    const bucket = buckets.get(key) ?? { red: 0, green: 0, blue: 0, count: 0 };
    buckets.set(key, {
      red: bucket.red + red,
      green: bucket.green + green,
      blue: bucket.blue + blue,
      count: bucket.count + 1,
    });
    maximumLuminance = Math.max(
      maximumLuminance,
      0.2126 * linearChannel(red) +
        0.7152 * linearChannel(green) +
        0.0722 * linearChannel(blue),
    );
  }
  const colors = [...buckets.values()]
    .toSorted((a, b) => b.count - a.count)
    .slice(0, COLOR_COUNT)
    .map(
      ({ red, green, blue, count }) =>
        `rgb(${Math.round(red / count)} ${Math.round(green / count)} ${Math.round(blue / count)})`,
    );
  const gradient = `linear-gradient(135deg, ${colors.join(', ')})`;
  self.postMessage({ gradient, luminance: maximumLuminance });
};
