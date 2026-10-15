import type { Card, Deck, Page } from 'deck-schema';
import { generateKeyBetween } from 'fractional-indexing';
import { useMemo, useRef, useState, type MouseEvent } from 'react';
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
import { markOpened, moveCards, openCard } from './inboxActions';
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
import FaviconTile from '../newtab/FaviconTile';

const DECK_COLORS = ['slate', 'blue', 'green', 'amber', 'rose'] as const;
const DROP_SETTLE_MS = 160;
const DROP_SETTLE_EASING = 'var(--deck-ease-hover)';

interface Props {
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
const message = (error: unknown) =>
  `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`;

export function DeckWorkspace(props: Props) {
  const visible = useMemo(
    () =>
      activeDecks(props.decks, props.selectedPageId, props.selectedDeckKind),
    [props.decks, props.selectedDeckKind, props.selectedPageId],
  );
  const [noteEntity, setNoteEntity] = useState<Deck | Card | null>(null);
  const [movingCard, setMovingCard] = useState<Card | null>(null);
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
  visibleCards,
  onEditNote,
  ...props
}: Props & {
  deck: Deck;
  visibleCards: Card[];
  onEditNote: (entity: Deck | Card) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: dragId('deck', deck.id),
    transition: { duration: DROP_SETTLE_MS, easing: DROP_SETTLE_EASING },
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [url, setUrl] = useState('');
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
      <header className="deck-column__header" {...listeners}>
        <button
          type="button"
          aria-label={strings.collapseDeck}
          onClick={() => void saveDeck({ isCollapsed: !deck.isCollapsed })}
        >
          {deck.isCollapsed ? '›' : '⌄'}
        </button>
        <button
          type="button"
          className="deck-column__title"
          onDoubleClick={() => void renameDeck(deck, saveDeck)}
        >
          {deck.title}
        </button>
        <small>{visibleCards.length}</small>
        <button
          type="button"
          aria-label={strings.deckMenu}
          onClick={() => setIsMenuOpen((value) => !value)}
        >
          •••
        </button>
      </header>
      {isMenuOpen ? (
        <DeckMenu
          deck={deck}
          pages={props.pages}
          cards={visibleCards}
          allCards={props.cards}
          repository={props.data.repository}
          onCardsChange={props.onCardsChange}
          saveDeck={saveDeck}
          onEditNote={onEditNote}
          onTrash={() => void trashDeck(deck, props)}
          onError={props.onError}
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

function CardRow({
  card,
  onEditNote,
  ...props
}: Omit<Props, 'selectedPageId'> & {
  card: Card;
  onEditNote: (entity: Deck | Card) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: dragId('card', card.id),
    transition: { duration: DROP_SETTLE_MS, easing: DROP_SETTLE_EASING },
  });
  const update = async (change: Partial<Card>) => {
    try {
      props.onCardsChange(
        replaceEntity(
          props.cards,
          await props.data.repository.upsertCard({
            ...card,
            ...change,
            updatedAt: now(),
          }),
        ),
      );
      props.onSuccess?.(strings.cardSaved);
    } catch (error) {
      props.onError(message(error));
    }
  };
  const trash = async () => {
    try {
      await props.data.repository.softDelete('card', card.id);
      props.onCardsChange(await props.data.repository.listCards());
      props.offerUndo?.({
        label: strings.trashedCards(1),
        undo: async () => {
          await props.data.repository.restore('card', card.id);
          props.onCardsChange(await props.data.repository.listCards());
        },
      });
    } catch (error) {
      props.onError(message(error));
    }
  };
  const open = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    event.preventDefault();
    try {
      const opened = await openCard(
        props.data.repository,
        card,
        event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey,
      );
      props.onCardsChange(replaceEntity(props.cards, opened));
    } catch (error) {
      props.onError(message(error));
    }
  };
  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      data-deck="card"
      data-card-id={card.id}
      className="deck-card"
      data-done={card.done || undefined}
      data-dragging={isDragging || undefined}
      data-drag-over={isOver || undefined}
      {...attributes}
      {...listeners}
    >
      <FaviconTile url={card.url} hostname={card.hostname} />
      <a
        href={card.url}
        onClick={(event) => void open(event)}
        onAuxClick={(event) => void open(event)}
      >
        <strong>{card.title}</strong>
        <small>{card.hostname}</small>
      </a>
      <div className="deck-card__actions">
        <button
          type="button"
          aria-label={strings.editNote}
          onClick={() => onEditNote(card)}
        >
          {card.note ? '●' : '✎'}
        </button>
        <button
          type="button"
          aria-label={strings.markDone}
          onClick={() => void update({ done: !card.done })}
        >
          ✓
        </button>
        <button
          type="button"
          aria-label={strings.trashCard}
          onClick={() => void trash()}
        >
          ×
        </button>
      </div>
    </article>
  );
}

function DeckMenu({
  deck,
  pages,
  cards,
  allCards,
  repository,
  onCardsChange,
  saveDeck,
  onEditNote,
  onTrash,
  onError,
}: {
  deck: Deck;
  pages: Page[];
  cards: Card[];
  allCards: Card[];
  repository: SurfaceData['repository'];
  onCardsChange: (cards: Card[]) => void;
  saveDeck: (change: Partial<Deck>) => Promise<void>;
  onEditNote: (deck: Deck) => void;
  onTrash: () => void;
  onError: (value: string) => void;
}) {
  const openAll = async () => {
    try {
      const allowed = await chrome.permissions.request({
        permissions: ['tabs'],
      });
      if (!allowed) return onError(strings.tabsPermissionDeclined);
      const opened = await Promise.all(
        cards.map((card) => markOpened(repository, card)),
      );
      const byId = new Map(opened.map((card) => [card.id, card]));
      onCardsChange(allCards.map((card) => byId.get(card.id) ?? card));
      await Promise.all(
        cards.map(({ url }) => chrome.tabs.create({ url, active: false })),
      );
    } catch (error) {
      onError(message(error));
    }
  };
  return (
    <div className="deck-menu" role="menu">
      <button type="button" onClick={() => void renameDeck(deck, saveDeck)}>
        {strings.renameDeck}
      </button>
      <button type="button" onClick={() => onEditNote(deck)}>
        {strings.editDeckNote}
      </button>
      <button type="button" onClick={() => void openAll()}>
        {strings.openAll}
      </button>
      <label>
        {strings.deckColor}
        <select
          value={deck.color ?? ''}
          onChange={(event) =>
            void saveDeck({ color: event.target.value || null })
          }
        >
          <option value="">{strings.defaultColor}</option>
          {DECK_COLORS.map((color) => (
            <option key={color}>{color}</option>
          ))}
        </select>
      </label>
      <label>
        {strings.moveToPage}
        <select
          value={deck.pageId}
          onChange={(event) => void saveDeck({ pageId: event.target.value })}
        >
          {pages
            .filter(({ deletedAt }) => deletedAt === null)
            .map((page) => (
              <option value={page.id} key={page.id}>
                {page.title}
              </option>
            ))}
        </select>
      </label>
      {deck.kind === 'normal' ? (
        <button type="button" onClick={onTrash}>
          {strings.trashDeck}
        </button>
      ) : null}
    </div>
  );
}

async function renameDeck(
  deck: Deck,
  saveDeck: (change: Partial<Deck>) => Promise<void>,
) {
  const title = window.prompt(strings.renameDeckPrompt, deck.title)?.trim();
  if (title && title !== deck.title) await saveDeck({ title });
}
async function trashDeck(deck: Deck, props: Props) {
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
