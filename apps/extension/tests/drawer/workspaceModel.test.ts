import type { Card, Deck } from 'deck-schema';
import { describe, expect, it } from 'vitest';

import {
  activeCards,
  activeDecks,
  parseCardUrl,
  replaceEntity,
} from '../../src/drawer/workspaceModel';

const decks: Deck[] = [
  {
    id: 'deck_b',
    pageId: 'page_a',
    title: 'B',
    kind: 'normal',
    order: 'b0',
    color: null,
    isCollapsed: false,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  },
  {
    id: 'deck_a',
    pageId: 'page_a',
    title: 'A',
    kind: 'normal',
    order: 'a0',
    color: null,
    isCollapsed: false,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  },
  {
    id: 'deck_c',
    pageId: 'page_b',
    title: 'C',
    kind: 'normal',
    order: 'c0',
    color: null,
    isCollapsed: false,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  },
];

const card = (id: string, order: string, done = false): Card => ({
  id,
  deckId: 'deck_a',
  url: `https://${id}.test/`,
  title: id,
  hostname: `${id}.test`,
  order,
  pinned: false,
  done,
  lastOpenedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

describe('drawer workspace model', () => {
  it.each([
    ['manual', ['alpha', 'zebra', 'beta', 'done']],
    ['title', ['alpha', 'beta', 'zebra', 'done']],
    ['newest', ['beta', 'zebra', 'alpha', 'done']],
    ['hostname', ['beta', 'zebra', 'alpha', 'done']],
  ] as const)(
    'sorts %s without changing manual order or completed-task grouping',
    (mode, expected) => {
      const cards = [
        {
          ...card('zebra', 'a1'),
          title: 'Zebra',
          hostname: 'b.test',
          createdAt: 2,
        },
        {
          ...card('beta', 'a2'),
          title: 'Beta',
          hostname: 'a.test',
          createdAt: 3,
        },
        { ...card('alpha', 'a0'), title: 'Alpha', hostname: 'c.test' },
        { ...card('done', 'Zz', true), title: 'AAA', createdAt: 9 },
        { ...card('pinned', 'a3'), pinned: true },
        { ...card('trash', 'a4'), deletedAt: 1 },
        { ...card('other', 'a5'), deckId: 'deck_b' },
      ];
      const before = structuredClone(cards);
      expect(activeCards(cards, 'deck_a', mode).map(({ id }) => id)).toEqual(
        expected,
      );
      expect(cards).toEqual(before);
    },
  );

  it('breaks sort ties by manual order then id, independently of input order', () => {
    const cards = [
      card('second', 'a1'),
      card('first', 'a0'),
      card('third', 'a1'),
    ].map((value) => ({ ...value, title: 'Same', hostname: 'same.test' }));
    for (const mode of ['manual', 'title', 'newest', 'hostname'] as const) {
      expect(
        activeCards(cards.toReversed(), 'deck_a', mode).map(({ id }) => id),
      ).toEqual(['first', 'second', 'third']);
    }
  });

  it('sorts URL-free tasks after named hosts without dropping them', () => {
    const cards = [
      {
        ...card('task', 'a0'),
        kind: 'task' as const,
        url: undefined,
        hostname: '',
      },
      card('link', 'a1'),
    ];
    expect(
      activeCards(cards, 'deck_a', 'hostname').map(({ id }) => id),
    ).toEqual(['link', 'task']);
  });

  it('orders active decks without mutating the source', () => {
    const before = structuredClone(decks);
    expect(activeDecks(decks, 'page_a').map(({ id }) => id)).toEqual([
      'deck_a',
      'deck_b',
    ]);
    expect(decks).toEqual(before);
  });

  it('sinks done cards while retaining fractional order', () => {
    const cards = [
      card('done', 'a0', true),
      card('later', 'c0'),
      card('first', 'b0'),
    ];
    expect(activeCards(cards, 'deck_a').map(({ id }) => id)).toEqual([
      'first',
      'later',
      'done',
    ]);
  });

  it('normalizes pasted web addresses without a network request', () => {
    expect(parseCardUrl('example.com/docs')).toEqual({
      hostname: 'example.com',
      title: 'example.com',
      url: 'https://example.com/docs',
    });
    expect(parseCardUrl('file:///secret')).toBeNull();
    expect(parseCardUrl('')).toBeNull();
  });

  it('replaces records immutably', () => {
    const original = decks.find(({ id }) => id === 'deck_b');
    if (!original) throw new Error('Fixture deck is missing');
    const saved = { ...original, title: 'Changed' };
    const next = replaceEntity(decks, saved);
    expect(next).not.toBe(decks);
    expect(next[0]).toBe(saved);
    expect(decks[0]?.title).toBe('B');
  });
});
