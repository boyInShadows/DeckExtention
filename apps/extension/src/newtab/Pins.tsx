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
import { dragId, parseDragId } from '../drawer/dragIdentity';
import { fractionalOrderForMove } from '../drawer/fractionalOrder';
import { compareOrder } from '../drawer/workspaceModel';
import {
  WORKSPACE_DROP_EVENT,
  type WorkspaceDropDetail,
} from '../drawer/WorkspaceDnd';
import type { SurfaceData } from './bootstrap';
import { focusOnMount } from './focusOnMount';

const MAX_PINS = 12;
const FAVICON_SIZE = 64;
const PinMenu = lazy(() => import('./PinMenu'));

interface PinsProps {
  cards: Card[];
  defaultDeckId: string;
  repository: SurfaceData['repository'];
  onCardsChange: (cards: Card[]) => void;
  offerUndo?: (action: UndoAction) => void;
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
}: PinsProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [error, setError] = useState('');
  const [menuCard, setMenuCard] = useState<Card | null>(null);
  const { isOver, setNodeRef } = useDroppable({ id: dragId('pin', 'strip') });
  const pins = useMemo(
    () =>
      cards
        .filter((card) => card.pinned && card.deletedAt === null)
        .toSorted((a, b) => compareOrder(a.order, b.order)),
    [cards],
  );

  const saveCard = async (card: Card) => {
    const saved = await repository.upsertCard(card);
    onCardsChange(cards.map((item) => (item.id === saved.id ? saved : item)));
  };
  const open = async (card: Card, isNewTab: boolean) => {
    try {
      const { openCard } = await import('../drawer/inboxActions');
      await openCard(repository, card, isNewTab);
    } catch (openError) {
      setError(`${strings.updateFailed} ${String(openError)}`);
    }
  };

  useEffect(() => {
    const onDrop = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const { activeId, overId } = event.detail as WorkspaceDropDetail;
      const active = parseDragId(activeId);
      const over = parseDragId(overId);
      if (active?.entity !== 'pin' || over?.entity !== 'pin') return;
      const moved = pins.find(({ id }) => id === active.id);
      if (!moved) return;
      void saveCard({
        ...moved,
        order: fractionalOrderForMove(pins, active.id, over.id),
        updatedAt: Date.now(),
      }).catch((saveError: unknown) => {
        const detail =
          saveError instanceof Error ? saveError.message : String(saveError);
        setError(`${strings.updateFailed} ${detail}`);
      });
    };
    window.addEventListener(WORKSPACE_DROP_EVENT, onDrop);
    return () => window.removeEventListener(WORKSPACE_DROP_EVENT, onDrop);
  });

  const addPin = async () => {
    try {
      const { createPin } = await import('./pinUndo');
      const saved = await createPin(repository, urlInput, defaultDeckId, pins);
      onCardsChange([...cards, saved]);
      setUrlInput('');
      setError('');
      setIsAdding(false);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : String(addError));
    }
  };

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
    } catch (saveError) {
      setError(`${strings.updateFailed} ${String(saveError)}`);
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
          <div className="deck-pin-add-form">
            <input
              className="deck-pin-url-input"
              ref={focusOnMount}
              value={urlInput}
              placeholder={strings.pinUrlPlaceholder}
              aria-label={strings.pinUrlPlaceholder}
              onChange={(event) => setUrlInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void addPin();
                if (event.key === 'Escape') setIsAdding(false);
              }}
            />
            {error ? <span role="alert">{error}</span> : null}
          </div>
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
