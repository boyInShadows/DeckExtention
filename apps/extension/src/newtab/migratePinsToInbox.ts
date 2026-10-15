import { INBOX_DECK_ID, type Card } from 'deck-schema';

import type { DeckRepository } from '../storage/repository';

// A single transaction preserves all old card records if the migration fails.
export async function migratePinsToInbox(
  repository: DeckRepository,
  cards: Card[],
): Promise<Card[]> {
  const migrated = cards
    .filter((card) => card.pinned && card.deckId !== INBOX_DECK_ID)
    .map((card) => ({ ...card, deckId: INBOX_DECK_ID }));
  await repository.upsertMany({ cards: migrated });
  const byId = new Map(migrated.map((card) => [card.id, card]));
  return cards.map((card) => byId.get(card.id) ?? card);
}
