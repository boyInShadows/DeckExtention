import { CardSchema, type Card, type Op } from 'deck-schema';
import type { DeckDatabaseHandle } from './database';

export async function markCardsOpened(
  database: DeckDatabaseHandle,
  ids: string[],
  time: number,
  makeOp: (card: Card) => Op,
): Promise<void> {
  const tx = database.transaction(['cards', 'ops'], 'readwrite');
  const records = await Promise.all(
    [...new Set(ids)].map((id) => tx.objectStore('cards').get(id)),
  );
  const prepared = records
    .filter((record) => record && record.deletedAt === null)
    .map((record) => {
      const card = CardSchema.parse({
        ...record,
        lastOpenedAt: time,
        updatedAt: time,
      });
      return { card, op: makeOp(card) };
    });
  const writes = prepared.flatMap(({ card, op }) => [
    tx.objectStore('cards').put(card),
    tx.objectStore('ops').put(op),
  ]);
  await Promise.all([...writes, tx.done]);
}
