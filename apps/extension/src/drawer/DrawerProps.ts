import type { Card, Deck, KeyBinding, Page } from 'deck-schema';
import type { RefObject } from 'react';
import type { SurfaceData } from '../newtab/bootstrap';
import type { UndoAction } from './UndoToast';

export interface DrawerProps {
  /** Settings.keymap, resolved in the drawer so keymap code stays lazy. */
  keymapOverrides: readonly KeyBinding[];
  cards: Card[];
  data: SurfaceData;
  decks: Deck[];
  isOpen: boolean;
  pages: Page[];
  onCardsChange: (cards: Card[]) => void;
  onClose: () => void;
  onDecksChange: (decks: Deck[]) => void;
  onError: (message: string) => void;
  onSuccess?: (message: string) => void;
  onPagesChange: (pages: Page[]) => void;
  offerUndo: (action: UndoAction) => void;
  beforeCloseRef?: RefObject<(() => Promise<boolean>) | null>;
  requestedNote?: Card | null;
  onNoteOpened?: () => void;
  initialPageId?: string | undefined;
  initialEditingDeckId?: string | undefined;
  onPageSelect?: (id: string | null) => void;
  navigationRequest?: { pageId: string } | undefined;
}
