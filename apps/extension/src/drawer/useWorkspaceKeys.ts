import type { Card } from 'deck-schema';
import { useLayoutEffect, useRef, type RefObject } from 'react';

import {
  actionForChord,
  chordFromEvent,
  isTypingTarget,
  type KeyActionId,
  type Keymap,
} from '../keys/keymap';
import type { DeckRepository } from '../storage/repository';
import { panelStrings as strings } from '../i18n/panelStrings';
import {
  nextGridPosition,
  type GridMove,
  type GridPosition,
} from './drawerKeys';
import { openCard, pinCards, trashCards } from './inboxActions';
import { replaceEntity } from './workspaceModel';
import type { UndoAction } from './UndoToast';

/**
 * Keyboard for the deck grid (FableTasks P2.S6). Movement is plain DOM focus
 * over `[data-deck="deck"]` / `[data-deck="card"]`, which dnd-kit already
 * makes focusable; actions act on the focused card.
 */

const GRID_MOVES = new Set<KeyActionId>([
  'next',
  'previous',
  'nextDeck',
  'previousDeck',
]);

interface WorkspaceKeysOptions {
  mainRef: RefObject<HTMLElement | null>;
  keymap: Keymap;
  cards: Card[];
  repository: DeckRepository;
  isPaused: boolean;
  onCardsChange: (cards: Card[]) => void;
  onError: (error: unknown) => void;
  onSuccess?: ((message: string) => void) | undefined;
  onNote: (card: Card) => void;
  onMove: (card: Card) => void;
  onEdit: (card: Card) => void;
  onDone: (card: Card) => void;
  offerUndo: ((action: UndoAction) => void) | undefined;
}

interface Grid {
  decks: HTMLElement[];
  cards: HTMLElement[][];
}

function readGrid(main: HTMLElement): Grid {
  const decks = [...main.querySelectorAll<HTMLElement>('[data-deck="deck"]')];
  return {
    decks,
    cards: decks.map((deck) => [
      ...deck.querySelectorAll<HTMLElement>('[data-deck="card"]'),
    ]),
  };
}

function positionOf(grid: Grid, target: Element | null): GridPosition | null {
  if (!target) return null;
  const deck = grid.decks.findIndex((element) => element.contains(target));
  if (deck < 0) return null;
  const card = (grid.cards[deck] ?? []).findIndex((element) =>
    element.contains(target),
  );
  return { deck, card: card < 0 ? null : card };
}

export function focusGridPosition(grid: Grid, position: GridPosition | null) {
  if (!position) return;
  const element =
    position.card === null
      ? grid.decks[position.deck]
      : grid.cards[position.deck]?.[position.card];
  element?.focus();
  element?.scrollIntoView({ block: 'nearest' });
}

