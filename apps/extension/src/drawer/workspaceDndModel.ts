import type { Card, Deck } from 'deck-schema';
import { compareOrder } from './workspaceModel';
import { fractionalOrderForMove } from './fractionalOrder';

export function moveDeck(
  decks: Deck[],
  deckId: string,
  targetPageId: string,
  overDeckId?: string,
): Deck | null {
  const moved = decks.find(({ id }) => id === deckId);
  if (!moved) return null;
  const targetDecks = decks
    .filter((deck) => deck.deletedAt === null && deck.pageId === targetPageId)
    .toSorted(byOrder);
  return {
    ...moved,
    pageId: targetPageId,
    order: fractionalOrderForMove(targetDecks, deckId, overDeckId),
  };
}

export function moveCard(
  cards: Card[],
  cardId: string,
  targetDeckId: string,
  overCardId?: string,
): Card | null {
  const moved = cards.find(({ id }) => id === cardId);
  if (!moved) return null;
  const targetCards = cards
    .filter(
      (card) =>
        card.deletedAt === null &&
        card.deckId === targetDeckId &&
        Boolean(card.done) === Boolean(moved.done),
    )
    .toSorted(byOrder);
  return {
    ...moved,
    deckId: targetDeckId,
    order: fractionalOrderForMove(targetCards, cardId, overCardId),
  };
}

function byOrder(left: { order: string }, right: { order: string }) {
  return compareOrder(left.order, right.order);
}
