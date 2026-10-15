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
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from 'react';

import { strings } from '../i18n/strings';
import type { UndoAction } from '../drawer/UndoToast';
import { dragId } from '../drawer/dragIdentity';
import { compareOrder } from '../drawer/workspaceModel';
import {
  WORKSPACE_DROP_EVENT,
  type WorkspaceDropDetail,
} from '../drawer/WorkspaceDnd';
import type { SurfaceData } from './bootstrap';
import type { NoticeInput } from './ToastStack';

const MAX_PINS = 12;
const FAVICON_SIZE = 64;
const PinMenu = lazy(() => import('./PinMenu'));
const PinAddForm = lazy(() => import('./PinAddForm'));

interface PinsProps {
  cards: Card[];
  defaultDeckId: string;
  repository: SurfaceData['repository'];
  onCardsChange: (cards: Card[]) => void;
  offerUndo?: (action: UndoAction) => void;
  notify: (notice: NoticeInput) => void;
}

function faviconUrl(url: string): string {
  const endpoint = chrome.runtime.getURL('/_favicon/');
  return `${endpoint}?pageUrl=${encodeURIComponent(url)}&size=${FAVICON_SIZE}`;
}

function SortablePin({
  card,
  onMenu,
  onOpen,
}: {
  card: Card;
  onMenu: (card: Card) => void;
  onOpen: (card: Card, isNewTab: boolean) => void;
}) {
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
  return (
    <a
      ref={setNodeRef}
      style={style}
      data-deck="pin"
      className="deck-pin"
      href={card.url}
      draggable={false}
      aria-label={card.pinLabel ?? card.title}
      data-dragging={isDragging || undefined}
      onClick={open}
      onAuxClick={open}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(card);
      }}
      {...attributes}
      {...listeners}
    >
      <span className="deck-pin__tile">
        {card.pinIcon ? (
          <span className="deck-pin__emoji" aria-hidden="true">
            {card.pinIcon}
          </span>
        ) : (
          <img src={faviconUrl(card.url)} alt="" width="32" height="32" />
        )}
      </span>
      <span className="deck-pin__label">{card.pinLabel ?? card.title}</span>
    </a>
  );
}

export function Pins({
  cards,
  defaultDeckId,
  repository,
  onCardsChange,
  offerUndo,
  notify,
}: PinsProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [menuCard, setMenuCard] = useState<Card | null>(null);
  const { isOver, setNodeRef } = useDroppable({ id: dragId('pin', 'strip') });
  const pins = useMemo(
    () =>
      cards
        .filter((card) => card.pinned && card.deletedAt === null)
        .toSorted((a, b) => compareOrder(a.order, b.order)),
    [cards],
  );
  const reportWriteError = (error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    notify({ kind: 'error', text: `${strings.updateFailed} ${detail}` });
  };

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
  });

  const updateMenuCard = async (change: Partial<Card>) => {
    if (!menuCard) return;
    try {
      const { updatePin } = await import('./pinUndo');
      await updatePin(
        repository,
        menuCard,
        change,
        cards,
        onCardsChange,
        offerUndo,
      );
      setMenuCard(null);
      if (!('pinned' in change && change.pinned === false))
        notify({ kind: 'success', text: strings.saved });
    } catch (saveError) {
      reportWriteError(saveError);
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
            onMenu={setMenuCard}
            onOpen={(item, isNewTab) => void open(item, isNewTab)}
          />
        ))}
      </SortableContext>
      {pins.length < MAX_PINS ? (
        isAdding ? (
          <Suspense fallback={null}>
            <PinAddForm
              cards={cards}
              pins={pins}
              defaultDeckId={defaultDeckId}
              repository={repository}
              onCardsChange={onCardsChange}
              onClose={() => setIsAdding(false)}
              notify={notify}
            />
          </Suspense>
        ) : (
          <button
            data-deck="pin-add"
            className="deck-pin-add"
            type="button"
            onClick={() => setIsAdding(true)}
            aria-label={strings.addPin}
          >
            <span aria-hidden="true">+</span>
          </button>
        )
      ) : null}
      <Suspense fallback={null}>
        {menuCard ? (
          <PinMenu card={menuCard} onUpdate={updateMenuCard} />
        ) : null}
      </Suspense>
    </section>
  );
}
