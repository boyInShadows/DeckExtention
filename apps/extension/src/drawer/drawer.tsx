import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card, Deck, Page } from 'deck-schema';
import { generateKeyBetween } from 'fractional-indexing';
import { useEffect, useMemo, useRef, useState } from 'react';

import { strings } from '../i18n/strings';
import type { SurfaceData } from '../newtab/bootstrap';
import {
  activePages,
  DRAWER_PAGE_KEY,
  DRAWER_SCROLL_KEY,
  INBOX_PAGE_ID,
  restoredScroll,
  selectedPageId,
} from './drawerModel';
import { DeckWorkspace } from './DeckWorkspace';
import { dragId } from './dragIdentity';
import { handleWorkspaceDrop } from './workspaceDrop';
import { WORKSPACE_DROP_EVENT, type WorkspaceDropDetail } from './WorkspaceDnd';

function currentTimestamp(): number {
  return Date.now();
}

interface DrawerProps {
  cards: Card[];
  data: SurfaceData;
  decks: Deck[];
  isOpen: boolean;
  pages: Page[];
  onCardsChange: (cards: Card[]) => void;
  onClose: () => void;
  onDecksChange: (decks: Deck[]) => void;
  onError: (message: string) => void;
  onPagesChange: (pages: Page[]) => void;
}

function SortablePage({
  page,
  isSelected,
  onSelect,
  onRename,
}: {
  page: Page;
  isSelected: boolean;
  onSelect: () => void;
  onRename: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: dragId('page', page.id) });
  return (
    <button
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      type="button"
      data-deck="page"
      data-selected={isSelected || undefined}
      data-dragging={isDragging || undefined}
      data-drag-over={isOver || undefined}
      onClick={onSelect}
      onDoubleClick={onRename}
      {...attributes}
      {...listeners}
    >
      {page.title}
    </button>
  );
}

export default function Drawer({
  data,
  pages,
  decks,
  cards,
  isOpen,
  onClose,
  onError,
  onPagesChange,
  onDecksChange,
  onCardsChange,
}: DrawerProps) {
  const [isPagesLoaded, setIsPagesLoaded] = useState(false);
  const orderedPages = useMemo(() => activePages(pages), [pages]);
  const [selectedId, setSelectedId] = useState(() =>
    selectedPageId(pages, sessionStorage.getItem(DRAWER_PAGE_KEY)),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const inbox = decks.find((deck) => deck.kind === 'inbox');
  const inboxCount = cards.filter(
    (card) => inbox && card.deckId === inbox.id && card.deletedAt === null,
  ).length;

  const selectPage = (id: string) => {
    setSelectedId(id);
    sessionStorage.setItem(DRAWER_PAGE_KEY, id);
  };

  useEffect(() => {
    const onDrop = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      void handleWorkspaceDrop(event.detail as WorkspaceDropDetail, {
        cards,
        decks,
        pages,
        repository: data.repository,
        onCardsChange,
        onDecksChange,
        onPagesChange,
        onError,
      });
    };
    window.addEventListener(WORKSPACE_DROP_EVENT, onDrop);
    return () => window.removeEventListener(WORKSPACE_DROP_EVENT, onDrop);
  }, [
    cards,
    data.repository,
    decks,
    onCardsChange,
    onDecksChange,
    onError,
    onPagesChange,
    pages,
  ]);

  useEffect(() => {
    void Promise.all([
      data.repository.listPages(),
      data.repository.listDecks(),
      data.repository.listCards(),
    ])
      .then(([storedPages, storedDecks, storedCards]) => {
        onPagesChange(storedPages);
        onDecksChange(storedDecks);
        onCardsChange(storedCards);
        setSelectedId(
          selectedPageId(storedPages, sessionStorage.getItem(DRAWER_PAGE_KEY)),
        );
        setIsPagesLoaded(true);
      })
      .catch((pageError: unknown) => onError(errorMessage(pageError)));
  }, [data.repository, onCardsChange, onDecksChange, onError, onPagesChange]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !isPagesLoaded) return;
    container.scrollTop = restoredScroll(
      sessionStorage.getItem(DRAWER_SCROLL_KEY),
    );
  }, [isPagesLoaded]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || !/^Digit[1-9]$/.test(event.code)) return;
      const index = Number(event.code.at(-1)) - 1;
      const page = orderedPages[index];
      if (page) selectPage(page.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const addPage = async () => {
    try {
      const now = currentTimestamp();
      const page = await data.repository.upsertPage({
        id: crypto.randomUUID(),
        title: strings.newPage,
        order: generateKeyBetween(orderedPages.at(-1)?.order ?? null, null),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      onPagesChange([...pages, page]);
      selectPage(page.id);
    } catch (pageError) {
      onError(errorMessage(pageError));
    }
  };

  const renamePage = async (page: Page) => {
    const title = window.prompt(strings.renamePagePrompt, page.title)?.trim();
    if (!title || title === page.title) return;
    try {
      const saved = await data.repository.upsertPage({
        ...page,
        title,
        updatedAt: currentTimestamp(),
      });
      onPagesChange(pages.map((item) => (item.id === saved.id ? saved : item)));
    } catch (pageError) {
      onError(errorMessage(pageError));
    }
  };

  return (
    <section
      data-deck="drawer"
      className="deck-drawer"
      data-open={isOpen || undefined}
      aria-label={strings.drawer}
    >
      <aside data-deck="pages" className="deck-pages">
        <header>
          <h2>{strings.pages}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={strings.closeDrawer}
          >
            ×
          </button>
        </header>
        <button
          type="button"
          data-deck="page"
          data-system
          onClick={() => selectPage(INBOX_PAGE_ID)}
          data-selected={selectedId === INBOX_PAGE_ID || undefined}
        >
          <span>{strings.inbox}</span>
          {inboxCount ? <small>{inboxCount}</small> : null}
        </button>
        <div
          ref={scrollRef}
          className="deck-pages__scroll"
          onScroll={(event) =>
            sessionStorage.setItem(
              DRAWER_SCROLL_KEY,
              String(event.currentTarget.scrollTop),
            )
          }
        >
          <SortableContext
            items={orderedPages.map(({ id }) => dragId('page', id))}
            strategy={verticalListSortingStrategy}
          >
            {orderedPages.map((page) => (
              <SortablePage
                key={page.id}
                page={page}
                isSelected={selectedId === page.id}
                onSelect={() => selectPage(page.id)}
                onRename={() => void renamePage(page)}
              />
            ))}
          </SortableContext>
        </div>
        <button
          type="button"
          data-deck="page-add"
          onClick={() => void addPage()}
          aria-label={strings.addPage}
        >
          +
        </button>
      </aside>
      <DeckWorkspace
        data={data}
        pages={pages}
        decks={decks}
        cards={cards}
        selectedPageId={
          selectedId === INBOX_PAGE_ID ? (inbox?.pageId ?? null) : selectedId
        }
        selectedDeckKind={selectedId === INBOX_PAGE_ID ? 'inbox' : undefined}
        onDecksChange={onDecksChange}
        onCardsChange={onCardsChange}
        onError={onError}
      />
    </section>
  );
}

function errorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${strings.updateFailed} ${detail}`;
}
