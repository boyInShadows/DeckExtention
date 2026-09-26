import type { Card, Deck, Page } from 'deck-schema';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { strings } from '../i18n/strings';
import type { SurfaceData } from '../newtab/bootstrap';
import { markOpened, moveCards, pinCards, trashCards } from './inboxActions';
import {
  clampIndex,
  moveTargets,
  parseRecentTargets,
  RECENT_TARGETS_KEY,
  rememberTarget,
  selectionOf,
} from './inboxModel';
import { MoveLine } from './MoveLine';
import { NotePanel } from './NotePanel';
import { useTriageQueue } from './useTriageQueue';
import { activeCards, replaceEntity } from './workspaceModel';

interface InboxTriageProps {
  cards: Card[];
  decks: Deck[];
  pages: Page[];
  data: SurfaceData;
  onCardsChange: (cards: Card[]) => void;
  onError: (message: string) => void;
}

const message = (error: unknown) =>
  `${strings.updateFailed} ${error instanceof Error ? error.message : String(error)}`;

/**
 * Inbox triage (FableTasks P2.S5, MasterPlan I3): newest first, keyboard
 * first. The list is one focus stop; the cursor is aria-activedescendant.
 */
export function InboxTriage(props: InboxTriageProps) {
  const repository = props.data.repository;
  const inbox = props.decks.find(
    (deck) => deck.kind === 'inbox' && deck.deletedAt === null,
  );
  const inboxCards = useMemo(
    () => (inbox ? activeCards(props.cards, inbox.id) : []),
    [inbox, props.cards],
  );
  const ids = inboxCards.map(({ id }) => id);
  const targets = useMemo(
    () => moveTargets(props.decks, props.pages),
    [props.decks, props.pages],
  );
  const [cursor, setCursor] = useState(0);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [noteCard, setNoteCard] = useState<Card | null>(null);
  const [recent, setRecent] = useState(() =>
    parseRecentTargets(localStorage.getItem(RECENT_TARGETS_KEY)),
  );
  const listRef = useRef<HTMLOListElement>(null);
  const position = clampIndex(cursor, ids.length);
  const selected = selectionOf(ids, position, anchor);
  const homeDeckId =
    props.decks.find(
      ({ id, deletedAt }) => id === props.data.defaultDeckId && !deletedAt,
    )?.id ?? targets[0]?.deckId;

  useEffect(() => listRef.current?.focus(), []);
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-cursor]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [position]);

  const { onCardsChange, onError } = props;
  const enqueue = useTriageQueue({
    cards: props.cards,
    inboxId: inbox?.id,
    cursor: position,
    anchor,
    onCardsChange,
    onError: useCallback(
      (error: unknown) => onError(message(error)),
      [onError],
    ),
    onSettled: useCallback(() => {
      setAnchor(null);
      // Only reclaim focus that was lost (a trashed row, a closed panel) -
      // never steal it from a move-to or note opened while this was queued.
      const focused = document.activeElement;
      if (!focused || focused === document.body) listRef.current?.focus();
    }, []),
  });

  const move = (deckId: string) => {
    setIsMoving(false);
    const nextRecent = rememberTarget(recent, deckId);
    setRecent(nextRecent);
    localStorage.setItem(RECENT_TARGETS_KEY, JSON.stringify(nextRecent));
    enqueue((cards, ids) => moveCards(repository, cards, ids, deckId));
    listRef.current?.focus();
  };

  const pin = () => {
    if (!homeDeckId) return props.onError(strings.noDecks);
    enqueue((cards, ids) => pinCards(repository, cards, ids, homeDeckId));
  };

  const open = async (card: Card) => {
    // Imported data could carry any scheme; only web pages are opened.
    if (!/^https?:\/\//i.test(card.url))
      return props.onError(strings.invalidUrl);
    try {
      await markOpened(repository, card);
      location.assign(card.url);
    } catch (error) {
      props.onError(message(error));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const card = inboxCards[position];
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    let isHandled = true;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      setAnchor(event.shiftKey ? (anchor ?? position) : null);
      setCursor(
        clampIndex(position + (key === 'ArrowDown' ? 1 : -1), ids.length),
      );
    } else if (!card) isHandled = false;
    else if (key === 'ArrowRight' || key === 'm') setIsMoving(true);
    else if (key === 'x')
      enqueue((cards, ids) => trashCards(repository, cards, ids));
    else if (key === 'n') setNoteCard(card);
    else if (key === 'p') pin();
    else if (key === 'Enter') void open(card);
    else isHandled = false;
    if (isHandled) event.preventDefault();
  };

  return (
    <section data-deck="inbox" className="deck-inbox">
      {inboxCards.length ? (
        <p className="deck-inbox__hint">{strings.triageHint}</p>
      ) : null}
      <ol
        ref={listRef}
        tabIndex={0}
        role="listbox"
        aria-label={strings.inbox}
        aria-multiselectable="true"
        aria-activedescendant={
          inboxCards[position] ? `deck-inbox-${ids[position]}` : undefined
        }
        onKeyDown={onKeyDown}
        className="deck-inbox__list"
      >
        {inboxCards.map((card, index) => (
          <li
            key={card.id}
            id={`deck-inbox-${card.id}`}
            role="option"
            aria-selected={selected.includes(card.id)}
            data-deck="card"
            className="deck-card"
            data-cursor={index === position || undefined}
            data-selected={
              (anchor !== null && selected.includes(card.id)) || undefined
            }
            onClick={() => {
              setCursor(index);
              setAnchor(null);
            }}
          >
            <img
              src={`/_favicon/?pageUrl=${encodeURIComponent(card.url)}&size=32`}
              alt=""
            />
            <span>
              <strong>{card.title}</strong>
              <small>{card.note ? `● ${card.hostname}` : card.hostname}</small>
            </span>
          </li>
        ))}
      </ol>
      {inboxCards.length ? null : (
        <p data-deck="inbox-zero" className="deck-inbox__zero">
          {strings.inboxZero}
        </p>
      )}
      {isMoving ? (
        <MoveLine
          targets={targets}
          recentDeckIds={recent}
          onMove={move}
          onCancel={() => {
            setIsMoving(false);
            listRef.current?.focus();
          }}
        />
      ) : null}
      {noteCard ? (
        <NotePanel
          entity={noteCard}
          repository={repository}
          onClose={() => {
            setNoteCard(null);
            listRef.current?.focus();
          }}
          onError={props.onError}
          onSaved={(saved) => {
            if ('deckId' in saved) {
              props.onCardsChange(replaceEntity(props.cards, saved));
              setNoteCard(saved);
            }
          }}
        />
      ) : null}
    </section>
  );
}
