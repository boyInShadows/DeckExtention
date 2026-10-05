import 'fake-indexeddb/auto';

import { INBOX_DECK_ID, type Card, type Deck, type Page } from 'deck-schema';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';

import { DeckRepository } from '../storage/repository';
import { hydrateSurface } from './bootstrap';

const DATABASE_NAME = 'deck-bootstrap-test';
let repository: DeckRepository | undefined;

function openRepository(): DeckRepository {
  repository = new DeckRepository({ databaseName: DATABASE_NAME });
  return repository;
}

afterEach(async () => {
  await repository?.close();
  await deleteDB(DATABASE_NAME);
});

const page: Page = {
  id: 'page_examples',
  title: 'Reading list',
  order: 'b5',
  createdAt: 1,
  updatedAt: 7,
  deletedAt: null,
};

const trashedDeck: Deck = {
  id: 'deck_examples',
  pageId: page.id,
  title: 'Examples',
  kind: 'normal',
  order: 'a0',
  color: null,
  isCollapsed: false,
  createdAt: 1,
  updatedAt: 9,
  deletedAt: 9,
};

const editedExample: Card = {
  id: 'example_mdn',
  deckId: 'deck_examples',
  url: 'https://developer.mozilla.org/',
  title: 'MDN',
  hostname: 'developer.mozilla.org',
  order: 'a0',
  pinned: true,
  note: 'mine',
  lastOpenedAt: null,
  createdAt: 1,
  updatedAt: 8,
  deletedAt: null,
};

const inboxCard: Card = {
  ...editedExample,
  id: 'card_saved',
  deckId: INBOX_DECK_ID,
  url: 'https://saved.test/',
  pinned: false,
  note: undefined,
};

describe('hydrateSurface', () => {
  it('seeds the examples on a fresh store', async () => {
    const data = await hydrateSurface(openRepository());
    expect(data.pages.map(({ id }) => id)).toEqual(['page_examples']);
    expect(data.cards).toHaveLength(6);
    expect(data.decks.map(({ kind }) => kind).toSorted()).toEqual([
      'inbox',
      'normal',
    ]);
  });

  it('keeps Inbox cards Quick Save wrote before the first new tab', async () => {
    const store = openRepository();
    await store.upsertDeck({
      ...trashedDeck,
      id: INBOX_DECK_ID,
      kind: 'inbox',
      deletedAt: null,
    });
    await store.upsertCard(inboxCard);
    const data = await hydrateSurface(store);
    expect(data.cards.map(({ id }) => id)).toContain('card_saved');
    expect(await store.listCards()).toContainEqual(inboxCard);
  });

  it('never reseeds over a user who trashed their last deck', async () => {
    const store = openRepository();
    await store.upsertPage(page);
    await store.upsertDeck(trashedDeck);
    await store.upsertCard(editedExample);
    const data = await hydrateSurface(store);

    expect(await store.listPages()).toEqual([page]);
    const decks = await store.listDecks();
    expect(decks).toContainEqual(trashedDeck);
    expect(await store.listCards()).toEqual([editedExample]);

    const recovered = decks.find(({ id }) => id === data.defaultDeckId);
    expect(recovered).toMatchObject({
      kind: 'normal',
      pageId: page.id,
      deletedAt: null,
    });
    expect(recovered?.id).not.toBe(trashedDeck.id);
  });

  it('adds a page too when every page is trashed', async () => {
    const store = openRepository();
    await store.upsertPage({ ...page, deletedAt: 9 });
    await store.upsertDeck(trashedDeck);
    const data = await hydrateSurface(store);
    const pages = await store.listPages();
    expect(pages).toHaveLength(2);
    expect(pages).toContainEqual({ ...page, deletedAt: 9 });
    const deck = data.decks.find(({ id }) => id === data.defaultDeckId);
    expect(pages.find(({ id }) => id === deck?.pageId)?.deletedAt).toBeNull();
  });
});
