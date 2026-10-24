import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import type { Card, Deck, Page } from 'deck-schema';
import { generateKeyBetween } from 'fractional-indexing';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import { Icon } from '../newtab/Icon';
import { downloadExport } from '../newtab/downloadExport';
import { playSpring } from '../motion/spring';
import {
  activePages,
  DRAWER_PAGE_KEY,
  DRAWER_SCROLL_KEY,
  DRAWER_CONTENT_SCROLL_KEY,
  INBOX_PAGE_ID,
  TRASH_PAGE_ID,
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
import { TrashView } from './TrashView';
import { dragId } from './dragIdentity';
import { handleWorkspaceDrop } from './workspaceDrop';
import { WORKSPACE_DROP_EVENT, type WorkspaceDropDetail } from './WorkspaceDnd';
import { NotePanel, type NotePanelHandle } from './NotePanel';
import { replaceEntity } from './workspaceModel';
import { SystemPages } from './SystemPages';
import { SESSIONS_PAGE_ID } from '../sessions/constants';
import { useRequestedNote } from './useRequestedNote';
import type { DrawerProps } from './DrawerProps';
import { PageDeleteSheet } from './PageDeleteSheet';
import { TaskManager } from '../tasks/TaskManager';
import { TASKS_PAGE_ID } from '../tasks/constants';

function currentTimestamp(): number {
  return Date.now();
}

function focusPageName(element: HTMLInputElement | null): void {
  element?.focus();
  element?.select();
}

function SortablePage({
  page,
  isSelected,
  onSelect,
  onRename,
  onDelete,
  isEditing,
  editValue,
  onEditValue,
  onCommit,
  onCancel,
}: {
  page: Page;
  isSelected: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  isEditing: boolean;
  editValue: string;
  onEditValue: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
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
  if (isEditing)
    return (
      <input
        ref={focusPageName}
        data-deck="page-name"
        aria-label={strings.renamePagePrompt}
        value={editValue}
        onChange={(event) => onEditValue(event.currentTarget.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit();
          if (event.key === 'Escape') onCancel();
        }}
      />
    );
  return (
    <button
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      type="button"
      data-deck="page"
      data-page-glyph={page.title.charAt(0).toUpperCase()}
      aria-label={page.title}
      className="deck-blurrable"
      data-selected={isSelected || undefined}
      data-dragging={isDragging || undefined}
      data-drag-over={isOver || undefined}
      onClick={onSelect}
      onDoubleClick={onRename}
      onKeyDown={(event) => {
        if (event.key === 'F2') {
          event.preventDefault();
          onRename();
        }
        if (event.key === 'Delete') {
          event.preventDefault();
          onDelete();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onDelete();
      }}
      {...attributes}
      {...listeners}
    >
      <span className="deck-pages__label">{page.title}</span>
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
  onSuccess,
  onPagesChange,
  onDecksChange,
  onCardsChange,
  offerUndo,
  beforeCloseRef,
  requestedNote,
  onNoteOpened,
  initialPageId: workspacePageId,
  initialEditingDeckId,
  onPageSelect,
  navigationRequest,
}: DrawerProps) {
  const initialPageId = workspacePageId ?? navigationRequest?.pageId;
  const keymap = useMemo(
    () => resolveKeymap(keymapOverrides),
    [keymapOverrides],
  );
  const [isPagesLoaded, setIsPagesLoaded] = useState(false);
  const [deletingPage, setDeletingPage] = useState<Page | null>(null);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState('');
  const [noteEntity, setNoteEntity] = useState<Deck | Card | null>(null);
  const noteRef = useRef<NotePanelHandle>(null);
  const orderedPages = useMemo(() => activePages(pages), [pages]);
  const [selectedId, setSelectedId] = useState(() =>
    selectedPageId(pages, initialPageId ?? requestedPageId()),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerAnimation = useRef<Animation | null>(null);

  useEffect(() => onPageSelect?.(selectedId), [onPageSelect, selectedId]);

  useLayoutEffect(() => {
    drawerAnimation.current?.cancel();
    if (drawerRef.current)
      drawerAnimation.current = playSpring(drawerRef.current, isOpen, '100%');
  }, [isOpen]);

  useEffect(() => () => drawerAnimation.current?.cancel(), []);
  const inbox = decks.find((deck) => deck.kind === 'inbox');
  const inboxCount = cards.filter(
    (card) =>
      inbox &&
      card.deckId === inbox.id &&
      card.deletedAt === null &&
      !card.pinned,
  ).length;

  const flushNote = useCallback(async (): Promise<boolean> => {
    if (!noteEntity) return true;
    return (await noteRef.current?.flush()) ?? false;
  }, [noteEntity]);
  const closeNote = () => {
    const entity = noteEntity;
    setNoteEntity(null);
    requestAnimationFrame(() => {
      const target =
        selectedId === TASKS_PAGE_ID && entity && 'deckId' in entity
          ? `[data-task-id="${window.CSS.escape(entity.id)}"] [data-deck="task-note"]`
          : selectedId === INBOX_PAGE_ID
            ? '[data-deck="inbox"] [role="listbox"]'
            : entity && 'deckId' in entity
              ? `[data-card-id="${window.CSS.escape(entity.id)}"]`
              : entity
                ? `[data-deck-id="${window.CSS.escape(entity.id)}"] [data-deck="deck-title"]`
                : null;
      if (target)
        drawerRef.current?.querySelector<HTMLElement>(target)?.focus();
    });
  };
  useLayoutEffect(() => {
    if (beforeCloseRef)
      beforeCloseRef.current = async () => {
        const didSave = await flushNote();
        if (didSave) setNoteEntity(null);
        return didSave;
      };
    return () => {
      if (beforeCloseRef) beforeCloseRef.current = null;
    };
  }, [beforeCloseRef, flushNote]);
  const selectPage = useCallback(
    async (id: string) => {
      if (!(await flushNote())) return false;
      setNoteEntity(null);
      setSelectedId(id);
      localStorage.setItem(DRAWER_PAGE_KEY, id);
      return true;
    },
    [flushNote],
  );
  useRequestedNote({
    repository: data.repository,
    requestedNote,
    decks,
    isEnabled: isOpen && isPagesLoaded,
    selectPage,
    onOpen: setNoteEntity,
    onOpened: onNoteOpened,
    onError,
  });
  useEffect(() => {
    if (!noteEntity || !isOpen) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (
        event.target.closest(
          '[data-deck="note"], [data-deck="pages"], [data-deck="drawer-close"], [data-deck="section-nav"]',
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      void flushNote().then((didSave) => {
        if (didSave) setNoteEntity(null);
      });
    };
    document.addEventListener('click', dismiss, true);
    return () => document.removeEventListener('click', dismiss, true);
  }, [flushNote, isOpen, noteEntity]);

  // Opening hands the drawer the keyboard (a key typed next must reach the
  // grid, not the Line where Space or Ctrl+J was pressed); closing takes it
  // back at once, so no card acts during the 320 ms exit animation.
  useLayoutEffect(() => {
    const focused = document.activeElement;
    const drawer = document.querySelector('[data-deck="drawer"]');
    const isInside = drawer?.contains(focused) ?? false;
    if (focused instanceof HTMLElement && isInside !== isOpen) focused.blur();
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (
        isTypingTarget(event.target) &&
        (event.target as HTMLElement).dataset.deck !== 'task-input'
      )
        return;
      if (document.querySelector('[data-dragging]')) return;
      if ((event.target as HTMLElement)?.dataset?.deck?.endsWith('-drag'))
        return;
      void onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, onClose]);

  // A `#page=` link is used once, then becomes the remembered page, so a
  // reload of this tab starts calm instead of reopening the drawer.
  useEffect(() => {
    if (initialPageId) localStorage.setItem(DRAWER_PAGE_KEY, initialPageId);
    const linked = pageIdFromHash(location.hash);
    if (!linked) return;
    if (linked !== 'last') localStorage.setItem(DRAWER_PAGE_KEY, linked);
    history.replaceState(null, '', location.pathname);
  }, [initialPageId, navigationRequest]);

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
        onSuccess,
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
    onSuccess,
    onPagesChange,
    pages,
  ]);

  useEffect(() => {
    void data.repository
      .expireSessions()
      .then(() =>
        Promise.all([
          data.repository.listPages(),
          data.repository.listDecks(),
          data.repository.listCards(),
        ]),
      )
      .then(([storedPages, storedDecks, storedCards]) => {
        onPagesChange(storedPages);
        onDecksChange(storedDecks);
        onCardsChange(storedCards);
        setSelectedId(
          selectedPageId(storedPages, initialPageId ?? requestedPageId()),
        );
        setIsPagesLoaded(true);
      })
      .catch((pageError: unknown) => onError(errorMessage(pageError)));
  }, [
    data.repository,
    initialPageId,
    navigationRequest,
    onCardsChange,
    onDecksChange,
    onError,
    onPagesChange,
  ]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !isPagesLoaded) return;
    container.scrollTop = restoredScroll(
      localStorage.getItem(DRAWER_SCROLL_KEY),
    );
  }, [isPagesLoaded]);

  useEffect(() => {
    if (!isPagesLoaded) return;
    const content = document.querySelector<HTMLElement>('[data-deck="decks"]');
    if (content)
      content.scrollTop = restoredScroll(
        localStorage.getItem(DRAWER_CONTENT_SCROLL_KEY),
      );
  }, [isPagesLoaded]);

  useLayoutEffect(() => {
    // The Inbox is the rail's first stop, then the user pages in order.
    const railIds = [
      INBOX_PAGE_ID,
      SESSIONS_PAGE_ID,
      TASKS_PAGE_ID,
      TRASH_PAGE_ID,
      ...orderedPages.map(({ id }) => id),
    ];
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
      if (action === 'export') {
        event.preventDefault();
        void downloadExport(data.repository)
          .then(() => onSuccess?.(strings.exportSaved))
          .catch((error: unknown) =>
            onError(error instanceof Error ? error.message : String(error)),
          );
        return;
      }
      if (action !== 'nextPage' && action !== 'previousPage') return;
      event.preventDefault();
      const index = selectedId === null ? -1 : railIds.indexOf(selectedId);
      const step = action === 'nextPage' ? 1 : -1;
      const target =
        railIds[Math.min(Math.max(index + step, 0), railIds.length - 1)];
      if (target) selectPage(target);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    data.repository,
    isOpen,
    keymap,
    onError,
    onSuccess,
    orderedPages,
    selectedId,
    selectPage,
  ]);

  const addPage = async () => {
    try {
      const now = currentTimestamp();
      const page = await data.repository.upsertPage({
        id: crypto.randomUUID(),
        title: strings.untitledPage(orderedPages.length + 1),
        order: generateKeyBetween(orderedPages.at(-1)?.order ?? null, null),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      onPagesChange([...pages, page]);
      selectPage(page.id);
      setEditingPageId(page.id);
      setPageTitle(page.title);
      onSuccess?.(strings.pageSaved);
    } catch (pageError) {
      onError(errorMessage(pageError));
    }
  };

  const renamePage = async (page: Page, proposedTitle: string) => {
    const title = proposedTitle.trim();
    if (!title || title === page.title) return;
    try {
      const saved = await data.repository.upsertPage({
        ...page,
        title,
        updatedAt: currentTimestamp(),
      });
      onPagesChange(pages.map((item) => (item.id === saved.id ? saved : item)));
      onSuccess?.(strings.pageSaved);
    } catch (pageError) {
      onError(errorMessage(pageError));
    }
  };

  const beginRename = (page: Page) => {
    setEditingPageId(page.id);
    setPageTitle(page.title);
  };

  const commitRename = (page: Page) => {
    setEditingPageId(null);
    void renamePage(page, pageTitle);
  };

  const refreshWorkspace = async () => {
    const [storedPages, storedDecks, storedCards] = await Promise.all([
      data.repository.listPages(),
      data.repository.listDecks(),
      data.repository.listCards(),
    ]);
    onPagesChange(storedPages);
    onDecksChange(storedDecks);
    onCardsChange(storedCards);
  };
  const removePage = async (page: Page, destinationId: string | null) => {
    try {
      const now = currentTimestamp();
      const otherPage = activePages(pages).find(({ id }) => id !== page.id);
      const replacement =
        destinationId ||
        otherPage?.id ||
        (
          await data.repository.upsertPage({
            id: crypto.randomUUID(),
            title: strings.newPage,
            order: generateKeyBetween(orderedPages.at(-1)?.order ?? null, null),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })
        ).id;
      const moving = decks.filter(
        (deck) =>
          deck.pageId === page.id &&
          deck.deletedAt === null &&
          (destinationId !== null || deck.kind !== 'normal'),
      );
      if (moving.length) {
        await data.repository.upsertMany({
          decks: moving.map((deck) => ({
            ...deck,
            pageId: replacement,
            updatedAt: now,
          })),
        });
      }
      if (destinationId) {
        await data.repository.softDelete('page', page.id);
      } else {
        await data.repository.trashPage(page.id);
      }
      await refreshWorkspace();
      selectPage(replacement);
      offerUndo({
        label: strings.trashedPage,
        undo: async () => {
          if (destinationId) {
            await data.repository.restore('page', page.id);
            await data.repository.upsertMany({
              decks: moving.map((deck) => ({
                ...deck,
                updatedAt: currentTimestamp(),
              })),
            });
          } else {
            await data.repository.restorePage(page.id);
          }
          await refreshWorkspace();
        },
      });
      setDeletingPage(null);
    } catch (error) {
      onError(errorMessage(error));
      await refreshWorkspace().catch((loadError: unknown) =>
        onError(errorMessage(loadError)),
      );
    }
  };

  return (
    <section
      ref={drawerRef}
      data-deck="drawer"
      className="deck-drawer"
      data-open={isOpen || undefined}
      aria-label={strings.drawer}
      onScrollCapture={(event) => {
        if ((event.target as HTMLElement).dataset.deck === 'decks')
          localStorage.setItem(
            DRAWER_CONTENT_SCROLL_KEY,
            String((event.target as HTMLElement).scrollTop),
          );
      }}
    >
      <PinDropZone />
      <button
        type="button"
        data-deck="drawer-close"
        onClick={onClose}
        aria-label={strings.closeDrawer}
        title={strings.closeDrawer}
      >
        <Icon name="close" size={20} />
      </button>
      <aside data-deck="pages" className="deck-pages">
        <header>
          <h2>{strings.pages}</h2>
        </header>
        <SystemPages
          selectedId={selectedId}
          inboxCount={inboxCount}
          sessionCount={
            decks.filter(
              ({ kind, deletedAt }) => kind === 'session' && deletedAt === null,
            ).length
          }
          selectPage={async (id) => {
            await selectPage(id);
          }}
        />
        <div
          ref={scrollRef}
          className="deck-pages__scroll"
          onScroll={(event) =>
            localStorage.setItem(
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
                onRename={() => beginRename(page)}
                isEditing={editingPageId === page.id}
                editValue={pageTitle}
                onEditValue={setPageTitle}
                onCommit={() => commitRename(page)}
                onCancel={() => setEditingPageId(null)}
                onDelete={() => setDeletingPage(page)}
              />
            ))}
          </SortableContext>
        </div>
        <button
          type="button"
          data-deck="page-add"
          onClick={() => void addPage()}
          aria-label={strings.addPage}
          title={strings.addPage}
        >
          +
        </button>
      </aside>
      {selectedId === TASKS_PAGE_ID ? (
        <TaskManager
          isOpen={isOpen}
          cards={cards}
          decks={decks}
          pages={pages}
          repository={data.repository}
          onDataChange={refreshWorkspace}
          onEditNote={setNoteEntity}
          onError={onError}
          offerUndo={offerUndo}
        />
      ) : selectedId === TRASH_PAGE_ID ? (
        <TrashView
          pages={pages}
          decks={decks}
          cards={cards}
          repository={data.repository}
          onChange={refreshWorkspace}
          onError={onError}
          onSuccess={onSuccess}
        />
      ) : selectedId === INBOX_PAGE_ID ? (
        <InboxTriage
          isOpen={isOpen}
          keymap={keymap}
          data={data}
          pages={pages}
          decks={decks}
          cards={cards}
          onCardsChange={onCardsChange}
          onEditNote={setNoteEntity}
          onError={onError}
          onSuccess={onSuccess}
          offerUndo={offerUndo}
        />
      ) : (
        <DeckWorkspace
          initialEditingDeckId={initialEditingDeckId}
          isOpen={isOpen}
          keymap={keymap}
          data={data}
          pages={pages}
          decks={decks}
          cards={cards}
          selectedPageId={selectedId}
          selectedDeckKind={
            selectedId === SESSIONS_PAGE_ID ? 'session' : 'normal'
          }
          onDecksChange={onDecksChange}
          onCardsChange={onCardsChange}
          isNoteOpen={noteEntity !== null}
          onEditNote={setNoteEntity}
          onError={onError}
          onSuccess={onSuccess}
          offerUndo={offerUndo}
        />
      )}
      {noteEntity ? (
        <NotePanel
          key={noteEntity.id}
          ref={noteRef}
          entity={noteEntity}
          repository={data.repository}
          onClose={closeNote}
          onError={onError}
          onSaved={(saved) => {
            if ('deckId' in saved) onCardsChange(replaceEntity(cards, saved));
            else onDecksChange(replaceEntity(decks, saved));
            setNoteEntity(saved);
          }}
        />
      ) : null}
      {deletingPage ? (
        <PageDeleteSheet
          page={deletingPage}
          pages={pages}
          deckCount={
            decks.filter(
              ({ pageId, deletedAt, kind }) =>
                pageId === deletingPage.id &&
                deletedAt === null &&
                kind === 'normal',
            ).length
          }
          onCancel={() => setDeletingPage(null)}
          onConfirm={(destinationId) =>
            void removePage(deletingPage, destinationId)
          }
        />
      ) : null}
    </section>
  );
}

/** A `#page=<id>` link (from Quick Save's "open Deck") beats the last page. */
function requestedPageId(): string | null {
  const linked = pageIdFromHash(location.hash);
  return linked && linked !== 'last'
    ? linked
    : localStorage.getItem(DRAWER_PAGE_KEY);
}

function errorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${strings.updateFailed} ${detail}`;
}
