import type { Card, Deck } from 'deck-schema';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { panelStrings as strings } from '../i18n/panelStrings';
import FaviconTile from '../newtab/FaviconTile';
import type { WorkspaceProps } from './DeckWorkspace';
import { dragId } from './dragIdentity';
import { openCard } from './inboxActions';
import { parseCardUrl, replaceEntity } from './workspaceModel';

const DROP_SETTLE_MS = 160;
const DROP_SETTLE_EASING = 'var(--deck-ease-hover)';
const now = () => Date.now();
const focusTitle = (element: HTMLInputElement | null) => {
  element?.focus();
  element?.select();
};

export function CardRow({
  card,
  onEditNote,
  ...props
}: Omit<WorkspaceProps, 'selectedPageId'> & {
  card: Card;
  onEditNote: (entity: Deck | Card) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: dragId('card', card.id),
    transition: { duration: DROP_SETTLE_MS, easing: DROP_SETTLE_EASING },
  });
  const [isEditing, setIsEditing] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [title, setTitle] = useState(card.title);
  const [url, setUrl] = useState(card.url);
  const update = async (change: Partial<Card>): Promise<boolean> => {
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
      return true;
    } catch (error) {
      props.onError(
        `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
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
      props.onError(
        `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const open = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    event.preventDefault();
    try {
      props.onCardsChange(
        replaceEntity(
          props.cards,
          await openCard(
            props.data.repository,
            card,
            event.button === 1 ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey,
          ),
        ),
      );
    } catch (error) {
      props.onError(
        `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const saveEdit = async () => {
    const parsed = parseCardUrl(url);
    if (!parsed) return props.onError(strings.invalidUrl);
    const nextTitle = title.trim() || card.title;
    if (
      await update({
        url: parsed.url,
        hostname: parsed.hostname,
        title: nextTitle,
      })
    )
      setIsEditing(false);
  };
  const openIncognito = async () => {
    try {
      if (!(await chrome.extension.isAllowedIncognitoAccess()))
        return props.onError(strings.incognitoUnavailable);
      const opened = await chrome.windows.create({
        url: card.url,
        incognito: true,
      });
      if (!opened?.incognito) props.onError(strings.incognitoUnavailable);
    } catch (error) {
      props.onError(
        `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-deck="card"
      data-card-id={card.id}
      className="deck-card"
      data-done={card.done || undefined}
      data-dragging={isDragging || undefined}
      data-drag-over={isOver || undefined}
      {...attributes}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        data-deck="card-drag"
        className="deck-card__drag"
        aria-label={strings.dragCard}
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <FaviconTile url={card.url} hostname={card.hostname} />
      {isEditing ? (
        <form
          data-deck="card-editor"
          className="deck-card__editor"
          onSubmit={(event) => {
            event.preventDefault();
            void saveEdit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setIsEditing(false);
            }
          }}
        >
          <input
            ref={focusTitle}
            aria-label={strings.cardTitle}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
          <input
            aria-label={strings.cardUrl}
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
          <button type="submit">{strings.saveCard}</button>
          <button type="button" onClick={() => setIsEditing(false)}>
            {strings.cancel}
          </button>
        </form>
      ) : (
        <a
          href={card.url}
          onClick={(event) => void open(event)}
          onAuxClick={(event) => void open(event)}
        >
          <strong>{card.title}</strong>
          <small>{card.hostname}</small>
        </a>
      )}
      <div className="deck-card__actions">
        <button
          type="button"
          data-deck="card-edit"
          aria-label={strings.editCard}
          onClick={() => {
            setTitle(card.title);
            setUrl(card.url);
            setIsEditing(true);
          }}
        >
          {strings.edit}
        </button>
        <button
          type="button"
          aria-label={strings.editNote}
          onClick={() => onEditNote(card)}
        >
          {card.note ? '◉' : '✎'}
        </button>
        <button
          type="button"
          role="checkbox"
          aria-label={strings.markDone}
          aria-checked={Boolean(card.done)}
          onClick={() => void update({ done: !card.done })}
        >
          ✓
        </button>
        <button
          type="button"
          aria-label={strings.cardMenu}
          aria-expanded={isMenuOpen}
          onClick={(event) => {
            setMenuAnchor(event.currentTarget);
            setIsMenuOpen((value) => !value);
          }}
        >
          ⋯
        </button>
        <button
          type="button"
          aria-label={strings.trashCard}
          onClick={() => void trash()}
        >
          ×
        </button>
      </div>
      {isMenuOpen && menuAnchor ? (
        <CardMenu
          anchor={menuAnchor}
          onClose={() => setIsMenuOpen(false)}
          onEdit={() => {
            setTitle(card.title);
            setUrl(card.url);
            setIsEditing(true);
            setIsMenuOpen(false);
          }}
          onNote={() => {
            onEditNote(card);
            setIsMenuOpen(false);
          }}
          onPin={() => {
            void update({ pinned: !card.pinned });
            setIsMenuOpen(false);
          }}
          onDone={() => {
            void update({ done: !card.done });
            setIsMenuOpen(false);
          }}
          onIncognito={() => {
            void openIncognito();
            setIsMenuOpen(false);
          }}
          onTrash={() => {
            void trash();
            setIsMenuOpen(false);
          }}
          pinned={card.pinned}
          done={Boolean(card.done)}
        />
      ) : null}
    </article>
  );
}

function CardMenu({
  anchor,
  onClose,
  onEdit,
  onNote,
  onPin,
  onDone,
  onIncognito,
  onTrash,
  pinned,
  done,
}: {
  anchor: HTMLButtonElement | null;
  onClose: () => void;
  onEdit: () => void;
  onNote: () => void;
  onPin: () => void;
  onDone: () => void;
  onIncognito: () => void;
  onTrash: () => void;
  pinned: boolean;
  done: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        !ref.current?.contains(event.target as Node) &&
        !anchor?.contains(event.target as Node)
      )
        onClose();
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [anchor, onClose]);
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  return (
    <div
      ref={ref}
      data-deck="card-menu"
      className="deck-menu deck-card-menu"
      role="menu"
      style={{ insetInlineEnd: 0, insetBlockStart: rect.height }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
          anchor.focus();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const items = [
            ...(ref.current?.querySelectorAll<HTMLElement>(
              '[role="menuitem"]',
            ) ?? []),
          ];
          const index = items.indexOf(document.activeElement as HTMLElement);
          items[
            (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
              items.length
          ]?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
    >
      <button type="button" role="menuitem" onClick={onEdit}>
        {strings.edit}
      </button>
      <button type="button" role="menuitem" onClick={onNote}>
        {strings.editNote}
      </button>
      <button type="button" role="menuitem" onClick={onPin}>
        {pinned ? strings.unpin : strings.pinCard}
      </button>
      <button type="button" role="menuitem" onClick={onDone}>
        {done ? strings.markNotDone : strings.markDone}
      </button>
      <button type="button" role="menuitem" onClick={onIncognito}>
        {strings.openIncognito}
      </button>
      <button type="button" role="menuitem" onClick={onTrash}>
        {strings.trashCard}
      </button>
    </div>
  );
}
