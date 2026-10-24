import type { DeckDatabaseHandle } from './database';

const MAX_OPS = 5_000;

/** Keeps a deleted parent while any child would survive this purge. */
export async function purgeDeleted(
  database: DeckDatabaseHandle,
  cutoff: number,
  opCutoff: number,
): Promise<number> {
  const transaction = database.transaction(
    ['pages', 'decks', 'cards', 'ops'],
    'readwrite',
  );
  const [pages, decks, cards, ops] = await Promise.all([
    transaction.objectStore('pages').getAll(),
    transaction.objectStore('decks').getAll(),
    transaction.objectStore('cards').getAll(),
    transaction.objectStore('ops').getAll(),
  ]);
  const expired = ({ deletedAt }: { deletedAt: number | null }) =>
    deletedAt !== null && deletedAt <= cutoff;
  const removedCards = cards.filter(expired);
  const remainingCards = cards.filter((card) => !expired(card));
  const removedDecks = decks.filter(
    (deck) =>
      expired(deck) && !remainingCards.some((card) => card.deckId === deck.id),
  );
  const remainingDecks = decks.filter(
    (deck) => !removedDecks.some(({ id }) => id === deck.id),
  );
  const removedPages = pages.filter(
    (page) =>
      expired(page) && !remainingDecks.some((deck) => deck.pageId === page.id),
  );
  // Ops are an audit trail for future sync; retain the newest event per entity.
  const newest = ops.toSorted((a, b) => b.ts - a.ts);
  const kept = new Set(
    newest
      .filter((op) => op.ts > opCutoff)
      .slice(0, MAX_OPS)
      .map(({ id }) => id),
  );
  const seen = new Set<string>();
  for (const op of newest) {
    const key = `${op.entity}:${op.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.add(op.id);
  }
  const oldOps = ops.filter(({ id }) => !kept.has(id));
  const writes = [
    ...removedCards.map(({ id }) =>
      transaction.objectStore('cards').delete(id),
    ),
    ...removedDecks.map(({ id }) =>
      transaction.objectStore('decks').delete(id),
    ),
    ...removedPages.map(({ id }) =>
      transaction.objectStore('pages').delete(id),
    ),
    ...oldOps.map(({ id }) => transaction.objectStore('ops').delete(id)),
  ];
  await Promise.all([...writes, transaction.done]);
  return removedCards.length + removedDecks.length + removedPages.length;
}
