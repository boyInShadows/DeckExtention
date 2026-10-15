import type { Card } from 'deck-schema';
import { useRef, useState } from 'react';

import { strings } from '../i18n/strings';
import { useDismissable } from '../hooks/useDismissable';
import type { SurfaceData } from './bootstrap';
import { focusOnMount } from './focusOnMount';
import { createPin } from './pinUndo';
import type { NoticeInput } from './ToastStack';

const pinAddButton = () =>
  document.querySelector<HTMLButtonElement>('[data-deck="pin-add"]');

export default function PinAddForm({
  cards,
  pins,
  initialUrl,
  repository,
  onCardsChange,
  onClose,
  notify,
}: {
  cards: Card[];
  pins: Card[];
  initialUrl: string;
  repository: SurfaceData['repository'];
  onCardsChange: (cards: Card[]) => void;
  onClose: () => void;
  notify: (notice: NoticeInput) => void;
}) {
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [labelInput, setLabelInput] = useState('');
  const formRef = useRef<HTMLDivElement>(null);
  useDismissable(formRef, onClose, pinAddButton);
  const addPin = async () => {
    try {
      const saved = await createPin(repository, urlInput, labelInput, pins);
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
    <div ref={formRef} data-deck="pin-add-form" className="deck-pin-add-form">
      <input
        className="deck-pin-url-input"
        ref={focusOnMount}
        value={urlInput}
        placeholder={strings.pinUrlPlaceholder}
        aria-label={strings.pinUrlPlaceholder}
        onChange={(event) => setUrlInput(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void addPin();
        }}
      />
      <input
        className="deck-pin-label-input"
        value={labelInput}
        placeholder={strings.pinLabelPlaceholder}
        aria-label={strings.pinLabelPlaceholder}
        onChange={(event) => setLabelInput(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void addPin();
        }}
      />
      <button type="button" onClick={() => void addPin()}>
        {strings.addPin}
      </button>
    </div>
  );
}
