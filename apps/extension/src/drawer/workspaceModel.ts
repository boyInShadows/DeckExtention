import type { Card, Deck, DeckSortMode } from 'deck-schema';

export function activeDecks(
  decks: Deck[],
  pageId: string | null,
  kind?: Deck['kind'],
): Deck[] {
  return decks
    .filter(
      (deck) =>
        deck.deletedAt === null &&
        (kind === 'session' || deck.pageId === pageId) &&
        (kind === undefined || deck.kind === kind),
    )
    .toSorted((left, right) => compareOrder(left.order, right.order));
}

export function activeCards(
  cards: Card[],
  deckId: string,
  sortMode: DeckSortMode = 'manual',
): Card[] {
  return cards
    .filter(
      (card) =>
        card.deletedAt === null && card.deckId === deckId && !card.pinned,
    )
    .toSorted((left, right) => {
      const doneDifference =
        Number(Boolean(left.done)) - Number(Boolean(right.done));
      return (
        doneDifference ||
        compareCards(left, right, sortMode) ||
        compareOrder(left.order, right.order) ||
        compareOrder(left.id, right.id)
      );
    });
}

function compareCards(left: Card, right: Card, sortMode: DeckSortMode): number {
  if (sortMode === 'newest') return right.createdAt - left.createdAt;
  if (sortMode === 'title')
    return compareOrder(left.title.toLowerCase(), right.title.toLowerCase());
  if (sortMode === 'hostname') {
    return (
      Number(!left.hostname) - Number(!right.hostname) ||
      compareOrder(left.hostname.toLowerCase(), right.hostname.toLowerCase())
    );
  }
  return 0;
}

export function compareOrder(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function parseCardUrl(value: string): {
  hostname: string;
  title: string;
  url: string;
} | null {
  const candidate = value.trim();
  if (!candidate) return null;
  if (
    /^[a-z][a-z\d+.-]*:/i.test(candidate) &&
    !/^https?:\/\//i.test(candidate)
  ) {
    return null;
  }
  const withProtocol = /^https?:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return null;
    return {
      hostname: parsed.hostname,
      title: parsed.hostname,
      url: parsed.href,
    };
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export function replaceEntity<T extends { id: string }>(
  entities: T[],
  saved: T,
): T[] {
  return entities.map((entity) => (entity.id === saved.id ? saved : entity));
}
