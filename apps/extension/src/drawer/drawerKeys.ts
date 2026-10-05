/**
 * Vim-ish movement across the deck grid (FableTasks P2.S6): j/k within a
 * deck, h/l across decks. Pure, so the DOM glue stays trivial.
 */

/** `card: null` means the deck itself (its header), e.g. an empty deck. */
export interface GridPosition {
  deck: number;
  card: number | null;
}

export type GridMove = 'next' | 'previous' | 'nextDeck' | 'previousDeck';

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

function cardAt(count: number, preferred: number): number | null {
  return count > 0 ? clamp(preferred, count - 1) : null;
}

/**
 * Where focus goes next. `cardCounts[i]` is how many cards deck i shows
 * (0 when collapsed). Returns null only when there are no decks at all.
 */
export function nextGridPosition(
  cardCounts: readonly number[],
  from: GridPosition | null,
  move: GridMove,
): GridPosition | null {
  if (cardCounts.length === 0) return null;
  if (!from) return { deck: 0, card: cardAt(cardCounts[0] ?? 0, 0) };
  const deck = clamp(from.deck, cardCounts.length - 1);
  const count = cardCounts[deck] ?? 0;
  if (move === 'next') {
    return {
      deck,
      card: cardAt(count, from.card === null ? 0 : from.card + 1),
    };
  }
  if (move === 'previous') {
    return { deck, card: from.card ? from.card - 1 : null };
  }
  const target = clamp(
    deck + (move === 'nextDeck' ? 1 : -1),
    cardCounts.length - 1,
  );
  return {
    deck: target,
    card: cardAt(cardCounts[target] ?? 0, from.card ?? 0),
  };
}
