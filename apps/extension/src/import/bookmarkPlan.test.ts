import 'fake-indexeddb/auto';

import type { Card, Deck, Page } from 'deck-schema';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeckRepository } from '../storage/repository';
import { applyBookmarkPlan, IMPORT_CHUNK_SIZE } from './bookmarkImport';
import {
  normalizeUrl,
  planBookmarkImport,
  type ExistingWorkspace,
} from './bookmarkPlan';
import type { BookmarkFolder, BookmarkNode } from './bookmarkTree';

const NOW = 1_800_000_000_000;
const EMPTY: ExistingWorkspace = { pages: [], decks: [], cards: [] };

function idFactory() {
  let sequence = 0;
  return () => `id_${String((sequence += 1)).padStart(6, '0')}`;
}

const link = (title: string, url: string): BookmarkNode => ({
  kind: 'link',
  title,
  url,
});

const folder = (
  title: string,
  children: BookmarkNode[],
  isContainer = false,
): BookmarkFolder => ({ kind: 'folder', title, isContainer, children });

/** Bar: 1 loose link, Work (loose + Docs + Docs/API), Empty; Other: Fun. */
const TREE = folder(
  '',
  [
    folder(
      'Bookmarks bar',
      [
        link('Loose', 'https://loose.example/'),
        folder('Work', [
          link('', 'https://work.example/'),
          folder('Docs', [
            link('MDN', 'https://developer.mozilla.org/'),
            folder('API', [link('Fetch', 'https://api.example/fetch')]),
          ]),
        ]),
        folder('Empty', [folder('Nothing', [])]),
      ],
      true,
    ),
    folder(
      'Other bookmarks',
      [
        folder('Fun', [
          link('Game', 'https://game.example/'),
          link('Same game', 'https://GAME.example/#again'),
          link('Script', 'javascript:alert(1)'),
          link('Settings', 'chrome://settings/'),
        ]),
      ],
      true,
    ),
  ],
  true,
);

const plan = (existing = EMPTY) =>
  planBookmarkImport(TREE, existing, { now: NOW, createId: idFactory() });

