import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Deck, Card } from 'deck-schema';

import { DeckRepository } from './repository';
import { SESSION_LIFETIME_MS } from '../sessions/constants';

const DATABASE = 'deck-session-expiry-test';
const NOW = 1_800_000_000_000;
let repository: DeckRepository;
const deck = (id: string, expiresAt?: number): Deck => ({
  id,
  pageId: 'page_example',
  title: id,
  kind: 'session',
  order: 'a0',
  color: null,
  isCollapsed: false,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  ...(expiresAt === undefined ? {} : { expiresAt }),
});
const card = (id: string, deckId: string): Card => ({
  id,
  deckId,
  title: id,
  url: 'https://example.com/',
  hostname: 'example.com',
  pinned: false,
  order: 'a0',
  lastOpenedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});
beforeEach(async () => {
  repository = new DeckRepository({ databaseName: DATABASE, now: () => NOW });
  await repository.upsertMany({
    pages: [
      {
        id: 'page_example',
        title: 'Work',
        order: 'a0',
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      },
    ],
    decks: [
      deck('expired_deck', NOW),
      deck('future_deck', NOW + 1),
      deck('pinned_deck'),
      { ...deck('normal_deck', NOW - 1), kind: 'normal' },
    ],
    cards: [
      card('expired_card', 'expired_deck'),
      { ...card('older_trash', 'expired_deck'), deletedAt: NOW - 5 },
      card('future_card', 'future_deck'),
      card('moved_card', 'normal_deck'),
    ],
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await repository.close();
  await deleteDB(DATABASE);
});

it('moves only expired sessions and their active children to recoverable Trash', async () => {
  expect(await repository.expireSessions()).toBe(1);
  expect(
    (await repository.listDecks())
      .filter(({ deletedAt }) => deletedAt !== null)
      .map(({ id }) => id),
  ).toEqual(['expired_deck']);
  const cards = await repository.listCards();
  expect(cards.find(({ id }) => id === 'expired_card')?.deletedAt).toBe(NOW);
  expect(cards.find(({ id }) => id === 'older_trash')?.deletedAt).toBe(NOW - 5);
  expect(cards.find(({ id }) => id === 'moved_card')?.deletedAt).toBeNull();
  expect(await repository.expireSessions()).toBe(0);
  await repository.restoreDeck('expired_deck');
  expect(
    (await repository.listDecks()).find(({ id }) => id === 'expired_deck'),
  ).toMatchObject({ deletedAt: null, expiresAt: NOW + SESSION_LIFETIME_MS });
  expect(await repository.expireSessions()).toBe(0);
  expect(
    (await repository.listCards()).find(({ id }) => id === 'expired_card')
      ?.deletedAt,
  ).toBeNull();
});

it('preserves a session when its user page is trashed and restores its links from export', async () => {
  await repository.trashPage('page_example');
  expect(
    (await repository.listDecks()).find(({ id }) => id === 'pinned_deck')
      ?.deletedAt,
  ).toBeNull();
  const original = await repository.readDocument(NOW);
  await repository.close();
  await deleteDB(DATABASE);
  repository = new DeckRepository({ databaseName: DATABASE, now: () => NOW });
  await repository.replaceDocument(original);
  expect(await repository.readDocument(NOW)).toEqual(original);
});

it('aborts expiry without touching stored links when creating a delete operation fails', async () => {
  const { expireSessions } = await import('./sessionExpiry');
  const { openDeckDatabase } = await import('./database');
  const database = await openDeckDatabase(DATABASE);
  const before = await repository.readDocument(NOW);
  await expect(
    expireSessions(database, NOW, () => {
      throw new Error('invalid operation');
    }),
  ).rejects.toThrow('invalid operation');
  expect(await repository.readDocument(NOW)).toEqual(before);
  database.close();
});
