import { CardSchema, DeckSchema, type Op } from 'deck-schema';
import type { DeckDatabaseHandle } from './database';

export async function expireSessions(
  database: DeckDatabaseHandle,
  time: number,
  makeOp: (entity: 'deck' | 'card', id: string) => Op,
): Promise<number> {
  const tx = database.transaction(['decks', 'cards', 'ops'], 'readwrite');
  const decks = (await tx.objectStore('decks').getAll())
    .filter(
      ({ kind, deletedAt, expiresAt }) =>
        kind === 'session' &&
        deletedAt === null &&
        expiresAt !== undefined &&
        expiresAt <= time,
    )
    .map((deck) => DeckSchema.parse(deck));
  const ids = new Set(decks.map(({ id }) => id));
  const cards = (await tx.objectStore('cards').getAll())
    .filter(({ deckId, deletedAt }) => ids.has(deckId) && deletedAt === null)
    .map((card) => CardSchema.parse(card));
  const records = [
    ...decks.map((value) => ({ entity: 'deck' as const, value })),
    ...cards.map((value) => ({ entity: 'card' as const, value })),
  ];
  const prepared = records.map(({ entity, value }) => ({
    entity,
    value,
    op: makeOp(entity, value.id),
  }));
  const writes = prepared.flatMap(({ entity, value, op }) => [
    tx
      .objectStore(entity === 'deck' ? 'decks' : 'cards')
      .put({ ...value, deletedAt: time, updatedAt: time }),
    tx.objectStore('ops').put(op),
  ]);
  await Promise.all([...writes, tx.done]);
  return decks.length;
}
