import type { Card, Deck, Page } from 'deck-schema';
import { generateKeyBetween } from 'fractional-indexing';
import { useMemo, useRef, useState } from 'react';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { panelStrings as strings } from '../i18n/panelStrings';
import type { SurfaceData } from '../newtab/bootstrap';
import type { UndoAction } from './UndoToast';
import {
  activeCards,
  activeDecks,
  parseCardUrl,
  replaceEntity,
} from './workspaceModel';
import { dragId } from './dragIdentity';
import { moveCards } from './inboxActions';
import {
  moveTargets,
  parseRecentTargets,
  RECENT_TARGETS_KEY,
  rememberTarget,
} from './inboxModel';
import { MoveLine } from './MoveLine';
import { useWorkspaceKeys } from './useWorkspaceKeys';
import type { Keymap } from '../keys/keymap';
import { NotePanel } from './NotePanel';
import { focusOnMount } from '../newtab/focusOnMount';
import { CardRow } from './CardRow';
import { DeckMenu } from './DeckMenu';

const DROP_SETTLE_MS = 160;
const DROP_SETTLE_EASING = 'var(--deck-ease-hover)';

export interface WorkspaceProps {
  cards: Card[];
  data: SurfaceData;
  decks: Deck[];
  pages: Page[];
  selectedPageId: string | null;
  selectedDeckKind?: Deck['kind'] | undefined;
  onCardsChange: (cards: Card[]) => void;
  onDecksChange: (decks: Deck[]) => void;
  onError: (message: string) => void;
  onSuccess?: ((message: string) => void) | undefined;
  offerUndo?: (action: UndoAction) => void;
  keymap: Keymap;
  /** False while the drawer animates closed: keys must not act then. */
  isOpen: boolean;
}

const now = () => Date.now();
const focusTitle = (element: HTMLInputElement | null) => {
  element?.focus();
  element?.select();
};
const message = (error: unknown) =>
  `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`;

export function DeckWorkspace(props: WorkspaceProps) {
  const visible = useMemo(
    () =>
      activeDecks(props.decks, props.selectedPageId, props.selectedDeckKind),
    [props.decks, props.selectedDeckKind, props.selectedPageId],
  );
  const [noteEntity, setNoteEntity] = useState<Deck | Card | null>(null);
  const [movingCard, setMovingCard] = useState<Card | null>(null);
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [recentTargets, setRecentTargets] = useState(() =>
    parseRecentTargets(localStorage.getItem(RECENT_TARGETS_KEY)),
  );
  const mainRef = useRef<HTMLElement>(null);
  const targets = useMemo(
    () => moveTargets(props.decks, props.pages),
    [props.decks, props.pages],
  );
  useWorkspaceKeys({
    mainRef,
    keymap: props.keymap,
    cards: props.cards,
    repository: props.data.repository,
    isPaused: !props.isOpen || noteEntity !== null || movingCard !== null,
    onCardsChange: props.onCardsChange,
    onError: (error) => props.onError(message(error)),
    onSuccess: props.onSuccess,
    onNote: setNoteEntity,
    onMove: setMovingCard,
    onEdit: (card) => {
      mainRef.current
        ?.querySelector<HTMLElement>(
          `[data-card-id="${window.CSS.escape(card.id)}"] [data-deck="card-edit"]`,
        )
        ?.click();
    },
    onDone: (card) => {
      mainRef.current
        ?.querySelector<HTMLElement>(
          `[data-card-id="${window.CSS.escape(card.id)}"] [aria-label="${strings.markDone}"]`,
        )
        ?.click();
    },
    offerUndo: props.offerUndo,
  });
  // After a panel closes, keyboard focus goes back to the card it was about.
  const refocus = (id: string) =>
    requestAnimationFrame(() =>
      mainRef.current
        ?.querySelector<HTMLElement>(
          `[data-card-id="${window.CSS.escape(id)}"]`,
        )
        ?.focus(),
    );
  const moveTo = async (card: Card, deckId: string) => {
    setMovingCard(null);
    const nextRecent = rememberTarget(recentTargets, deckId);
    setRecentTargets(nextRecent);
    localStorage.setItem(RECENT_TARGETS_KEY, JSON.stringify(nextRecent));
    try {
      props.onCardsChange(
        await moveCards(props.data.repository, props.cards, [card.id], deckId),
      );
      props.offerUndo?.({
        label: strings.movedCards(1),
        undo: async () => {
          const current = (await props.data.repository.listCards()).find(
            ({ id }) => id === card.id,
          );
          if (!current) throw new Error(strings.updateFailed);
          await props.data.repository.upsertCard({
            ...current,
            deckId: card.deckId,
            order: card.order,
            updatedAt: now(),
          });
          props.onCardsChange(await props.data.repository.listCards());
        },
      });
      refocus(card.id);
    } catch (error) {
      props.onError(message(error));
    }
  };
  const addDeck = async () => {
    if (!props.selectedPageId) return;
    try {
      const time = now();
      const saved = await props.data.repository.upsertDeck({
        id: crypto.randomUUID(),
        pageId: props.selectedPageId,
        title: strings.newDeck,
        kind: 'normal',
        order: generateKeyBetween(visible.at(-1)?.order ?? null, null),
        color: null,
        isCollapsed: false,
        createdAt: time,
        updatedAt: time,
        deletedAt: null,
      });
      setEditingDeckId(saved.id);
      props.onDecksChange([...props.decks, saved]);
      props.onSuccess?.(strings.deckSaved);
    } catch (error) {
      props.onError(message(error));
    }
  };
  if (!props.selectedPageId)
    return <p className="deck-workspace__empty">{strings.selectPage}</p>;
  return (
    <main ref={mainRef} data-deck="decks" className="deck-workspace">
      <div className="deck-grid">
        <SortableContext
          items={visible.map(({ id }) => dragId('deck', id))}
          strategy={rectSortingStrategy}
        >
          {visible.map((deck) => (
            <DeckColumn
              key={deck.id}
              {...props}
              deck={deck}
              isNew={editingDeckId === deck.id}
              visibleCards={activeCards(props.cards, deck.id)}
              onEditNote={setNoteEntity}
            />
          ))}
        </SortableContext>
        <button
          type="button"
          className="deck-add"
          data-deck="deck-add"
          onClick={() => void addDeck()}
        >
          {strings.addDeck}
        </button>
      </div>
      {noteEntity ? (
        <NotePanel
          entity={noteEntity}
          repository={props.data.repository}
          onClose={() => {
            setNoteEntity(null);
            if ('deckId' in noteEntity) refocus(noteEntity.id);
          }}
          onError={props.onError}
          onSaved={(saved) => {
            if ('deckId' in saved)
              props.onCardsChange(replaceEntity(props.cards, saved));
            else props.onDecksChange(replaceEntity(props.decks, saved));
            setNoteEntity(saved);
            props.onSuccess?.(strings.noteSaved);
          }}
        />
      ) : null}
      {movingCard ? (
        <MoveLine
          targets={targets}
          recentDeckIds={recentTargets}
          onMove={(deckId) => void moveTo(movingCard, deckId)}
          onCancel={() => {
            setMovingCard(null);
            refocus(movingCard.id);
          }}
        />
      ) : null}
    </main>
  );
}

