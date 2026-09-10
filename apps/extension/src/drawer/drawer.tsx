import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Page } from 'deck-schema';
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

function currentTimestamp(): number {
  return Date.now();
}

interface DrawerProps {
  data: SurfaceData;
  isOpen: boolean;
  onClose: () => void;
  onError: (message: string) => void;
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
  } = useSortable({ id: page.id });
  return (
    <button
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      type="button"
      data-deck="page"
      data-selected={isSelected || undefined}
      data-dragging={isDragging || undefined}
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
  isOpen,
  onClose,
  onError,
}: DrawerProps) {
  const [pages, setPages] = useState(data.pages);
  const [isPagesLoaded, setIsPagesLoaded] = useState(false);
  const orderedPages = useMemo(() => activePages(pages), [pages]);
  const [selectedId, setSelectedId] = useState(() =>
    selectedPageId(pages, sessionStorage.getItem(DRAWER_PAGE_KEY)),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const inbox = data.decks.find((deck) => deck.kind === 'inbox');
  const inboxCount = data.cards.filter(
    (card) => inbox && card.deckId === inbox.id && card.deletedAt === null,
  ).length;

  const selectPage = (id: string) => {
    setSelectedId(id);
    sessionStorage.setItem(DRAWER_PAGE_KEY, id);
  };

  useEffect(() => {
    void data.repository
      .listPages()
      .then((storedPages) => {
        setPages(storedPages);
        setSelectedId(
          selectedPageId(storedPages, sessionStorage.getItem(DRAWER_PAGE_KEY)),
        );
        setIsPagesLoaded(true);
      })
      .catch((pageError: unknown) => onError(errorMessage(pageError)));
  }, [data.repository, onError]);

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
      setPages((current) => [...current, page]);
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
      setPages((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
    } catch (pageError) {
      onError(errorMessage(pageError));
    }
  };

  const finishDrag = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const reordered = arrayMove(
      orderedPages,
      orderedPages.findIndex(({ id }) => id === active.id),
      orderedPages.findIndex(({ id }) => id === over.id),
    );
    const index = reordered.findIndex(({ id }) => id === active.id);
    const moved = reordered[index];
    if (!moved) return;
    try {
      const saved = await data.repository.upsertPage({
        ...moved,
        order: generateKeyBetween(
          reordered[index - 1]?.order ?? null,
          reordered[index + 1]?.order ?? null,
        ),
        updatedAt: currentTimestamp(),
      });
      setPages((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={finishDrag}
          >
            <SortableContext
              items={orderedPages}
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
          </DndContext>
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
      <div data-deck="drawer-content" className="deck-drawer__content" />
    </section>
  );
}

function errorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${strings.updateFailed} ${detail}`;
}