export function useWorkspaceKeys(options: WorkspaceKeysOptions): void {
  const latest = useRef(options);
  const queue = useRef<Promise<void>>(Promise.resolve());
  useLayoutEffect(() => {
    latest.current = options;
  });

  // Layout effect, not effect: Preact defers plain effects until after paint,
  // which left a visible grid briefly deaf to keys (e.g. right after `]`).
  useLayoutEffect(() => {
    // Card writes run one at a time against the newest cards, so a quick
    // "p then x" can never re-apply a stale list over the first write.
    const enqueue = (write: (cards: Card[]) => Promise<Card[]>) => {
      queue.current = queue.current.then(async () => {
        const current = latest.current;
        try {
          const next = await write(current.cards);
          latest.current = { ...latest.current, cards: next };
          current.onCardsChange(next);
        } catch (error) {
          current.onError(error);
        }
      });
    };

    const runCardAction = (action: KeyActionId, card: Card, grid: Grid) => {
      const { repository, onNote, onMove } = latest.current;
      const position = positionOf(grid, document.activeElement);
      if (action === 'open' || action === 'openInNewTab') {
        if (!card.url) {
          onNote(card);
          return true;
        }
        enqueue(async (cards) =>
          replaceEntity(
            cards,
            await openCard(repository, card, action === 'openInNewTab'),
          ),
        );
      } else if (action === 'trash') {
        enqueue(async (cards) => {
          const next = await trashCards(repository, cards, [card.id]);
          latest.current.offerUndo?.({
            label: strings.trashedCards(1),
            undo: async () => {
              await repository.restore('card', card.id);
              latest.current.onCardsChange(await repository.listCards());
            },
          });
          return next;
        });
        // Once the row is gone, focus the card that took its place.
        void queue.current.then(() =>
          requestAnimationFrame(() => {
            const { mainRef: ref, isPaused } = latest.current;
            const main = ref.current;
            // Only reclaim focus the removed row took with it - never steal
            // it from a note or move-to opened while the write was queued.
            const focused = document.activeElement;
            const wasLost = !focused || focused === document.body;
            if (!main || !position || isPaused || !wasLost) return;
            const refreshed = readGrid(main);
            const count = refreshed.cards[position.deck]?.length ?? 0;
            focusGridPosition(refreshed, {
              deck: position.deck,
              card: count ? Math.min(position.card ?? 0, count - 1) : null,
            });
          }),
        );
      } else if (action === 'pin') {
        enqueue(async (cards) => {
          const next = await pinCards(repository, cards, [card.id]);
          latest.current.onSuccess?.(strings.pinSaved);
          return next;
        });
      } else if (action === 'note') onNote(card);
      else if (action === 'move') onMove(card);
      else return false;
      return true;
    };

    const runDeckAction = (
      action: KeyActionId,
      grid: Grid,
      main: HTMLElement,
    ) => {
      if (GRID_MOVES.has(action)) {
        const counts = grid.cards.map((row) => row.length);
        const from = positionOf(grid, document.activeElement);
        focusGridPosition(
          grid,
          nextGridPosition(counts, from, action as GridMove),
        );
        return true;
      }
      if (action === 'addDeck') {
        main.querySelector<HTMLElement>('[data-deck="deck-add"]')?.click();
        return true;
      }
      if (action === 'addLink') {
        const deck =
          grid.decks[positionOf(grid, document.activeElement)?.deck ?? 0];
        deck?.querySelector<HTMLElement>('[data-deck="add-card"]')?.click();
        return true;
      }
      return false;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const { mainRef, keymap, cards, isPaused } = latest.current;
      const main = mainRef.current;
      if (!main || isPaused || isTypingTarget(event.target)) return;
      if (
        event.target instanceof Element &&
        event.target.closest('button, a, select, [role="menuitem"]')
      )
        return;
      const isInGrid =
        event.target === document.body || main.contains(event.target as Node);
      // A card mid keyboard-drag owns the keys until it is dropped.
      if (!isInGrid || main.querySelector('[data-dragging]')) return;
      const chord = chordFromEvent(event);
      const action = chord ? actionForChord(keymap, 'drawer', chord) : null;
      const grid = readGrid(main);
      const cardId =
        document.activeElement?.closest<HTMLElement>('[data-deck="card"]')
          ?.dataset.cardId;
      const card = cards.find(({ id }) => id === cardId);
      if (!event.ctrlKey && !event.altKey && !event.metaKey) {
        if (card && (event.key === 'e' || event.key === 'F2')) {
          latest.current.onEdit(card);
          event.preventDefault();
          return;
        }
        if (card && event.key === 'd') {
          latest.current.onDone(card);
          event.preventDefault();
          return;
        }
        const deck =
          document.activeElement?.closest<HTMLElement>('[data-deck="deck"]');
        if (!card && deck && (event.key === 'e' || event.key === 'F2')) {
          deck.querySelector<HTMLElement>('[data-deck="deck-title"]')?.click();
          event.preventDefault();
          return;
        }
        if (!card && deck && event.key === 'n') {
          const openAll = deck.querySelector<HTMLElement>(
            '[data-deck="deck-open-all"]',
          );
          if (openAll) {
            openAll.click();
            event.preventDefault();
            return;
          }
        }
      }
      if (!action) return;
      const isHandled =
        runDeckAction(action, grid, main) ||
        (card !== undefined && runCardAction(action, card, grid));
      if (isHandled) event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
