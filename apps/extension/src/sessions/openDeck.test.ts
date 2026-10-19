import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateNKeysBetween } from 'fractional-indexing';
import { DeckRepository } from '../storage/repository';
import { openDeck } from './openDeck';
import { openDeckDatabase } from '../storage/database';
import { changeTree } from '../storage/trashWrites';
import { markCardsOpened } from '../storage/cardOpened';

const DATABASE = 'deck-open-test';
const NOW = 1_800_000_000_000;
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture');
  return value;
}
let repository: DeckRepository;
const api = {
  tabs: {
    create: vi.fn(),
    group: vi.fn().mockResolvedValue(44),
    update: vi.fn().mockResolvedValue({}),
  },
  tabGroups: { update: vi.fn().mockResolvedValue({}) },
};
beforeEach(async () => {
  repository = new DeckRepository({ databaseName: DATABASE, now: () => NOW });
  api.tabs.create.mockImplementation(async () => ({
    id: api.tabs.create.mock.calls.length,
  }));
  vi.stubGlobal('chrome', api);
  await repository.upsertMany({
    decks: [
      {
        id: 'deck_test',
        pageId: 'page_test',
        title: 'Research',
        kind: 'session',
        order: 'a0',
        color: 'amber',
        isCollapsed: false,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      },
    ],
    cards: generateNKeysBetween(null, null, 65).map((order, index) => ({
      id: `card_${index}`,
      deckId: 'deck_test',
      title: `Link ${index}`,
      url: `https://example.com/${index}`,
      hostname: 'example.com',
      order,
      pinned: false,
      lastOpenedAt: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    })),
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await repository.close();
  await deleteDB(DATABASE);
});

it('groups all 65 links in order in the requested window, titles/colors the group and stamps every card', async () => {
  expect(await openDeck(repository, 'deck_test', 7, 'group')).toBe(65);
  expect(api.tabs.create).toHaveBeenCalledTimes(65);
  expect(api.tabs.create.mock.calls.map(([options]) => options)).toEqual(
    Array.from({ length: 65 }, (_, index) => ({
      windowId: 7,
      url: `https://example.com/${index}`,
      active: false,
    })),
  );
  expect(api.tabs.group).toHaveBeenCalledWith({
    tabIds: Array.from({ length: 65 }, (_, index) => index + 1),
  });
  expect(api.tabGroups.update).toHaveBeenCalledWith(44, {
    title: 'Research',
    color: 'yellow',
  });
  expect(api.tabs.update).toHaveBeenCalledWith(1, { active: true });
  expect(
    (await repository.listCards()).every((card) => card.lastOpenedAt === NOW),
  ).toBe(true);
});

it('skips URL-free tasks when opening links and refuses to trash a session containing an unrestored task', async () => {
  await repository.upsertCard({
    id: 'task_local',
    deckId: 'deck_test',
    kind: 'task',
    title: 'Unrestored note',
    hostname: '',
    order: 'a0',
    pinned: false,
    lastOpenedAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  });
  expect(await openDeck(repository, 'deck_test', 7)).toBe(65);
  expect(
    api.tabs.create.mock.calls.every(
      ([options]) => typeof options.url === 'string',
    ),
  ).toBe(true);
  expect(
    (await repository.listCards()).find((card) => card.id === 'task_local')
      ?.lastOpenedAt,
  ).toBeNull();
  api.tabs.create.mockClear();
  await expect(
    openDeck(repository, 'deck_test', 7, 'restore-and-trash'),
  ).rejects.toThrow('Move URL-free tasks');
  expect(api.tabs.create).not.toHaveBeenCalled();
  expect(
    (await repository.listCards()).find((card) => card.id === 'task_local')
      ?.deletedAt,
  ).toBeNull();
});

it('restores without removing the session unless removal was selected; Trash remains recoverable', async () => {
  await openDeck(repository, 'deck_test', 7, 'restore');
  expect((await repository.listDecks())[0]?.deletedAt).toBeNull();
  await openDeck(repository, 'deck_test', 7, 'restore-and-trash');
  expect((await repository.listDecks())[0]?.deletedAt).toBe(NOW);
  await repository.restoreDeck('deck_test');
  expect(
    (await repository.listCards()).filter((card) => card.deletedAt === null),
  ).toHaveLength(65);
});

it('reports partial opens, stamps only those opened and preserves the complete session', async () => {
  api.tabs.create.mockRejectedValueOnce(new Error('window closed'));
  await expect(
    openDeck(repository, 'deck_test', 7, 'restore-and-trash'),
  ).rejects.toThrow('0 of 65');
  api.tabs.create
    .mockResolvedValueOnce({ id: 1 })
    .mockRejectedValueOnce(new Error('tab busy'));
  await expect(
    openDeck(repository, 'deck_test', 7, 'restore-and-trash'),
  ).rejects.toThrow('1 of 65');
  expect((await repository.listDecks())[0]?.deletedAt).toBeNull();
  expect(
    (await repository.listCards()).filter((card) => card.lastOpenedAt === NOW),
  ).toHaveLength(1);
});

it('keeps the session after grouping or timestamp persistence fails', async () => {
  api.tabGroups.update.mockRejectedValueOnce(new Error('permission revoked'));
  await expect(openDeck(repository, 'deck_test', 7, 'group')).rejects.toThrow(
    'permission revoked',
  );
  vi.spyOn(repository, 'markCardsOpened').mockRejectedValue(
    new Error('disk full'),
  );
  await expect(
    openDeck(repository, 'deck_test', 7, 'restore-and-trash'),
  ).rejects.toThrow('disk full');
  expect((await repository.listDecks())[0]?.deletedAt).toBeNull();
});

it('stamps the latest card without overwriting a concurrent title edit', async () => {
  api.tabs.create.mockImplementationOnce(async () => {
    const card = required(
      (await repository.listCards()).find((card) => card.id === 'card_0'),
    );
    await repository.upsertCard({
      ...card,
      title: 'Edited while opening',
      note: 'Keep me',
    });
    return { id: 1 };
  });
  await openDeck(repository, 'deck_test', 7);
  expect(
    (await repository.listCards()).find((card) => card.id === 'card_0'),
  ).toMatchObject({
    title: 'Edited while opening',
    note: 'Keep me',
    lastOpenedAt: NOW,
  });
});

it('rejects missing, deleted, empty and invalid decks before opening a tab', async () => {
  await expect(openDeck(repository, 'missing', 7)).rejects.toThrow();
  const card = required((await repository.listCards())[0]);
  await repository.upsertCard({ ...card, url: 'javascript:alert(1)' });
  await expect(openDeck(repository, 'deck_test', 7)).rejects.toThrow();
  expect(api.tabs.create).not.toHaveBeenCalled();
  await repository.trashDeck('deck_test');
  await expect(openDeck(repository, 'deck_test', 7)).rejects.toThrow();
});

it('does not partially trash a restored session if preparing an operation fails', async () => {
  const database = await openDeckDatabase(DATABASE);
  const before = await repository.readDocument(NOW);
  const [op] = await repository.listOps();
  let calls = 0;
  try {
    await expect(
      changeTree(
        database,
        'deck',
        'deck_test',
        false,
        () => NOW,
        () => {
          if (++calls === 2) throw new Error('invalid operation');
          return required(op);
        },
      ),
    ).rejects.toThrow('invalid operation');
    expect(await repository.readDocument(NOW)).toEqual(before);
  } finally {
    database.close();
  }
});

it('writes no timestamps or operations when preparing a timestamp batch fails', async () => {
  const database = await openDeckDatabase(DATABASE);
  const before = await repository.readDocument(NOW);
  const ops = await repository.listOps();
  let calls = 0;
  try {
    await expect(
      markCardsOpened(database, ['card_0', 'card_1'], NOW, () => {
        if (++calls === 2) throw new Error('invalid operation');
        return required(ops[0]);
      }),
    ).rejects.toThrow('invalid operation');
    expect(await repository.readDocument(NOW)).toEqual(before);
    expect(await repository.listOps()).toEqual(ops);
  } finally {
    database.close();
  }
});

it('ignores missing/deleted timestamp targets and does not resurrect a link', async () => {
  await repository.softDelete('card', 'card_0');
  await repository.markCardsOpened(['card_0', 'card_1', 'card_1', 'missing']);
  const cards = await repository.listCards();
  expect(cards.find((card) => card.id === 'card_0')).toMatchObject({
    deletedAt: NOW,
    lastOpenedAt: null,
  });
  expect(cards.find((card) => card.id === 'card_1')?.lastOpenedAt).toBe(NOW);
});

it('rejects empty decks, missing tab IDs and removing a non-session', async () => {
  const deck = required((await repository.listDecks())[0]);
  await repository.upsertDeck({ ...deck, kind: 'normal' });
  await expect(
    openDeck(repository, deck.id, 7, 'restore-and-trash'),
  ).rejects.toThrow();
  api.tabs.create.mockResolvedValueOnce({});
  await expect(openDeck(repository, deck.id, 7)).rejects.toThrow('0 of 65');
  await repository.trashCards(
    (await repository.listCards()).map((card) => card.id),
  );
  await expect(openDeck(repository, deck.id, 7)).rejects.toThrow(
    'no saved links',
  );
});
