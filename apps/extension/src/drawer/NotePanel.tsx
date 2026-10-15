import type { Card, Deck } from 'deck-schema';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import { useDismissable } from '../hooks/useDismissable';
import { strings as surfaceStrings } from '../i18n/strings';
import type { SurfaceData } from '../newtab/bootstrap';
import { focusOnMount } from '../newtab/focusOnMount';
import FaviconTile from '../newtab/FaviconTile';
import { MarkdownNote } from './MarkdownNote';

const AUTOSAVE_MS = 600;
const now = () => Date.now();
const message = (error: unknown) =>
  `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`;

export interface NotePanelHandle {
  flush: () => Promise<boolean>;
}

export const NotePanel = forwardRef<
  NotePanelHandle,
  {
    entity: Deck | Card;
    repository: SurfaceData['repository'];
    onSaved: (saved: Deck | Card) => void;
    onClose: () => void;
    onError: (value: string) => void;
  }
>(function NotePanel({ entity, repository, onSaved, onClose, onError }, ref) {
  const [note, setNote] = useState(entity.note ?? '');
  const [isPreview, setIsPreview] = useState(false);
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const draft = useRef(note);
  const saved = useRef(entity);
  const pending = useRef<Promise<boolean> | null>(null);
  const timer = useRef<number | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  const save = async (): Promise<boolean> => {
    if (pending.current) return (await pending.current) && save();
    if (draft.current === (saved.current.note ?? '')) return true;
    setStatus('saving');
    const write = (async () => {
      try {
        const current =
          'deckId' in saved.current
            ? (await repository.listCards()).find(
                ({ id }) => id === saved.current.id,
              )
            : (await repository.listDecks()).find(
                ({ id }) => id === saved.current.id,
              );
        if (!current || current.deletedAt !== null)
          throw new Error(strings.noteTargetMissing);
        const value = {
          ...current,
          note: draft.current || undefined,
          updatedAt: now(),
        };
        const result =
          'deckId' in value
            ? await repository.upsertCard(value)
            : await repository.upsertDeck(value);
        saved.current = result;
        onSaved(result);
        setStatus(draft.current === (result.note ?? '') ? 'saved' : 'saving');
        return true;
      } catch (error) {
        setStatus('error');
        onError(message(error));
        return false;
      }
    })();
    pending.current = write;
    const didSave = await write;
    pending.current = null;
    return didSave && (draft.current === (saved.current.note ?? '') || save());
  };

  const flush = async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    return save();
  };
  useImperativeHandle(ref, () => ({ flush }));
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const saveAndClose = async () => {
    if (await flush()) onClose();
  };
  useDismissable(panelRef, saveAndClose, undefined, false);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'j') return;
    event.stopPropagation();
    const isSubmit = event.key === 'Enter' && (event.ctrlKey || event.metaKey);
    if (!isSubmit) return;
    event.preventDefault();
    void saveAndClose();
  };
  const changeNote = (value: string) => {
    draft.current = value;
    setNote(value);
    setStatus('saving');
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
  };
  const isCard = 'deckId' in entity;
  return (
    <aside
      ref={panelRef}
      data-deck="note"
      className="deck-note-panel"
      aria-label={`${strings.editNote}: ${entity.title}`}
      onKeyDown={onKeyDown}
    >
      <header data-deck="note-header">
        {isCard ? (
          <FaviconTile url={entity.url} hostname={entity.hostname} />
        ) : null}
        <div
          data-deck="note-identity"
          className="deck-note-panel__identity deck-blurrable"
        >
          <strong data-deck="note-title">{entity.title}</strong>
          {isCard ? (
            <small data-deck="note-hostname">{entity.hostname}</small>
          ) : null}
        </div>
        <span data-deck="note-status" role="status">
          {status === 'saved'
            ? surfaceStrings.saved
            : status === 'saving'
              ? strings.saving
              : strings.saveFailed}
        </span>
        <button
          type="button"
          data-deck="note-toggle-preview"
          className="deck-note-panel__action"
          onClick={() => setIsPreview((value) => !value)}
        >
          {isPreview ? strings.edit : strings.preview}
        </button>
        <button
          type="button"
          data-deck="note-close"
          className="deck-note-panel__action"
          onClick={() => void saveAndClose()}
        >
          {strings.close}
        </button>
      </header>
      {isPreview ? (
        <div
          data-deck="note-preview"
          className="deck-note-preview deck-blurrable"
        >
          <MarkdownNote value={note} />
        </div>
      ) : (
        <textarea
          ref={focusOnMount}
          data-deck="note-text"
          className="deck-blurrable"
          aria-label={`${strings.editNote}: ${entity.title}`}
          value={note}
          onChange={(event) => changeNote(event.target.value)}
        />
      )}
      <button
        type="button"
        data-deck="note-save"
        className="deck-note-panel__action deck-note-panel__save"
        onClick={() => void flush()}
      >
        {strings.saveNote}
      </button>
    </aside>
  );
});