describe('planBookmarkImport', () => {
  it('maps folders to pages, subfolders to decks, links to cards', () => {
    const result = plan();
    expect(result.pages.map(({ title }) => title)).toEqual([
      'Bookmarks bar',
      'Work',
      'Fun',
    ]);
    expect(
      result.decks.map(({ title, pageId }) => [
        title,
        result.pages.find(({ id }) => id === pageId)?.title,
      ]),
    ).toEqual([
      ['Bookmarks bar', 'Bookmarks bar'],
      ['Work', 'Work'],
      ['Docs', 'Work'],
      ['Docs › API', 'Work'],
      ['Fun', 'Fun'],
    ]);
    expect(result.counts).toEqual({
      pages: 3,
      decks: 5,
      links: 5,
      duplicates: 1,
      unsupported: 2,
    });
  });

  it('titles an untitled link with its hostname and never fetches', () => {
    const work = plan().cards.find(
      ({ url }) => url === 'https://work.example/',
    );
    expect(work).toMatchObject({ title: 'work.example', pinned: false });
  });

  it('orders siblings without renumbering', () => {
    const { decks, pages } = plan();
    const workDecks = decks.filter(({ pageId }) => pageId === pages[1]?.id);
    const orders = workDecks.map(({ order }) => order);
    expect(orders).toEqual(orders.toSorted());
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('is idempotent: a second run against the result plans nothing', () => {
    const first = plan();
    const second = plan({
      pages: first.pages,
      decks: first.decks,
      cards: first.cards,
    });
    expect(second.pages).toEqual([]);
    expect(second.decks).toEqual([]);
    expect(second.cards).toEqual([]);
    expect(second.counts).toMatchObject({ links: 0, duplicates: 6 });
  });

  it('reuses a same-named page and deck and appends after existing cards', () => {
    const page: Page = {
      id: 'page_existing',
      title: 'fun',
      order: 'a5',
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
    const deck: Deck = {
      id: 'deck_existing',
      pageId: page.id,
      title: 'FUN',
      kind: 'normal',
      order: 'a0',
      color: null,
      isCollapsed: false,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
    const card: Card = {
      id: 'card_existing',
      deckId: deck.id,
      url: 'https://kept.example/',
      title: 'Kept',
      hostname: 'kept.example',
      order: 'a0',
      pinned: false,
      lastOpenedAt: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
    const result = plan({ pages: [page], decks: [deck], cards: [card] });
    expect(result.pages.map(({ title }) => title)).toEqual([
      'Bookmarks bar',
      'Work',
    ]);
    expect(result.pages.every(({ order }) => order > page.order)).toBe(true);
    const game = result.cards.find(
      ({ hostname }) => hostname === 'game.example',
    );
    expect(game).toMatchObject({ deckId: deck.id });
    expect(game && game.order > card.order).toBe(true);
  });

  it('ignores trashed records when matching', () => {
    const first = plan();
    const trashed = <T extends { deletedAt: number | null }>(records: T[]) =>
      records.map((record) => ({ ...record, deletedAt: NOW }));
    const second = plan({
      pages: trashed(first.pages),
      decks: trashed(first.decks),
      cards: trashed(first.cards),
    });
    expect(second.counts).toMatchObject({ pages: 3, decks: 5, links: 5 });
  });

  it('puts links loose in an untitled root into a "Bookmarks" page', () => {
    const result = planBookmarkImport(
      folder('', [link('a', 'https://a.example/')], true),
      EMPTY,
      { now: NOW, createId: idFactory() },
    );
    expect(result.pages.map(({ title }) => title)).toEqual(['Bookmarks']);
    expect(result.decks.map(({ title }) => title)).toEqual(['Bookmarks']);
  });

  it('skips over-long URLs as unsupported', () => {
    const longUrl = `https://long.example/${'x'.repeat(5000)}`;
    const result = planBookmarkImport(
      folder('', [folder('A', [link('long', longUrl)])], true),
      EMPTY,
      { now: NOW, createId: idFactory() },
    );
    expect(result.counts).toMatchObject({ links: 0, unsupported: 1 });
    expect(result.pages).toEqual([]);
  });
});

describe('normalizeUrl', () => {
  it('drops the fragment and lowercases the host', () => {
    expect(normalizeUrl('https://Example.com/a?b#c')).toBe(
      'https://example.com/a?b',
    );
  });

  it('returns unparseable input unchanged', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

describe('applyBookmarkPlan', () => {
  const DATABASE_NAME = 'deck-bookmark-import-test';
  afterEach(async () => {
    await deleteDB(DATABASE_NAME);
  });

  it('writes every record with an op and reports progress per chunk', async () => {
    const repository = new DeckRepository({
      databaseName: DATABASE_NAME,
      now: () => NOW,
      createId: idFactory(),
    });
    const links = Array.from({ length: 450 }, (_, index) =>
      link(`L${index}`, `https://many.example/${index}`),
    );
    const bulk = planBookmarkImport(
      folder('', [folder('Many', links)], true),
      EMPTY,
      { now: NOW, createId: idFactory() },
    );
    const onProgress = vi.fn();
    await applyBookmarkPlan(repository, bulk, onProgress);

    expect(await repository.listCards()).toHaveLength(450);
    expect(await repository.listDecks()).toHaveLength(1);
    expect(await repository.listOps()).toHaveLength(452);
    const total = 452;
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { done: 0, total },
      { done: 2, total },
      { done: 2 + IMPORT_CHUNK_SIZE, total },
      { done: 2 + IMPORT_CHUNK_SIZE * 2, total },
      { done: total, total },
    ]);
    await repository.close();
  });

  it('rejects an invalid batch without writing any of it', async () => {
    const repository = new DeckRepository({
      databaseName: DATABASE_NAME,
      createId: idFactory(),
    });
    const { cards } = plan();
    const broken = cards.map((card, index) =>
      index === cards.length - 1 ? { ...card, url: 'not a url' } : card,
    );
    await expect(repository.upsertMany({ cards: broken })).rejects.toThrow();
    expect(await repository.listCards()).toEqual([]);
    await repository.upsertMany({});
    expect(await repository.listOps()).toEqual([]);
    await repository.close();
  });

  it('reports a finished empty plan', async () => {
    const onProgress = vi.fn();
    const upsertMany = vi.fn();
    await applyBookmarkPlan(
      { upsertMany },
      { pages: [], decks: [], cards: [], counts: plan().counts },
      onProgress,
    );
    expect(upsertMany).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith({ done: 0, total: 0 });
  });
});
