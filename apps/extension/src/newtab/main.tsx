import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { OPEN_SETTINGS_HASH } from 'deck-schema/constants';

import { strings } from '../i18n/strings';
import { Surface } from './Surface';
import { hydrateSurface, type SurfaceData } from './bootstrap';

performance.mark('deck-start');

const container = document.getElementById('deck-root');

/*
 * A missing root means the page shipped broken. Failing loudly here is the only
 * honest option - AGENTS.md section 6: never swallow an error silently.
 */
if (!container) {
  throw new Error('Deck: #deck-root is missing from the new tab document.');
}

const root = createRoot(container);

function renderSurface(surfaceData: SurfaceData): void {
  document.documentElement.dataset.theme = surfaceData.settings.theme;
  root.render(
    <StrictMode>
      <Surface initialData={surfaceData} />
    </StrictMode>,
  );
}

try {
  renderSurface(await hydrateSurface());
} catch (error) {
  container.textContent = strings.updateFailed;
  try {
    const { RecoverySurface } = await import('./RecoverySurface');
    root.render(
      <RecoverySurface
        error={error}
        onContinue={async () => renderSurface(await hydrateSurface())}
        onOpenSettings={async () => {
          const data = await hydrateSurface();
          location.hash = OPEN_SETTINGS_HASH;
          renderSurface(data);
        }}
      />,
    );
  } catch (recoveryError) {
    container.textContent += ` ${String(recoveryError)}`;
  }
}
