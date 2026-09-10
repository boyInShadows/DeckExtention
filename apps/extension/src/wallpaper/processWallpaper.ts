export interface WallpaperPalette {
  gradient: string;
  luminance: number;
}

export async function processWallpaper(blob: Blob): Promise<WallpaperPalette> {
  const bitmap = await createImageBitmap(blob);
  const worker = new Worker(new URL('./palette.worker.ts', import.meta.url), {
    type: 'module',
  });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<WallpaperPalette>) => {
      worker.terminate();
      resolve(data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({ bitmap }, [bitmap]);
  });
}
