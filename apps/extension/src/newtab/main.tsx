import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Surface } from './Surface';
import { hydrateSurface } from './bootstrap';

performance.mark('deck-start');

const container = document.getElementById('deck-root');

/*
 * A missing root means the page shipped broken. Failing loudly here is the only
 * honest option - AGENTS.md section 6: never swallow an error silently.
 */
if (!container) {
  throw new Error('Deck: #deck-root is missing from the new tab document.');
}

const surfaceData = await hydrateSurface();

document.documentElement.dataset.theme = surfaceData.settings.theme;
if (surfaceData.settings.wallpaperGradient) {
  document.body.style.backgroundImage = surfaceData.settings.wallpaperGradient;
}

createRoot(container).render(
  <StrictMode>
    <Surface initialData={surfaceData} />
  </StrictMode>,
);
