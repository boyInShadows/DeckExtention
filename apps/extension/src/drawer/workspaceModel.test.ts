import type { Card, Deck } from 'deck-schema';
import { describe, expect, it } from 'vitest';

import {
  activeCards,
  activeDecks,
  parseCardUrl,
  replaceEntity,
} from './workspaceModel';

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
