import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import type { Card, Deck, KeyBinding, Page } from 'deck-schema';
import { generateKeyBetween } from 'fractional-indexing';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import type { SurfaceData } from '../newtab/bootstrap';
import {
  activePages,
  DRAWER_PAGE_KEY,
  DRAWER_SCROLL_KEY,
  INBOX_PAGE_ID,
  pageIdFromHash,
  restoredScroll,
  selectedPageId,
} from './drawerModel';
import {
  actionForChord,
  chordFromEvent,
  isTypingTarget,
  resolveKeymap,
} from '../keys/keymap';
import { DeckWorkspace } from './DeckWorkspace';
import { InboxTriage } from './InboxTriage';
import { dragId } from './dragIdentity';
import { handleWorkspaceDrop } from './workspaceDrop';
import { WORKSPACE_DROP_EVENT, type WorkspaceDropDetail } from './WorkspaceDnd';

function currentTimestamp(): number {
  return Date.now();
}

interface DrawerProps {
  /** Settings.keymap - resolved here so the keymap code stays off the surface. */
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

function PinDropZone() {
  const { isOver, setNodeRef } = useDroppable({ id: dragId('pin', 'drawer') });
  return (
    <div
      ref={setNodeRef}
      data-deck="pins-drop"
      className="deck-pins-drop"
      data-drag-over={isOver || undefined}
    >
      {strings.dropToPins}
    </div>
  );
}

export default function Drawer({
  keymapOverrides,
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
  const keymap = useMemo(
    () => resolveKeymap(keymapOverrides),
    [keymapOverrides],
  );
  const [isPagesLoaded, setIsPagesLoaded] = useState(false);
  const orderedPages = useMemo(() => activePages(pages), [pages]);
  const [selectedId, setSelectedId] = useState(() =>
    selectedPageId(pages, requestedPageId()),
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

  // Opening hands the drawer the keyboard (a key typed next must reach the
  // grid, not the Line where Space or Ctrl+J was pressed); closing takes it
  // back at once, so no card acts during the 320 ms exit animation.
  useLayoutEffect(() => {
    const focused = document.activeElement;
    const drawer = document.querySelector('[data-deck="drawer"]');
    const isInside = drawer?.contains(focused) ?? false;
    if (focused instanceof HTMLElement && isInside !== isOpen) focused.blur();
  }, [isOpen]);

  // A `#page=` link is used once, then becomes the remembered page, so a
  // reload of this tab starts calm instead of reopening the drawer.
  useEffect(() => {
    const linked = pageIdFromHash(location.hash);
    if (!linked) return;
    sessionStorage.setItem(DRAWER_PAGE_KEY, linked);
    history.replaceState(null, '', location.pathname);
  }, []);

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
        setSelectedId(selectedPageId(storedPages, requestedPageId()));
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

  useLayoutEffect(() => {
    // The Inbox is the rail's first stop, then the user pages in order.
    const railIds = [INBOX_PAGE_ID, ...orderedPages.map(({ id }) => id)];
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && /^Digit[1-9]$/.test(event.code)) {
        const page = orderedPages[Number(event.code.at(-1)) - 1];
        if (page) selectPage(page.id);
        return;
      }
      if (!isOpen || isTypingTarget(event.target)) return;
      const chord = chordFromEvent(event);
      const scope = selectedId === INBOX_PAGE_ID ? 'inbox' : 'drawer';
      const action = chord ? actionForChord(keymap, scope, chord) : null;
      if (action !== 'nextPage' && action !== 'previousPage') return;
      event.preventDefault();
      const index = railIds.indexOf(selectedId ?? INBOX_PAGE_ID);
      const step = action === 'nextPage' ? 1 : -1;
      const target =
        railIds[Math.min(Math.max(index + step, 0), railIds.length - 1)];
      if (target) selectPage(target);
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
      <PinDropZone />
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
      {selectedId === INBOX_PAGE_ID ? (
        <InboxTriage
          isOpen={isOpen}
          keymap={keymap}
          data={data}
          pages={pages}
          decks={decks}
          cards={cards}
          onCardsChange={onCardsChange}
          onError={onError}
        />
      ) : (
        <DeckWorkspace
          isOpen={isOpen}
          keymap={keymap}
          data={data}
          pages={pages}
          decks={decks}
          cards={cards}
          selectedPageId={selectedId}
          selectedDeckKind="normal"
          onDecksChange={onDecksChange}
          onCardsChange={onCardsChange}
          onError={onError}
        />
      )}
    </section>
  );
}

/** A `#page=<id>` link (from Quick Save's "open Deck") beats the last page. */
function requestedPageId(): string | null {
  return (
    pageIdFromHash(location.hash) ?? sessionStorage.getItem(DRAWER_PAGE_KEY)
  );
}

function errorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${strings.updateFailed} ${detail}`;
}
