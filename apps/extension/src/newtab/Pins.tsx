import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card } from 'deck-schema';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

import { strings } from '../i18n/strings';
import type { UndoAction } from '../drawer/UndoToast';
import { dragId } from '../drawer/dragIdentity';
import { useDropHighlight } from '../drawer/useDropHighlight';
import {
  WORKSPACE_DROP_EVENT,
  type WorkspaceDropDetail,
} from '../drawer/WorkspaceDnd';
import type { SurfaceData } from './bootstrap';
import type { NoticeInput } from './ToastStack';

const MAX_PINS = 12;
const PinMenu = lazy(() => import('./PinMenu'));
const PinAddForm = lazy(() => import('./PinAddForm'));
const FaviconTile = lazy(() => import('./FaviconTile'));

interface PinsProps {
  cards: Card[];
  repository: SurfaceData['repository'];
  onCardsChange: (cards: Card[]) => void;
  offerUndo?: (action: UndoAction) => void;
  notify: (notice: NoticeInput) => void;
}

function SortablePin({
  card,
  onMenu,
  onOpen,
  onUnpin,
}: {
  card: Card;
  onMenu: (card: Card, anchor: HTMLElement) => void;
  onOpen: (card: Card, isNewTab: boolean) => void;
  onUnpin: (card: Card) => void;
}) {
  const label = card.pinLabel ?? card.title;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: dragId('pin', card.id) });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    event.preventDefault();
    onOpen(
      card,
      event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey,
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (
      event.key === 'ContextMenu' ||
      (event.shiftKey && event.key === 'F10')
    ) {
      event.preventDefault();
      onMenu(card, event.currentTarget);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      onUnpin(card);
    } else if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      onOpen(card, true);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const tiles = [
        ...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
          '[data-deck="pin"]',
        ) ?? []),
      ];
      const index = tiles.indexOf(event.currentTarget);
      const next = tiles[index + (event.key === 'ArrowRight' ? 1 : -1)];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    }
  };
  return (
    <a
      ref={setNodeRef}
      style={style}
      data-deck="pin"
      className="deck-pin"
      href={card.url}
      draggable={false}
      aria-label={label}
      aria-haspopup="menu"
      data-dragging={isDragging || undefined}
      {...attributes}
      {...listeners}
      onClick={open}
      onAuxClick={open}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(card, event.currentTarget);
      }}
      onKeyDown={(event) => {
        onKeyDown(event);
        if (!event.defaultPrevented) listeners?.onKeyDown?.(event);
      }}
    >
      <span className="deck-pin__tile">
        {card.pinIcon ? (
          <span className="deck-pin__emoji" aria-hidden="true">
            {card.pinIcon}
          </span>
        ) : (
          <Suspense
            fallback={
              <span className="deck-site-icon">
                {card.hostname.replace(/^www\./, '')[0]?.toUpperCase()}
              </span>
            }
          >
            <FaviconTile url={card.url} hostname={card.hostname} />
          </Suspense>
        )}
      </span>
      <span className="deck-pin__label deck-blurrable">{label}</span>
    </a>
  );
}

