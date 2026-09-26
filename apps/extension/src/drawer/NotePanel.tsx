import type { Card, Deck } from 'deck-schema';
import { useState, type KeyboardEvent } from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import type { SurfaceData } from '../newtab/bootstrap';
import { focusOnMount } from '../newtab/focusOnMount';

/** The 360 px note sheet for a card or a deck (FableTasks P2.S2). */

const now = () => Date.now();
const message = (error: unknown) =>
  `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`;

export function NotePanel({
  entity,
  repository,
  onSaved,
  onClose,
  onError,
}: {
  entity: Deck | Card;
  repository: SurfaceData['repository'];
  onSaved: (saved: Deck | Card) => void;
  onClose: () => void;
  onError: (value: string) => void;
}) {
  const [note, setNote] = useState(entity.note ?? '');
  const [isPreview, setIsPreview] = useState(false);
  const save = async (): Promise<boolean> => {
    try {
      const value = { ...entity, note: note || undefined, updatedAt: now() };
      onSaved(
        'deckId' in value
          ? await repository.upsertCard(value)
          : await repository.upsertDeck(value),
      );
      return true;
    } catch (error) {
      onError(message(error));
      return false;
    }
  };
  // Leaving by keyboard never discards what was typed; a failed save stays.
  const saveAndClose = async () => {
    if (note !== (entity.note ?? '') && !(await save())) return;
    onClose();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    const isSubmit = event.key === 'Enter' && (event.ctrlKey || event.metaKey);
    if (event.key !== 'Escape' && !isSubmit) return;
    event.preventDefault();
    void saveAndClose();
  };
  return (
    <aside data-deck="note" className="deck-note-panel" onKeyDown={onKeyDown}>
      <header>
        <button type="button" onClick={() => setIsPreview((value) => !value)}>
          {isPreview ? strings.edit : strings.preview}
        </button>
        <button type="button" onClick={onClose}>
          {strings.close}
        </button>
      </header>
      {isPreview ? (
        <div className="deck-note-preview">{note}</div>
      ) : (
        <textarea
          ref={focusOnMount}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      )}
      <button type="button" onClick={() => void save()}>
        {strings.saveNote}
      </button>
    </aside>
  );
}
