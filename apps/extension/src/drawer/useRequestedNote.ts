import { useEffect } from 'react';
import type { Card, Deck } from 'deck-schema';
import type { DeckRepository } from '../storage/repository';
import { panelStrings as strings } from '../i18n/panelStrings';
import { INBOX_PAGE_ID } from './drawerModel';

export function useRequestedNote({
  repository,
  requestedNote,
  decks,
  isEnabled,
  selectPage,
  onOpen,
  onOpened,
  onError,
}: {
  repository: DeckRepository;
  requestedNote: Card | null | undefined;
  decks: Deck[];
  isEnabled: boolean;
  selectPage: (id: string) => Promise<boolean>;
  onOpen: (card: Card) => void;
  onOpened: (() => void) | undefined;
  onError: (error: string) => void;
}) {
  useEffect(() => {
    if (!requestedNote || !isEnabled) return;
    let isCurrent = true;
    void repository
      .listCards()
      .then(async (stored) => {
        if (!isCurrent) return;
        const card = stored.find(
          (item) => item.id === requestedNote.id && item.deletedAt === null,
        );
        const deck =
          card &&
          decks.find(
            (item) => item.id === card.deckId && item.deletedAt === null,
          );
        if (!card || !deck) {
          onError(strings.noteTargetMissing);
          onOpened?.();
          return;
        }
        const didSelect = await selectPage(
          deck.kind === 'inbox' ? INBOX_PAGE_ID : deck.pageId,
        );
        if (!isCurrent) return;
        if (didSelect) onOpen(card);
        onOpened?.();
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        onError(`${strings.updateFailed} ${String(error)}`);
        onOpened?.();
      });
    return () => {
      isCurrent = false;
    };
  }, [
    repository,
    requestedNote,
    decks,
    isEnabled,
    selectPage,
    onOpen,
    onOpened,
    onError,
  ]);
}
