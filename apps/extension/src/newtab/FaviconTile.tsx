import { useState } from 'react';

const ICON_SIZE = 32;
const GENERIC_URL = 'https://deck-favicon-placeholder.invalid/';
const TONES = ['slate', 'indigo', 'teal', 'rose', 'sand', 'moss'] as const;

function faviconUrl(url: string): string {
  const endpoint =
    globalThis.chrome?.runtime?.getURL('/_favicon/') ?? '/_favicon/';
  return `${endpoint}?pageUrl=${encodeURIComponent(url)}&size=${ICON_SIZE}`;
}

function fingerprint(image: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE);
    return canvas.toDataURL();
  } catch (error) {
    if (error instanceof DOMException || error instanceof TypeError)
      return null;
    throw error;
  }
}

let genericFingerprint: Promise<string | null> | null = null;
function genericIcon(): Promise<string | null> {
  genericFingerprint ??= new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(fingerprint(image));
    image.onerror = () => resolve(null);
    image.src = faviconUrl(GENERIC_URL);
  });
  return genericFingerprint;
}

export default function FaviconTile({
  url,
  hostname,
}: {
  url: string;
  hostname: string;
}) {
  const [isFavicon, setIsFavicon] = useState(false);
  const name = hostname.replace(/^www\./i, '');
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const tone = TONES[Math.abs(hash) % TONES.length];
  return (
    <span
      data-deck="site-icon"
      className="deck-site-icon"
      style={{ background: `var(--deck-color-wallpaper-${tone})` }}
      aria-hidden="true"
    >
      <span hidden={isFavicon}>{name.charAt(0).toUpperCase()}</span>
      <img
        src={faviconUrl(url)}
        alt=""
        hidden={!isFavicon}
        onError={() => setIsFavicon(false)}
        onLoad={(event) => {
          const icon = fingerprint(event.currentTarget);
          void genericIcon().then((generic) =>
            setIsFavicon(Boolean(icon && icon !== generic)),
          );
        }}
      />
    </span>
  );
}
