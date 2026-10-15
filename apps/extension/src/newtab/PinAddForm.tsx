import type { Card } from 'deck-schema';
import { useState } from 'react';

import { strings } from '../i18n/strings';
import type { SurfaceData } from './bootstrap';
import { focusOnMount } from './focusOnMount';
import { createPin } from './pinUndo';
import type { NoticeInput } from './ToastStack';

export default function PinAddForm({
  cards,
  pins,
  defaultDeckId,
  repository,
  onCardsChange,
  onClose,
  notify,
}: {
  cards: Card[];
  pins: Card[];
  defaultDeckId: string;
  repository: SurfaceData['repository'];
  onCardsChange: (cards: Card[]) => void;
  onClose: () => void;
  notify: (notice: NoticeInput) => void;
}) {
  const [urlInput, setUrlInput] = useState('');
  const addPin = async () => {
    try {
      const saved = await createPin(repository, urlInput, defaultDeckId, pins);
      onCardsChange([...cards, saved]);
      onClose();
      notify({ kind: 'success', text: strings.saved });
    } catch (error) {
      notify({
        kind: 'error',
        text: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return (
    <div className="deck-pin-add-form">
      <input
        className="deck-pin-url-input"
        ref={focusOnMount}
        value={urlInput}
        placeholder={strings.pinUrlPlaceholder}
        aria-label={strings.pinUrlPlaceholder}
        onChange={(event) => setUrlInput(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void addPin();
          if (event.key === 'Escape') onClose();
        }}
      />
    </div>
  );
}
