import 'fake-indexeddb/auto';

import {
  INBOX_DECK_ID,
  SETTINGS_DEFAULTS,
  type Card,
  type Deck,
  type Page,
} from 'deck-schema';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeckRepository } from '../storage/repository';
import { openDeckDatabase } from '../storage/database';
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
  it('starts independent reads before a slow card read completes', async () => {
    const store = openRepository();
    let finishCards: (cards: Card[]) => void = () => undefined;
    const pendingCards = new Promise<Card[]>((resolve) => {
      finishCards = resolve;
    });
    vi.spyOn(store, 'listCards').mockReturnValueOnce(pendingCards);
    const listDecks = vi.spyOn(store, 'listDecks');
    const listPages = vi.spyOn(store, 'listPages');
    const getSettings = vi.spyOn(store, 'getSettings');
    const hydration = hydrateSurface(store);

    try {
      expect(listDecks).toHaveBeenCalledOnce();
      expect(listPages).toHaveBeenCalledOnce();
      expect(getSettings).toHaveBeenCalledOnce();
    } finally {
      finishCards([]);
      await hydration;
    }
  });

  it('seeds the examples on a fresh store', async () => {
    const data = await hydrateSurface(openRepository());
    expect(data.pages.map(({ id }) => id)).toEqual(['page_examples']);
    expect(data.cards).toHaveLength(6);
    expect(data.decks.map(({ kind }) => kind).toSorted()).toEqual([
      'inbox',
      'normal',
    ]);
  });

  it('rejects a failed startup read without reseeding stored records', async () => {
    const store = openRepository();
    await store.upsertPage(page);
    await store.upsertDeck({ ...trashedDeck, deletedAt: null });
    await store.upsertCard(inboxCard);
    const upsertPage = vi.spyOn(store, 'upsertPage');
    const upsertDeck = vi.spyOn(store, 'upsertDeck');
    vi.spyOn(store, 'getSettings').mockRejectedValueOnce(
      new Error('read failed'),
    );

    await expect(hydrateSurface(store)).rejects.toThrow('read failed');

    expect(upsertPage).not.toHaveBeenCalled();
    expect(upsertDeck).not.toHaveBeenCalled();
    expect(await store.listCards()).toEqual([inboxCard]);
    expect(await store.listPages()).toEqual([page]);
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
    expect(await store.listCards()).toEqual([
      { ...editedExample, deckId: INBOX_DECK_ID },
    ]);

    const recovered = decks.find(({ id }) => id === data.defaultDeckId);
    expect(recovered).toMatchObject({
      kind: 'normal',
      pageId: page.id,
      deletedAt: null,
    });
    expect(recovered?.id).not.toBe(trashedDeck.id);
  });

  it('moves older pins into Inbox once, atomically preserving them on failure', async () => {
    const store = openRepository();
    await store.upsertPage(page);
    await store.upsertDeck({ ...trashedDeck, deletedAt: null });
    await store.upsertCard(editedExample);
    await store.upsertCard({ ...editedExample, id: 'another_pin' });
    const upsertMany = vi.spyOn(store, 'upsertMany');
    upsertMany.mockRejectedValueOnce(new Error('disk full'));

    await expect(hydrateSurface(store)).rejects.toThrow('disk full');
    expect(await store.listCards()).toEqual([
      { ...editedExample, id: 'another_pin' },
      editedExample,
    ]);

    const hydrated = await hydrateSurface(store);
    expect(hydrated.cards).toHaveLength(2);
    expect(hydrated.cards.every(({ deckId }) => deckId === INBOX_DECK_ID)).toBe(
      true,
    );
    expect(await store.listCards()).toEqual(hydrated.cards);
    await hydrateSurface(store);
    expect(upsertMany).toHaveBeenCalledTimes(2);
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

  it('renders valid records and reports a corrupt card without deleting it', async () => {
    const store = openRepository();
    await store.upsertPage(page);
    await store.upsertDeck({ ...trashedDeck, deletedAt: null });
    const database = await openDeckDatabase(DATABASE_NAME);
    const corrupt = { ...editedExample, id: 'seed0' };
    await database.put('cards', corrupt as never);

    const data = await hydrateSurface(store);

    expect(data.pages).toEqual([page]);
    expect(data.cards).toEqual([]);
    expect(store.getRecoveryIssueCount()).toBe(1);
    expect(await database.get('cards', 'seed0')).toEqual(corrupt);
    database.close();
  });

  it('uses safe settings and a valid page when stored settings and a deck are corrupt', async () => {
    const store = openRepository();
    await store.upsertPage(page);
    await store.upsertDeck({ ...trashedDeck, deletedAt: null });
    const database = await openDeckDatabase(DATABASE_NAME);
    await database.put('decks', { ...trashedDeck, title: 42 } as never);
    await database.put('meta', {
      key: 'settings',
      value: { ...SETTINGS_DEFAULTS, ownerName: 42 },
    });

    const data = await hydrateSurface(store);

    expect(data.pages).toContainEqual(page);
    expect(data.settings).toEqual(SETTINGS_DEFAULTS);
    expect(store.getRecoveryIssueCount()).toBe(2);
    expect(await database.get('decks', trashedDeck.id)).toMatchObject({
      title: 42,
    });
    database.close();
  });
});
