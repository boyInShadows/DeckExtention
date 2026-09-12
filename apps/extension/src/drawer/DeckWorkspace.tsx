import type { Card, Deck, Page } from 'deck-schema';
import { generateKeyBetween } from 'fractional-indexing';
import { useMemo, useState } from 'react';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { strings } from '../i18n/strings';
import type { SurfaceData } from '../newtab/bootstrap';
import {
  activeCards,
  activeDecks,
  parseCardUrl,
  replaceEntity,
} from './workspaceModel';
import { dragId } from './dragIdentity';

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
    } catch (error) {
      props.onError(message(error));
    }
  };
  if (!props.selectedPageId)
    return <p className="deck-workspace__empty">{strings.selectPage}</p>;
  return (
    <main data-deck="decks" className="deck-workspace">
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
          onClick={() => void addDeck()}
        >
          {strings.addDeck}
        </button>
      </div>
      {noteEntity ? (
        <NotePanel
          entity={noteEntity}
          repository={props.data.repository}
          onClose={() => setNoteEntity(null)}
          onError={props.onError}
          onSaved={(saved) => {
            if ('deckId' in saved)
              props.onCardsChange(replaceEntity(props.cards, saved));
            else props.onDecksChange(replaceEntity(props.decks, saved));
            setNoteEntity(saved);
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
      props.onDecksChange(
        replaceEntity(
          props.decks,
          await props.data.repository.upsertDeck({
            ...deck,
            ...change,
            updatedAt: now(),
          }),
        ),
      );
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
          saveDeck={saveDeck}
          onEditNote={onEditNote}
          onTrash={() => void trashDeck(deck, props)}
          onError={props.onError}
        />
      ) : null}
      {!deck.isCollapsed ? (
        <>
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
                  autoFocus
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={strings.pasteUrl}
                  aria-label={strings.pasteUrl}
                />
              </form>
            ) : (
              <button type="button" onClick={() => setIsAdding(true)}>
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
    } catch (error) {
      props.onError(message(error));
    }
  };
  const trash = async () => {
    try {
      await props.data.repository.softDelete('card', card.id);
      props.onCardsChange(props.cards.filter(({ id }) => id !== card.id));
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
      className="deck-card"
      data-done={card.done || undefined}
      data-dragging={isDragging || undefined}
      data-drag-over={isOver || undefined}
      {...attributes}
      {...listeners}
    >
      <img
        src={`/_favicon/?pageUrl=${encodeURIComponent(card.url)}&size=32`}
        alt=""
      />
      <a href={card.url}>
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
  saveDeck,
  onEditNote,
  onTrash,
  onError,
}: {
  deck: Deck;
  pages: Page[];
  cards: Card[];
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

function NotePanel({
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
  const save = async () => {
    try {
      const value = { ...entity, note: note || undefined, updatedAt: now() };
      onSaved(
        'deckId' in value
          ? await repository.upsertCard(value)
          : await repository.upsertDeck(value),
      );
    } catch (error) {
      onError(message(error));
    }
  };
  return (
    <aside data-deck="note" className="deck-note-panel">
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
          autoFocus
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

async function renameDeck(
  deck: Deck,
  saveDeck: (change: Partial<Deck>) => Promise<void>,
) {
  const title = window.prompt(strings.renameDeckPrompt, deck.title)?.trim();
  if (title && title !== deck.title) await saveDeck({ title });
}
async function trashDeck(deck: Deck, props: Props) {
  try {
    await props.data.repository.softDelete('deck', deck.id);
    props.onDecksChange(props.decks.filter(({ id }) => id !== deck.id));
  } catch (error) {
    props.onError(message(error));
  }
}