function DeckColumn({
  deck,
  isNew,
  visibleCards,
  onEditNote,
  ...props
}: WorkspaceProps & {
  deck: Deck;
  isNew: boolean;
  visibleCards: Card[];
  onEditNote: (entity: Deck | Card) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: dragId('deck', deck.id),
    transition: { duration: DROP_SETTLE_MS, easing: DROP_SETTLE_EASING },
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [menuStart, setMenuStart] = useState<'permission' | null>(null);
  const [isEditing, setIsEditing] = useState(isNew);
  const [title, setTitle] = useState(deck.title);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [url, setUrl] = useState('');
  const commitTitle = () => {
    const trimmed = title.trim();
    setIsEditing(false);
    if (trimmed && trimmed !== deck.title) void saveDeck({ title: trimmed });
    else setTitle(deck.title);
  };
  const saveDeck = async (change: Partial<Deck>) => {
    try {
      const saved = await props.data.repository.upsertDeck({
        ...deck,
        ...change,
        updatedAt: now(),
      });
      props.onDecksChange(replaceEntity(props.decks, saved));
      if (change.pageId && change.pageId !== deck.pageId)
        props.offerUndo?.({
          label: strings.movedDeck,
          undo: async () => {
            const current = (await props.data.repository.listDecks()).find(
              ({ id }) => id === deck.id,
            );
            if (!current) throw new Error(strings.updateFailed);
            await props.data.repository.upsertDeck({
              ...current,
              pageId: deck.pageId,
              updatedAt: now(),
            });
            props.onDecksChange(await props.data.repository.listDecks());
          },
        });
      else props.onSuccess?.(strings.deckSaved);
    } catch (error) {
      props.onError(message(error));
    }
  };
  const addCard = async () => {
    const parsed = parseCardUrl(url);
    if (!parsed) return props.onError(strings.invalidUrl);
    try {
      const time = now();
      const saved = await props.data.repository.upsertCard({
        id: crypto.randomUUID(),
        deckId: deck.id,
        ...parsed,
        order: generateKeyBetween(visibleCards.at(-1)?.order ?? null, null),
        pinned: false,
        lastOpenedAt: null,
        createdAt: time,
        updatedAt: time,
        deletedAt: null,
      });
      props.onCardsChange([...props.cards, saved]);
      setUrl('');
      setIsAdding(false);
      props.onSuccess?.(strings.cardSaved);
    } catch (error) {
      props.onError(message(error));
    }
  };
  return (
    <section
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      data-deck="deck"
      data-deck-id={deck.id}
      className="deck-column"
      data-color={deck.color ?? undefined}
      data-dragging={isDragging || undefined}
      data-drag-over={isOver || undefined}
      {...attributes}
    >
      <header className="deck-column__header">
        <button
          hidden
          type="button"
          data-deck="deck-open-all"
          onClick={() => {
            setMenuStart('permission');
            setMenuAnchor(menuButton.current);
            setIsMenuOpen(true);
          }}
        />
        <button
          ref={setActivatorNodeRef}
          type="button"
          data-deck="deck-drag"
          className="deck-column__drag"
          aria-label={strings.dragDeck}
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
        <button
          type="button"
          aria-label={strings.collapseDeck}
          onClick={() => void saveDeck({ isCollapsed: !deck.isCollapsed })}
        >
          {deck.isCollapsed ? '›' : '⌄'}
        </button>
        {isEditing ? (
          <input
            ref={focusTitle}
            className="deck-column__title"
            aria-label={strings.renameDeckPrompt}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitTitle();
              if (event.key === 'Escape') {
                setTitle(deck.title);
                setIsEditing(false);
              }
            }}
            onBlur={commitTitle}
          />
        ) : (
          <button
            type="button"
            data-deck="deck-title"
            className="deck-column__title"
            onClick={() => {
              setTitle(deck.title);
              setIsEditing(true);
            }}
          >
            {deck.title}
          </button>
        )}
        <small>{visibleCards.length}</small>
        <button
          ref={menuButton}
          type="button"
          aria-label={strings.deckMenu}
          aria-expanded={isMenuOpen}
          onClick={(event) => {
            setMenuStart(null);
            setMenuAnchor(event.currentTarget);
            setIsMenuOpen((value) => !value);
          }}
        >
          •••
        </button>
      </header>
      {isMenuOpen && menuAnchor ? (
        <DeckMenu
          anchor={menuAnchor}
          initialSubMenu={menuStart}
          deck={deck}
          pages={props.pages}
          cards={visibleCards}
          allCards={props.cards}
          repository={props.data.repository}
          onCardsChange={props.onCardsChange}
          saveDeck={saveDeck}
          onRename={() => {
            setTitle(deck.title);
            setIsEditing(true);
          }}
          onEditNote={onEditNote}
          onTrash={() => void trashDeck(deck, props)}
          onError={props.onError}
          onClose={() => setIsMenuOpen(false)}
        />
      ) : null}
      {!deck.isCollapsed ? (
        <>
          {deck.id === 'deck_examples' ? (
            <p data-deck="example-hint">{strings.exampleHint}</p>
          ) : null}
          {deck.note ? (
            <button
              type="button"
              data-deck="deck-note"
              className="deck-note"
              onClick={() => onEditNote(deck)}
            >
              {deck.note}
            </button>
          ) : null}
          <div className="deck-cards">
            <SortableContext
              items={visibleCards.map(({ id }) => dragId('card', id))}
              strategy={verticalListSortingStrategy}
            >
              {visibleCards.map((card) => (
                <CardRow
                  key={card.id}
                  card={card}
                  {...props}
                  onEditNote={onEditNote}
                />
              ))}
            </SortableContext>
            {!visibleCards.length ? <p>{strings.emptyDeck}</p> : null}
          </div>
          <footer>
            {visibleCards.length > 0 &&
            visibleCards.every((card) => card.done) ? (
              <span data-deck="all-done">{strings.allDone}</span>
            ) : null}
            {isAdding ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void addCard();
                }}
              >
                <input
                  ref={focusOnMount}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={strings.pasteUrl}
                  aria-label={strings.pasteUrl}
                />
              </form>
            ) : (
              <button
                type="button"
                data-deck="add-card"
                onClick={() => setIsAdding(true)}
              >
                + {strings.addCard}
              </button>
            )}
          </footer>
        </>
      ) : null}
    </section>
  );
}

async function trashDeck(deck: Deck, props: WorkspaceProps) {
  try {
    await props.data.repository.trashDeck(deck.id);
    const [decks, cards] = await Promise.all([
      props.data.repository.listDecks(),
      props.data.repository.listCards(),
    ]);
    props.onDecksChange(decks);
    props.onCardsChange(cards);
    props.offerUndo?.({
      label: strings.trashedDeck,
      undo: async () => {
        await props.data.repository.restoreDeck(deck.id);
        const [restoredDecks, restoredCards] = await Promise.all([
          props.data.repository.listDecks(),
          props.data.repository.listCards(),
        ]);
        props.onDecksChange(restoredDecks);
        props.onCardsChange(restoredCards);
      },
    });
  } catch (error) {
    props.onError(message(error));
  }
}
