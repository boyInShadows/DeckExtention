import 'fake-indexeddb/auto';
import { type Card, type Deck, type Page } from 'deck-schema';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeckRepository } from '../../src/storage/repository';
import { findSavedLink } from '../../src/capture/manualDuplicate';

const DATABASE = 'manual-duplicates-test';
const page: Page = {
  id: 'page_work',
  title: 'Work',
  order: 'a0',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const deck: Deck = {
  id: 'reading',
  pageId: page.id,
  title: 'Reading',
  kind: 'normal',
  order: 'a0',
  color: null,
  isCollapsed: false,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const card: Card = {
  id: 'existing',
  deckId: deck.id,
  title: 'Example',
  url: 'https://example.com/',
  hostname: 'example.com',
  order: 'a0',
  pinned: false,
  lastOpenedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
let repository: DeckRepository;

beforeEach(async () => {
  repository = new DeckRepository({ databaseName: DATABASE });
  await repository.upsertPage(page);
  await repository.upsertDeck(deck);
  await repository.upsertCard(card);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await repository.close();
  await deleteDB(DATABASE);
});

it('normalizes equivalent URLs and identifies the persisted workspace without changing data', async () => {
  const before = await repository.readDocument(1);
  expect(await findSavedLink(repository, ' HTTPS://EXAMPLE.COM:443 ')).toEqual({
    card,
    location: 'Work › Reading',
  });
  expect(await repository.readDocument(1)).toEqual(before);
});

it.each([
  'http://example.com/',
  'https://www.example.com/',
  'https://example.com/a',
  'https://example.com/?q=1',
  'https://example.com/#one',
])('keeps distinct URL %s', async (url) => {
  expect(await findSavedLink(repository, url)).toBeNull();
});

it('normalizes older persisted spellings with the existing URL parser', async () => {
  await repository.upsertCard({ ...card, url: 'https://EXAMPLE.COM:443' });
  expect(
    (await findSavedLink(repository, 'https://example.com/'))?.card.id,
  ).toBe(card.id);
});

it.each(['card', 'deck', 'page'] as const)(
  'ignores a deleted %s',
  async (entity) => {
    if (entity === 'card')
      await repository.upsertCard({ ...card, deletedAt: 2 });
    if (entity === 'deck')
      await repository.upsertDeck({ ...deck, deletedAt: 2 });
    if (entity === 'page')
      await repository.upsertPage({ ...page, deletedAt: 2 });
    expect(await findSavedLink(repository, card.url ?? '')).toBeNull();
  },
);

it('finds Pins, Inbox and Sessions without relying on the currently displayed page', async () => {
  await repository.upsertCard({ ...card, pinned: true });
  expect(
    (await findSavedLink(repository, 'https://example.com/'))?.location,
  ).toBe('Pins');
  await repository.upsertCard(card);
  await repository.upsertDeck({ ...deck, kind: 'inbox' });
  expect(
    (await findSavedLink(repository, 'https://example.com/'))?.location,
  ).toBe('Inbox');
  await repository.upsertDeck({ ...deck, kind: 'session', title: 'Yesterday' });
  expect(
    (await findSavedLink(repository, 'https://example.com/'))?.location,
  ).toBe('Yesterday');
});

it.each(['javascript:alert(1)', 'file:///D:/notes', 'not a url'])(
  'rejects invalid manual input %s before storage reads',
  async (input) => {
    const read = vi.spyOn(repository, 'listCards');
    await expect(findSavedLink(repository, input)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  },
);

it.each(['listCards', 'listDecks', 'listPages'] as const)(
  'propagates %s failures without treating them as absence',
  async (method) => {
    vi.spyOn(repository, method).mockRejectedValue(new Error('read failed'));
    await expect(
      findSavedLink(repository, 'https://example.com/'),
    ).rejects.toThrow('read failed');
  },
);