export function Pins({
  cards,
  repository,
  onCardsChange,
  offerUndo,
  notify,
}: PinsProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [menu, setMenu] = useState<{ card: Card; anchor: HTMLElement } | null>(
    null,
  );
  const [initialUrl, setInitialUrl] = useState('');
  const { setNodeRef } = useDroppable({ id: dragId('pin', 'strip') });
  const isOver = useDropHighlight(dragId('pin', 'strip'));
  const pins = useMemo(
    () =>
      cards
        .filter((card) => card.pinned && card.deletedAt === null)
        .toSorted((a, b) =>
          a.order < b.order ? -1 : a.order > b.order ? 1 : 0,
        ),
    [cards],
  );
  const reportWriteError = useCallback(
    (error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      notify({ kind: 'error', text: `${strings.updateFailed} ${detail}` });
    },
    [notify],
  );
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input, textarea, [contenteditable], [data-deck="drawer"], [data-deck="settings"], [data-deck="help"]',
        )
      )
        return;
      const candidate = event.clipboardData?.getData('text/plain').trim() ?? '';
      if (!/^https?:\/\//i.test(candidate)) return;
      if (pins.length >= MAX_PINS) return;
      event.preventDefault();
      setInitialUrl(candidate);
      setIsAdding(true);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [pins.length]);

  const open = async (card: Card, isNewTab: boolean) => {
    try {
      const { openPin } = await import('./pinUndo');
      await openPin(repository, card, isNewTab);
    } catch (openError) {
      reportWriteError(openError);
    }
  };

  useEffect(() => {
    const onDrop = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      void import('./reorderPin')
        .then(({ reorderPin }) =>
          reorderPin(repository, pins, event.detail as WorkspaceDropDetail),
        )
        .then((saved) => {
          if (!saved) return;
          onCardsChange(
            cards.map((item) => (item.id === saved.id ? saved : item)),
          );
          notify({ kind: 'success', text: strings.saved });
        })
        .catch(reportWriteError);
    };
    window.addEventListener(WORKSPACE_DROP_EVENT, onDrop);
    return () => window.removeEventListener(WORKSPACE_DROP_EVENT, onDrop);
  }, [cards, notify, onCardsChange, pins, reportWriteError, repository]);

  const savePin = async (
    card: Card,
    change: Partial<Card>,
  ): Promise<boolean> => {
    try {
      const { updatePin } = await import('./pinUndo');
      await updatePin(
        repository,
        card,
        change,
        cards,
        onCardsChange,
        offerUndo,
      );
      if (!('pinned' in change && change.pinned === false))
        notify({ kind: 'success', text: strings.saved });
      return true;
    } catch (saveError) {
      reportWriteError(saveError);
      return false;
    }
  };

  return (
    <section
      ref={setNodeRef}
      data-deck="pins"
      className="deck-pins"
      aria-label={strings.pinsLabel}
      data-drag-over={isOver || undefined}
    >
      <SortableContext
        items={pins.map(({ id }) => dragId('pin', id))}
        strategy={horizontalListSortingStrategy}
      >
        {pins.map((card) => (
          <SortablePin
            key={card.id}
            card={card}
            onMenu={(card, anchor) => setMenu({ card, anchor })}
            onOpen={(item, isNewTab) => void open(item, isNewTab)}
            onUnpin={(card) => void savePin(card, { pinned: false })}
          />
        ))}
      </SortableContext>
      {pins.length < MAX_PINS ? (
        isAdding ? (
          <Suspense>
            <PinAddForm
              key={initialUrl}
              cards={cards}
              pins={pins}
              initialUrl={initialUrl}
              repository={repository}
              onCardsChange={onCardsChange}
              onClose={() => {
                setIsAdding(false);
                setInitialUrl('');
              }}
              notify={notify}
            />
          </Suspense>
        ) : (
          <button
            data-deck="pin-add"
            className="deck-pin-add"
            type="button"
            onClick={() => {
              setInitialUrl('');
              setIsAdding(true);
            }}
            aria-label={strings.addPin}
            title={strings.addPin}
          >
            <span aria-hidden="true">+</span>
          </button>
        )
      ) : (
        <button
          data-deck="pin-add"
          className="deck-pin-add"
          type="button"
          disabled
          title={strings.pinLimit}
          aria-label={strings.pinLimit}
        >
          <span aria-hidden="true">+</span>
        </button>
      )}
      {!pins.length && !isAdding && (
        <p data-deck="pins-empty">{strings.pinsEmptyHint}</p>
      )}
      <Suspense>
        {menu ? (
          <PinMenu
            card={menu.card}
            anchor={menu.anchor}
            onClose={() => setMenu(null)}
            onUpdate={(change) => savePin(menu.card, change)}
          />
        ) : null}
      </Suspense>
    </section>
  );
}
