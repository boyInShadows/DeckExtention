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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { UrlSchema, type Card } from 'deck-schema';
import { generateKeyBetween } from 'fractional-indexing';
import { useMemo, useState } from 'react';

import { strings } from '../i18n/strings';
import type { SurfaceData } from './bootstrap';

const MAX_PINS = 12;
const FAVICON_SIZE = 64;

interface PinsProps {
  cards: Card[];
  defaultDeckId: string;
  repository: SurfaceData['repository'];
  onCardsChange: (cards: Card[]) => void;
}

function faviconUrl(url: string): string {
  const endpoint = chrome.runtime.getURL('/_favicon/');
  return `${endpoint}?pageUrl=${encodeURIComponent(url)}&size=${FAVICON_SIZE}`;
}

function SortablePin({
  card,
  onMenu,
}: {
  card: Card;
  onMenu: (card: Card) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
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
}: PinsProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [error, setError] = useState('');
  const [menuCard, setMenuCard] = useState<Card | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const pins = useMemo(
    () =>
      cards
        .filter((card) => card.pinned && card.deletedAt === null)
        .toSorted((a, b) => a.order.localeCompare(b.order)),
    [cards],
  );

  const saveCard = async (card: Card) => {
    const saved = await repository.upsertCard(card);
    onCardsChange(cards.map((item) => (item.id === saved.id ? saved : item)));
  };

  const addPin = async () => {
    const parsed = UrlSchema.safeParse(urlInput.trim());
    if (
      !parsed.success ||
      !['http:', 'https:'].includes(new URL(parsed.data).protocol)
    ) {
      setError(strings.invalidUrl);
      return;
    }
    const url = new URL(parsed.data);
    const now = Date.now();
    const saved = await repository.upsertCard({
      id: crypto.randomUUID(),
      deckId: defaultDeckId,
      url: url.href,
      title: url.hostname,
      hostname: url.hostname,
      order: generateKeyBetween(pins.at(-1)?.order ?? null, null),
      pinned: true,
      lastOpenedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    onCardsChange([...cards, saved]);
    setUrlInput('');
    setError('');
    setIsAdding(false);
  };

  const finishDrag = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const reordered = arrayMove(
      pins,
      pins.findIndex(({ id }) => id === active.id),
      pins.findIndex(({ id }) => id === over.id),
    );
    const to = reordered.findIndex(({ id }) => id === active.id);
    const movedCard = reordered[to];
    if (!movedCard) return;
    await saveCard({
      ...movedCard,
      order: generateKeyBetween(
        reordered[to - 1]?.order ?? null,
        reordered[to + 1]?.order ?? null,
      ),
      updatedAt: Date.now(),
    });
  };

  const updateMenuCard = async (change: Partial<Card>) => {
    if (!menuCard) return;
    await saveCard({ ...menuCard, ...change, updatedAt: Date.now() });
    setMenuCard(null);
  };

  return (
    <section
      data-deck="pins"
      className="deck-pins"
      aria-label={strings.pinsLabel}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={finishDrag}
      >
        <SortableContext items={pins} strategy={horizontalListSortingStrategy}>
          {pins.map((card) => (
            <SortablePin key={card.id} card={card} onMenu={setMenuCard} />
          ))}
        </SortableContext>
      </DndContext>
      {pins.length < MAX_PINS ? (
        isAdding ? (
          <div className="deck-pin-add-form">
            <input
              className="deck-pin-url-input"
              autoFocus
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
      {menuCard ? <PinMenu card={menuCard} onUpdate={updateMenuCard} /> : null}
    </section>
  );
}

function PinMenu({
  card,
  onUpdate,
}: {
  card: Card;
  onUpdate: (change: Partial<Card>) => Promise<void>;
}) {
  const rename = () => {
    const label = window.prompt(
      strings.renamePinPrompt,
      card.pinLabel ?? card.title,
    );
    if (label !== null) void onUpdate({ pinLabel: label });
  };
  const changeIcon = () => {
    const icon = window.prompt(strings.iconPrompt, card.pinIcon ?? '');
    if (icon !== null) void onUpdate({ pinIcon: icon || undefined });
  };
  return (
    <div data-deck="pin-menu" className="deck-pin-menu" role="menu">
      <button type="button" role="menuitem" onClick={rename}>
        {strings.renamePin}
      </button>
      <button type="button" role="menuitem" onClick={changeIcon}>
        {strings.changePinIcon}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => void onUpdate({ pinned: false })}
      >
        {strings.unpin}
      </button>
    </div>
  );
}
