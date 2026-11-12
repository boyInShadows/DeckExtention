import type { Card } from 'deck-schema';
import { useRef, useState } from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import { useDismissable } from '../hooks/useDismissable';
import type { SurfaceData } from './bootstrap';
import { focusOnMount } from './focusOnMount';
import { Icon } from './Icon';
import { createPin } from './pinUndo';
import type { NoticeInput } from './ToastStack';
import { findSavedLink, type SavedLink } from '../capture/manualDuplicate';
import { DuplicateLinkNotice } from '../capture/DuplicateLinkNotice';

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
  const [duplicate, setDuplicate] = useState<SavedLink | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saving = useRef(false);
  const formRef = useRef<HTMLDivElement>(null);
  useDismissable(formRef, onClose, pinAddButton);
  const addPin = async () => {
    if (saving.current) return;
    saving.current = true;
    setIsSaving(true);
    try {
      const existing = await findSavedLink(repository, urlInput);
      if (existing) {
        setDuplicate(existing);
        return;
      }
      const saved = await createPin(repository, urlInput, labelInput, pins);
      onCardsChange([...cards, saved]);
      onClose();
      notify({ kind: 'success', text: strings.saved });
    } catch (error) {
      notify({
        kind: 'error',
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };
  return (
    <div
      ref={formRef}
      data-deck="pin-add-form"
      className="deck-pin-add-form"
      role="dialog"
      aria-label={strings.addPin}
    >
      <header data-deck="pin-add-header" className="deck-pin-add-header">
        <h2>{strings.addPin}</h2>
        <button
          type="button"
          aria-label={strings.cancel}
          onClick={() => {
            onClose();
            requestAnimationFrame(() => pinAddButton()?.focus());
          }}
        >
          <Icon name="close" />
        </button>
      </header>
      <input
        className="deck-pin-url-input"
        ref={focusOnMount}
        value={urlInput}
        readOnly={isSaving}
        placeholder={strings.pinUrlPlaceholder}
        aria-label={strings.pinUrlPlaceholder}
        onChange={(event) => {
          setUrlInput(event.currentTarget.value);
          setDuplicate(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void addPin();
        }}
      />
      <input
        className="deck-pin-label-input"
        value={labelInput}
        readOnly={isSaving}
        placeholder={strings.pinLabelPlaceholder}
        aria-label={strings.pinLabelPlaceholder}
        onChange={(event) => setLabelInput(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void addPin();
        }}
      />
      <button type="button" disabled={isSaving} onClick={() => void addPin()}>
        {strings.addPin}
      </button>
      {duplicate ? (
        <DuplicateLinkNotice
          duplicate={duplicate}
          repository={repository}
          onError={(text) => notify({ kind: 'error', text })}
        />
      ) : null}
    </div>
  );
}
