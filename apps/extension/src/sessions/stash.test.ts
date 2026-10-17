import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeckRepository } from '../storage/repository';
import { stashWindow, undoStash } from './stash';
import { SESSION_LIFETIME_MS } from './constants';
import { saveToInbox } from '../capture/quickSave';

const DATABASE = 'deck-stash-test';
const NOW = new Date(2026, 8, 8, 14, 2).getTime();
let repository: DeckRepository;
const tab = (id: number, change = {}) => ({
  id,
  windowId: 7,
  index: id,
  pinned: false,
  url: `https://example.com/${id}`,
  title: `Research ${id}`,
  ...change,
});
let api: ReturnType<typeof mockChrome>;
function mockChrome() {
  return {
    tabs: {
      query: vi
        .fn()
        .mockResolvedValue(Array.from({ length: 30 }, (_, i) => tab(i + 1))),
      get: vi.fn(async (id: number) => tab(id)),
      create: vi.fn().mockResolvedValue({ id: 99 }),
      update: vi.fn().mockResolvedValue({}),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  };
}
beforeEach(() => {
  repository = new DeckRepository({ databaseName: DATABASE });
  api = mockChrome();
  vi.stubGlobal('chrome', api);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await repository.close();
  await deleteDB(DATABASE);
});

describe('stashWindow', () => {
  it('commits all 30 links before opening Deck or closing a tab; Undo retains the backup', async () => {
    api.tabs.create.mockImplementation(async () => {
      expect(await repository.listCards()).toHaveLength(30);
      return { id: 99 };
    });
    api.tabs.remove.mockImplementation(async () => {
      expect(await repository.listCards()).toHaveLength(30);
      expect(await repository.listDecks()).toHaveLength(1);
    });
    const saved = await stashWindow(repository, 7, () => NOW);
    expect(saved?.count).toBe(30);
    expect(api.tabs.query).toHaveBeenCalledWith({ windowId: 7 });
    const [deck] = await repository.listDecks();
    expect(deck).toMatchObject({
      kind: 'session',
      expiresAt: NOW + SESSION_LIFETIME_MS,
    });
    expect(deck?.title).toBe('Tue 8 Sep, 14:02 · 30 tabs');
    if (!deck) throw new Error('Session was not saved');
    expect(
      await saveToInbox(repository, {
        url: 'https://example.com/1',
        title: 'Research 1',
        hostname: 'example.com',
      }),
    ).toMatchObject({
      kind: 'duplicate',
      pageId: 'sessions',
      location: deck.title,
    });
    await undoStash(repository, deck.id, 7);
    expect(api.tabs.create).toHaveBeenCalledTimes(31);
    expect(
      (await repository.listCards()).every(
        ({ deletedAt }) => deletedAt === null,
      ),
    ).toBe(true);
  });

  it('skips pinned, Deck, internal, unsupported and missing-id tabs; preserves order and duplicates', async () => {
    api.tabs.get.mockImplementation(async (id: number) =>
      tab(id, id === 8 ? { url: 'https://example.com/7' } : {}),
    );
    api.tabs.query.mockResolvedValue([
      tab(1, { pinned: true }),
      tab(2, { url: 'chrome://settings' }),
      tab(3, { url: 'chrome-extension://deck/index.html' }),
      tab(4, { id: undefined }),
      tab(5, { url: 'file:///private.txt' }),
      tab(7, { index: 9 }),
      tab(6, { index: 8 }),
      tab(8, { index: 10, url: 'https://example.com/7' }),
    ]);
    const saved = await stashWindow(repository, 7, () => NOW);
    expect(saved?.count).toBe(3);
    expect(api.tabs.remove.mock.calls.map(([id]) => id)).toEqual([6, 7, 8]);
    expect((await repository.listCards()).map(({ url }) => url).sort()).toEqual(
      [
        'https://example.com/6',
        'https://example.com/7',
        'https://example.com/7',
      ],
    );
  });

  it('closes nothing after a failed bulk write', async () => {
    vi.spyOn(repository, 'upsertMany').mockRejectedValue(
      new Error('disk full'),
    );
    await expect(stashWindow(repository, 7, () => NOW)).rejects.toThrow(
      'disk full',
    );
    expect(api.tabs.remove).not.toHaveBeenCalled();
    expect(await repository.listCards()).toEqual([]);
  });

  it('lets validation reject the entire batch before closing anything', async () => {
    api.tabs.query.mockResolvedValue([
      tab(1),
      tab(2, { url: `https://example.com/${'x'.repeat(4100)}` }),
    ]);
    await expect(stashWindow(repository, 7, () => NOW)).rejects.toThrow();
    expect(api.tabs.remove).not.toHaveBeenCalled();
    expect(await repository.listDecks()).toEqual([]);
  });

  it('does not close a tab that navigated or became pinned after the save', async () => {
    api.tabs.query.mockResolvedValue([tab(1), tab(2), tab(3)]);
    api.tabs.get.mockImplementation(async (id: number) =>
      tab(
        id,
        id === 1
          ? { url: 'https://changed.test/' }
          : id === 2
            ? { pinned: true }
            : {},
      ),
    );
    const result = await stashWindow(repository, 7, () => NOW);
    expect(result).toMatchObject({ count: 3, remaining: 2 });
    expect(api.tabs.remove).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('keeps every saved link and reports a partial close failure', async () => {
    api.tabs.query.mockResolvedValue([tab(1), tab(2)]);
    api.tabs.remove.mockRejectedValueOnce(new Error('tab busy'));
    expect(await stashWindow(repository, 7, () => NOW)).toMatchObject({
      count: 2,
      remaining: 1,
    });
    expect(await repository.listCards()).toHaveLength(2);
  });

  it('does nothing for a window with no eligible tabs', async () => {
    api.tabs.query.mockResolvedValue([tab(1, { pinned: true })]);
    expect(await stashWindow(repository, 7, () => NOW)).toBeNull();
    expect(await repository.listDecks()).toEqual([]);
    expect(api.tabs.remove).not.toHaveBeenCalled();
  });

  it('rejects Undo for a non-session and reports partial reopen failures', async () => {
    await expect(undoStash(repository, 'missing_deck', 7)).rejects.toThrow();
    const result = await stashWindow(repository, 7, () => NOW);
    api.tabs.create.mockRejectedValueOnce(new Error('window closed'));
    if (!result) throw new Error('Session was not saved');
    await expect(undoStash(repository, result.deckId, 7)).rejects.toThrow(
      'window closed',
    );
    expect(await repository.listCards()).toHaveLength(30);
  });
});
