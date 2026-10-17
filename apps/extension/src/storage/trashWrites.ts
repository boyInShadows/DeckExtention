import {
  CardSchema,
  DeckSchema,
  PageSchema,
  type Card,
  type Op,
  type OpEntity,
} from 'deck-schema';

import type { DeckDatabaseHandle } from './database';
import { SESSION_LIFETIME_MS } from '../sessions/constants';

type TrashEntity = Exclude<OpEntity, 'settings'>;
type TrashKind = 'delete' | 'restore';
type MakeOp = (entity: TrashEntity, id: string, kind: TrashKind) => Op;

export async function changeDeletion(
  database: DeckDatabaseHandle,
  entity: TrashEntity,
  id: string,
  deletedAt: number | null,
  now: () => number,
  makeOp: MakeOp,
): Promise<void> {
  const storeName = `${entity}s` as 'pages' | 'decks' | 'cards';
  const kind = deletedAt === null ? 'restore' : 'delete';
  const transaction = database.transaction([storeName, 'ops'], 'readwrite');
  const existing = await transaction.objectStore(storeName).get(id);
  if (!existing) throw new Error(`Cannot ${kind} missing ${entity} ${id}`);
  await transaction.objectStore(storeName).put({
    ...existing,
    deletedAt,
    updatedAt: now(),
  });
  await transaction.objectStore('ops').put(makeOp(entity, id, kind));
  await transaction.done;
}

export async function changeCards(
  database: DeckDatabaseHandle,
  ids: string[],
  isRestore: boolean,
  now: () => number,
  makeOp: MakeOp,
): Promise<Card[]> {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return [];
  const transaction = database.transaction(['cards', 'ops'], 'readwrite');
  const store = transaction.objectStore('cards');
  const raw = await Promise.all(uniqueIds.map((id) => store.get(id)));
  const kind = isRestore ? 'restore' : 'delete';
  const records = raw.map((value, index) => {
    if (!value)
      throw new Error(`Cannot ${kind} missing card ${uniqueIds[index]}`);
    return CardSchema.parse(value);
  });
  if (records.some(({ deletedAt }) => (deletedAt !== null) !== isRestore))
    throw new Error(`Cannot ${isRestore ? 'restore' : 'trash'} these cards`);
  const time = now();
  const next = records.map((card) => ({
    ...card,
    deletedAt: isRestore ? null : time,
    updatedAt: time,
  }));
  const writes = next.flatMap((card) => [
    store.put(card),
    transaction.objectStore('ops').put(makeOp('card', card.id, kind)),
  ]);
  await Promise.all([...writes, transaction.done]);
  return next;
}

export async function changeTree(
  database: DeckDatabaseHandle,
  entity: 'page' | 'deck',
  id: string,
  isRestore: boolean,
  now: () => number,
  makeOp: MakeOp,
): Promise<void> {
  const transaction = database.transaction(
    ['pages', 'decks', 'cards', 'ops'],
    'readwrite',
  );
  const rootStore = entity === 'page' ? 'pages' : 'decks';
  const rawRoot = await transaction.objectStore(rootStore).get(id);
  if (!rawRoot) throw new Error(`Cannot change missing ${entity} ${id}`);
  const root =
    entity === 'page' ? PageSchema.parse(rawRoot) : DeckSchema.parse(rawRoot);
  if ((root.deletedAt !== null) !== isRestore)
    throw new Error(
      `Cannot ${isRestore ? 'restore' : 'trash'} ${entity} ${id}`,
    );
  const deletedAt = isRestore ? null : now();
  const matchingStamp = isRestore ? root.deletedAt : null;
  const allDecks = await transaction.objectStore('decks').getAll();
  const childDecks =
    entity === 'page'
      ? allDecks
          .filter(
            (deck) =>
              deck.pageId === id &&
              deck.kind === 'normal' &&
              deck.deletedAt === matchingStamp,
          )
          .map((deck) => DeckSchema.parse(deck))
      : [];
  const deckIds = new Set(
    entity === 'deck' ? [id] : childDecks.map(({ id }) => id),
  );
  const allCards = await transaction.objectStore('cards').getAll();
  const childCards = allCards
    .filter(
      (card) => deckIds.has(card.deckId) && card.deletedAt === matchingStamp,
    )
    .map((card) => CardSchema.parse(card));
  const changes = [
    { entity, value: root },
    ...childDecks.map((value) => ({ entity: 'deck' as const, value })),
    ...childCards.map((value) => ({ entity: 'card' as const, value })),
  ];
  const kind = isRestore ? 'restore' : 'delete';
  const writes = changes.flatMap(({ entity: itemEntity, value }) => {
    const next = {
      ...value,
      deletedAt,
      updatedAt: now(),
      ...('kind' in value &&
      value.kind === 'session' &&
      isRestore &&
      'expiresAt' in value &&
      value.expiresAt !== undefined
        ? { expiresAt: now() + SESSION_LIFETIME_MS }
        : {}),
    };
    const storeName =
      itemEntity === 'page'
        ? 'pages'
        : itemEntity === 'deck'
          ? 'decks'
          : 'cards';
    return [
      transaction.objectStore(storeName).put(next),
      transaction.objectStore('ops').put(makeOp(itemEntity, value.id, kind)),
    ];
  });
  await Promise.all([...writes, transaction.done]);
}
