import type { Deck, Page } from 'deck-schema';
import { describe, expect, it } from 'vitest';

import {
  clampIndex,
  fuzzyScore,
  moveTargets,
  parseRecentTargets,
  rangeSelection,
  rankMoveTargets,
  rememberTarget,
  selectionOf,
  type MoveTarget,
} from './inboxModel';

const page = (id: string, title: string, order: string): Page => ({
  id,
  title,
  order,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

const deck = (
  id: string,
  pageId: string,
  title: string,
  order: string,
  overrides: Partial<Deck> = {},
): Deck => ({
  id,
  pageId,
  title,
  kind: 'normal',
  order,
  color: null,
  isCollapsed: false,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  ...overrides,
});

const targets: MoveTarget[] = [
  { deckId: 'deck_docs', label: 'Work › Docs' },
  { deckId: 'deck_tools', label: 'Work › Tools' },
  { deckId: 'deck_music', label: 'Personal › Music' },
  { deckId: 'deck_reads', label: 'Personal › Reading' },
];

describe('moveTargets', () => {
  it('lists live normal decks on live pages in rail then grid order', () => {
    const pages = [
      page('page_b', 'Personal', 'b0'),
      page('page_a', 'Work', 'a0'),
      { ...page('page_x', 'Gone', 'c0'), deletedAt: 5 },
    ];
    const decks = [
      deck('deck_2', 'page_a', 'Tools', 'b0'),
      deck('deck_1', 'page_a', 'Docs', 'a0'),
      deck('deck_3', 'page_b', 'Music', 'a0'),
      deck('deck_in', 'page_a', 'Inbox', 'z0', { kind: 'inbox' }),
      deck('deck_old', 'page_a', 'Old', 'c0', { deletedAt: 5 }),
      deck('deck_lost', 'page_x', 'Lost', 'a0'),
    ];
    expect(moveTargets(decks, pages)).toEqual([
      { deckId: 'deck_1', label: 'Work › Docs' },
      { deckId: 'deck_2', label: 'Work › Tools' },
      { deckId: 'deck_3', label: 'Personal › Music' },
    ]);
  });
});

describe('fuzzyScore', () => {
  it('prefers contiguous, then word-start, then scattered matches', () => {
    const wordStart = fuzzyScore('doc', 'Work › Docs') ?? -Infinity;
    const inside = fuzzyScore('ork', 'Work › Docs') ?? -Infinity;
    const scattered = fuzzyScore('wdc', 'Work › Docs') ?? -Infinity;
    expect(scattered).toBeGreaterThan(-Infinity);
    expect(wordStart).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(scattered);
  });

  it('rejects letters that are not there in order', () => {
    expect(fuzzyScore('cdw', 'Work › Docs')).toBeNull();
    expect(fuzzyScore('zz', 'Work › Docs')).toBeNull();
  });

  it('ignores case and surrounding space, and matches anything when empty', () => {
    expect(fuzzyScore('  DOCS ', 'Work › Docs')).not.toBeNull();
    expect(fuzzyScore('', 'anything')).toBe(0);
  });
});

describe('rankMoveTargets', () => {
  it('puts the last three destinations first on an empty query', () => {
    const ranked = rankMoveTargets(targets, '', ['deck_music', 'deck_tools']);
    expect(ranked.map(({ deckId }) => deckId)).toEqual([
      'deck_music',
      'deck_tools',
      'deck_docs',
      'deck_reads',
    ]);
  });

  it('ranks by match quality once the user types', () => {
    const ranked = rankMoveTargets(targets, 'rea', []);
    expect(ranked.map(({ deckId }) => deckId)).toEqual(['deck_reads']);
    expect(rankMoveTargets(targets, 'per', [])).toHaveLength(2);
  });

  it('lets recency break a tie', () => {
    const ranked = rankMoveTargets(targets, 'personal', ['deck_reads']);
    expect(ranked[0]?.deckId).toBe('deck_reads');
  });

  it('returns nothing when no deck matches', () => {
    expect(rankMoveTargets(targets, 'qqq', [])).toEqual([]);
  });

  it('never shows more than eight', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      deckId: `deck_${index}`,
      label: `Page › Deck ${index}`,
    }));
    expect(rankMoveTargets(many, '', [])).toHaveLength(8);
    expect(rankMoveTargets(many, 'deck', [])).toHaveLength(8);
  });
});

describe('recent targets', () => {
  it('keeps the three most recent, newest first, without repeats', () => {
    expect(rememberTarget([], 'a')).toEqual(['a']);
    expect(rememberTarget(['a', 'b', 'c'], 'd')).toEqual(['d', 'a', 'b']);
    expect(rememberTarget(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('reads storage defensively', () => {
    expect(parseRecentTargets(null)).toEqual([]);
    expect(parseRecentTargets('not json')).toEqual([]);
    expect(parseRecentTargets('{"a":1}')).toEqual([]);
    expect(parseRecentTargets('["a",2,"b","c","d"]')).toEqual(['a', 'b', 'c']);
  });
});

describe('selection helpers', () => {
  it('selects the inclusive range in either direction', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(rangeSelection(ids, 1, 3)).toEqual(['b', 'c', 'd']);
    expect(rangeSelection(ids, 2, 0)).toEqual(['a', 'b', 'c']);
    expect(rangeSelection(ids, 2, 2)).toEqual(['c']);
  });

  it('clamps the cursor into the list', () => {
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(4, 0)).toBe(0);
  });
});

describe('selectionOf', () => {
  it('is the cursor card alone until a range is anchored', () => {
    const ids = ['a', 'b', 'c'];
    expect(selectionOf(ids, 1, null)).toEqual(['b']);
    expect(selectionOf(ids, 2, 0)).toEqual(['a', 'b', 'c']);
    expect(selectionOf(ids, 9, null)).toEqual(['c']);
    expect(selectionOf([], 0, null)).toEqual([]);
  });
});
