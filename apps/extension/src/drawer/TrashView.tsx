import type { Card, Deck, Page } from 'deck-schema';
import { useState, type KeyboardEvent } from 'react';

import { panelStrings as strings } from '../i18n/panelStrings';
import type { DeckRepository } from '../storage/repository';
import { focusOnMount } from '../newtab/focusOnMount';

type TrashItem =
  | { kind: 'page'; record: Page; cardCount: number }
  | { kind: 'deck'; record: Deck; cardCount: number }
  | { kind: 'card'; record: Card; cardCount: number };

interface TrashViewProps {
  pages: Page[];
  decks: Deck[];
  cards: Card[];
  repository: DeckRepository;
  onChange: () => Promise<void>;
  onError: (message: string) => void;
}

function trashItems(pages: Page[], decks: Deck[], cards: Card[]): TrashItem[] {
  return [
    ...pages
      .filter(({ deletedAt }) => deletedAt !== null)
      .map((record) => ({
        kind: 'page' as const,
        record,
        cardCount: cards.filter((card) =>
          decks.some(
            (deck) => deck.pageId === record.id && deck.id === card.deckId,
          ),
        ).length,
      })),
    ...decks
      .filter(({ deletedAt }) => deletedAt !== null)
      .map((record) => ({
        kind: 'deck' as const,
        record,
        cardCount: cards.filter(({ deckId }) => deckId === record.id).length,
      })),
    ...cards
      .filter(({ deletedAt }) => deletedAt !== null)
      .map((record) => ({ kind: 'card' as const, record, cardCount: 0 })),
  ].toSorted((a, b) => (b.record.deletedAt ?? 0) - (a.record.deletedAt ?? 0));
}

async function restoreItem(
  item: TrashItem,
  props: TrashViewProps,
): Promise<void> {
  const { repository } = props;
  if (item.kind === 'page') return repository.restorePage(item.record.id);
  const deck =
    item.kind === 'deck'
      ? item.record
      : props.decks.find(({ id }) => id === item.record.deckId);
  if (!deck) throw new Error(strings.updateFailed);
  const page = props.pages.find(({ id }) => id === deck.pageId);
  if (!page) throw new Error(strings.updateFailed);
  if (page.deletedAt !== null) await repository.restorePage(page.id);
  const currentDeck = (await repository.listDecks()).find(
    ({ id }) => id === deck.id,
  );
  if (!currentDeck) throw new Error(strings.updateFailed);
  if (currentDeck.deletedAt !== null) await repository.restoreDeck(deck.id);
  if (item.kind === 'card') {
    const currentCard = (await repository.listCards()).find(
      ({ id }) => id === item.record.id,
    );
    if (!currentCard) throw new Error(strings.updateFailed);
    if (currentCard.deletedAt !== null)
      await repository.restore('card', item.record.id);
  }
}

export function TrashView(props: TrashViewProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const groups = new Map<string, TrashItem[]>();
  for (const item of trashItems(props.pages, props.decks, props.cards)) {
    const day = new Date(item.record.deletedAt ?? 0).toLocaleDateString();
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      await props.onChange();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      props.onError(`${strings.updateFailed} ${detail}`);
    }
  };
  const restore = (item: TrashItem) => run(() => restoreItem(item, props));
  const onItemKeyDown = (
    event: KeyboardEvent<HTMLLIElement>,
    item: TrashItem,
  ) => {
    if (event.key !== 'r' || event.ctrlKey || event.altKey || event.metaKey)
      return;
    event.preventDefault();
    void restore(item);
  };

  return (
    <main data-deck="trash" className="deck-trash">
      <header>
        <h2>{strings.trash}</h2>
        {groups.size ? (
          <button type="button" onClick={() => setIsConfirming(true)}>
            {strings.emptyTrash}
          </button>
        ) : null}
      </header>
      {groups.size ? (
        [...groups].map(([day, items]) => (
          <section key={day} data-deck="trash-day">
            <h3>{day}</h3>
            <ul>
              {items.map((item) => (
                <li
                  key={`${item.kind}:${item.record.id}`}
                  data-deck="trash-item"
                  tabIndex={0}
                  onKeyDown={(event) => onItemKeyDown(event, item)}
                >
                  <span>{item.record.title}</span>
                  <small>
                    {strings.trashType[item.kind]}
                    {item.kind !== 'card'
                      ? ` · ${strings.deletedCards(item.cardCount)}`
                      : ''}
                  </small>
                  <button type="button" onClick={() => void restore(item)}>
                    {strings.restore}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p>{strings.trashEmpty}</p>
      )}
      {isConfirming ? (
        <div
          data-deck="trash-confirm"
          role="dialog"
          aria-modal="true"
          aria-label={strings.emptyTrash}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setIsConfirming(false);
          }}
        >
          <p>{strings.emptyTrashConfirm}</p>
          <button
            ref={focusOnMount}
            type="button"
            onClick={() => setIsConfirming(false)}
          >
            {strings.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsConfirming(false);
              void run(async () => {
                await props.repository.purge(Infinity);
              });
            }}
          >
            {strings.emptyTrash}
          </button>
        </div>
      ) : null}
    </main>
  );
}
