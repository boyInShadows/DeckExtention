import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { Card, Deck, Page } from 'deck-schema';
import type { DeckRepository } from '../storage/repository';
import { panelStrings as strings } from '../i18n/panelStrings';
import { activeCards } from '../drawer/workspaceModel';
import FaviconTile from '../newtab/FaviconTile';
import { Icon } from '../newtab/Icon';
import { shelfDecks } from './shelfModel';
import './shelf.css';

interface ShelfProps {
  cards: Card[];
  decks: Deck[];
  pages: Page[];
  selectedDeckIds: string[];
  repository: DeckRepository;
  onDataChange: () => void;
  onOpenNote: (card: Card) => void;
  onError: (message: string) => void;
}

export default function Shelf(props: ShelfProps) {
  const root = useRef<HTMLElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const decks = shelfDecks(props.pages, props.decks).filter((deck) =>
    props.selectedDeckIds.includes(deck.id),
  );
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    const target = event.target as HTMLElement;
    if (!target.matches('[data-deck="shelf-toggle"]')) return;
    const headers = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>(
        '[data-deck="shelf-toggle"]',
      ) ?? []),
    ];
    const index = headers.indexOf(target as HTMLButtonElement);
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % headers.length
        : event.key === 'ArrowUp'
          ? (index - 1 + headers.length) % headers.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? headers.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    headers[next]?.focus();
  };
  if (!decks.length) return null;
  return (
    <section
      ref={root}
      data-deck="shelf"
      className="deck-shelf"
      aria-label={strings.shelf}
      onKeyDown={onKeyDown}
    >
      {decks.map((deck) => (
        <ShelfDeck
          key={deck.id}
          deck={deck}
          cards={activeCards(props.cards, deck.id)}
          isOpen={deck.id === openId}
          onToggle={() =>
            setOpenId((current) => (current === deck.id ? null : deck.id))
          }
          onCollapse={() => setOpenId(null)}
          shelf={props}
        />
      ))}
    </section>
  );
}

function ShelfDeck({
  deck,
  cards,
  isOpen,
  onToggle,
  onCollapse,
  shelf,
}: {
  deck: Deck;
  cards: Card[];
  isOpen: boolean;
  onToggle: () => void;
  onCollapse: () => void;
  shelf: ShelfProps;
}) {
  const header = useRef<HTMLButtonElement>(null);
  const headerId = `shelf-header-${deck.id}`;
  const panelId = `shelf-panel-${deck.id}`;
  return (
    <section
      data-deck="shelf-deck"
      data-deck-id={deck.id}
      className="deck-shelf__deck"
      onKeyDown={(event) => {
        if (
          event.key !== 'ArrowLeft' ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        onCollapse();
        header.current?.focus();
      }}
    >
      <h2 data-deck="shelf-heading">
        <button
          ref={header}
          id={headerId}
          type="button"
          data-deck="shelf-toggle"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <Icon name="chevron" />
          <span data-deck="shelf-title" className="deck-blurrable">
            {deck.title}
          </span>
          <small
            data-deck="shelf-count"
            aria-label={strings.shelfCount(cards.length)}
          >
            {cards.length}
          </small>
        </button>
      </h2>
      <div
        id={panelId}
        data-deck="shelf-panel"
        hidden={!isOpen}
        aria-labelledby={headerId}
        className="deck-shelf__panel"
      >
        {isOpen &&
          (cards.length ? (
            <ul data-deck="shelf-cards">
              {cards.map((card) => (
                <ShelfCard key={card.id} card={card} shelf={shelf} />
              ))}
            </ul>
          ) : (
            <p data-deck="shelf-empty">{strings.emptyDeck}</p>
          ))}
      </div>
    </section>
  );
}

function ShelfCard({ card, shelf }: { card: Card; shelf: ShelfProps }) {
  const open = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    event.preventDefault();
    try {
      if (!card.url || !/^https?:\/\//i.test(card.url))
        throw new Error(strings.invalidUrl);
      // Patch the stored record atomically; never write back a stale Shelf copy.
      await shelf.repository.markCardsOpened([card.id]);
      if (
        event.button === 1 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        await chrome.tabs.create({ url: card.url });
      else location.assign(card.url);
      shelf.onDataChange();
    } catch (error) {
      shelf.onError(
        `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  return (
    <li
      data-deck="shelf-card"
      className="deck-blurrable"
      data-done={card.done || undefined}
    >
      <FaviconTile url={card.url} hostname={card.hostname} />
      {card.url ? (
        <a
          data-deck="shelf-link"
          href={card.url}
          onClick={(event) => void open(event)}
          onAuxClick={(event) => void open(event)}
        >
          <span>{card.title}</span>
          <small>{card.hostname}</small>
        </a>
      ) : (
        <button
          data-deck="shelf-note"
          type="button"
          onClick={() => shelf.onOpenNote(card)}
        >
          <span>{card.title}</span>
          <small>{strings.notesGroup}</small>
        </button>
      )}
    </li>
  );
}
