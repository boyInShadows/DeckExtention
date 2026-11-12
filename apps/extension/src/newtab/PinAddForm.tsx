import type { Card } from 'deck-schema';
import { useRef, useState } from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import { useDismissable } from '../hooks/useDismissable';
import type { SurfaceData } from './bootstrap';
import { focusOnMount } from './focusOnMount';
import { Icon } from './Icon';
import { createPin, MAX_PIN_COUNT } from './pinUndo';
import type { NoticeInput } from './ToastStack';
import { findSavedLink, type SavedLink } from '../capture/manualDuplicate';
import { DuplicateLinkNotice } from '../capture/DuplicateLinkNotice';
import { captureTarget, saveToInbox } from '../capture/quickSave';

const returnFocus = () => {
  const button = document.querySelector<HTMLButtonElement>(
    '[data-deck="pin-add"]',
  );
  return button && !button.disabled
    ? button
    : document.querySelector<HTMLInputElement>('[data-deck="line"] input');
};

export default function PinAddForm({
  cards,
  pins,
  initialUrl,
  canSaveToInbox = false,
  repository,
  onCardsChange,
  onClose,
  notify,
}: {
  cards: Card[];
  pins: Card[];
  initialUrl: string;
  canSaveToInbox?: boolean;
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
  useDismissable(formRef, onClose, returnFocus);
  const saveLink = async (destination: 'inbox' | 'pin') => {
    if (saving.current) return;
    saving.current = true;
    setIsSaving(true);
    try {
      const existing = await findSavedLink(repository, urlInput);
      if (existing) {
        setDuplicate(existing);
        return;
      }
      const target = captureTarget(urlInput.trim(), labelInput);
      if (!target) throw new Error(strings.invalidUrl);
      const result =
        destination === 'inbox'
          ? await saveToInbox(repository, target)
          : {
              kind: 'saved' as const,
              card: await createPin(repository, urlInput, labelInput, pins),
            };
      if (result.kind === 'duplicate') {
        setDuplicate({
          card: result.card,
          location: result.card.pinned
            ? strings.pinsLabel
            : (result.location ?? strings.inbox),
        });
        return;
      }
      onCardsChange([...cards, result.card]);
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
      aria-label={canSaveToInbox ? strings.saveLink : strings.addPin}
    >
      <header data-deck="pin-add-header" className="deck-pin-add-header">
        <h2>{canSaveToInbox ? strings.saveLink : strings.addPin}</h2>
        <button
          type="button"
          aria-label={strings.cancel}
          onClick={() => {
            onClose();
            requestAnimationFrame(() => returnFocus()?.focus());
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
          if (event.key === 'Enter')
            void saveLink(canSaveToInbox ? 'inbox' : 'pin');
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
          if (event.key === 'Enter')
            void saveLink(canSaveToInbox ? 'inbox' : 'pin');
        }}
      />
      {canSaveToInbox ? (
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void saveLink('inbox')}
        >
          {strings.saveToInbox}
        </button>
      ) : null}
      <button
        type="button"
        disabled={isSaving || pins.length >= MAX_PIN_COUNT}
        title={pins.length >= MAX_PIN_COUNT ? strings.pinLimit : undefined}
        onClick={() => void saveLink('pin')}
      >
        {strings.addPin}
      </button>
      {canSaveToInbox ? (
        <p data-deck="capture-destination">
          {pins.length >= MAX_PIN_COUNT
            ? strings.pinLimit
            : strings.pasteDestinationHint}
        </p>
      ) : null}
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
