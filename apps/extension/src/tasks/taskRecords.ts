import type { Card, Deck, Page } from 'deck-schema';

export function taskRecords(
  cards: Card[],
  decks: Deck[],
  pages: Page[],
): Card[] {
  const pageIds = new Set(
    pages.filter(({ deletedAt }) => deletedAt === null).map(({ id }) => id),
  );
  const deckIds = new Set(
    decks
      .filter(
        (deck) =>
          deck.deletedAt === null &&
          (deck.kind !== 'normal' || pageIds.has(deck.pageId)),
      )
      .map(({ id }) => id),
  );
  return cards.filter(
    (card) =>
      card.kind === 'task' &&
      card.deletedAt === null &&
      deckIds.has(card.deckId),
  );
}
