import type { Card, Deck } from 'deck-schema';

export function activeDecks(
  decks: Deck[],
  pageId: string | null,
  kind?: Deck['kind'],
): Deck[] {
  return decks
    .filter(
      (deck) =>
        deck.deletedAt === null &&
        deck.pageId === pageId &&
        (kind === undefined || deck.kind === kind),
    )
    .toSorted((left, right) => left.order.localeCompare(right.order));
}

export function activeCards(cards: Card[], deckId: string): Card[] {
  return cards
    .filter((card) => card.deletedAt === null && card.deckId === deckId)
    .toSorted((left, right) => {
      const doneDifference =
        Number(Boolean(left.done)) - Number(Boolean(right.done));
      return doneDifference || left.order.localeCompare(right.order);
    });
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
