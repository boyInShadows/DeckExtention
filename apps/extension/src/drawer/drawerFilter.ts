import type { Card } from 'deck-schema';

export function filterCards<
  T extends Pick<Card, 'title' | 'url' | 'hostname' | 'note'>,
>(cards: T[], query: string): T[] {
  const text = query.trim().toLowerCase();
  return cards.filter((card) =>
    [card.title, card.url, card.hostname, card.note ?? ''].some((value) =>
      (value ?? '').toLowerCase().includes(text),
    ),
  );
}
