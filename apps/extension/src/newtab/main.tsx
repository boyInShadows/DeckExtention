import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Surface } from './Surface';

const container = document.getElementById('deck-root');

/*
 * A missing root means the page shipped broken. Failing loudly here is the only
 * honest option - AGENTS.md section 6: never swallow an error silently.
 */
if (!container) {
  throw new Error('Deck: #deck-root is missing from the new tab document.');
}

createRoot(container).render(
  <StrictMode>
    <Surface />
  </StrictMode>,
);
