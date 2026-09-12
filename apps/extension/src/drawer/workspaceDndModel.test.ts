import type { Card, Deck } from 'deck-schema';
import { describe, expect, it } from 'vitest';

import { moveCard, moveDeck } from './workspaceDndModel';
import { dragId, parseDragId } from './dragIdentity';
import { fractionalOrderForMove } from './fractionalOrder';

const deck = (id: string, pageId: string, order: string): Deck => ({
  id,
  pageId,
  title: id,
  kind: 'normal',
  order,
  color: null,
  isCollapsed: false,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

const card = (id: string, deckId: string, order: string): Card => ({
  id,
  deckId,
  url: `https://${id}.test/`,
  title: id,
  hostname: `${id}.test`,
  order,
  pinned: false,
  lastOpenedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

describe('workspace drag model', () => {
  it('uses typed ids so cards and pins can share record ids', () => {
    expect(parseDragId(dragId('card', 'card_a'))).toEqual({
      entity: 'card',
      id: 'card_a',
    });
    expect(parseDragId('unknown:item')).toBeNull();
  });

  it('moves one deck between pages with a fractional key', () => {
    const decks = [
      deck('deck_a', 'page_a', 'a0'),
      deck('deck_b', 'page_b', 'a0'),
    ];
    const moved = moveDeck(decks, 'deck_a', 'page_b', 'deck_b');
    if (!moved) throw new Error('Expected the deck to move');
    expect(moved.pageId).toBe('page_b');
    expect(moved.order < 'a0').toBe(true);
    expect(decks[0]?.pageId).toBe('page_a');
  });

  it('moves one card across decks without renumbering siblings', () => {
    const cards = [
      card('card_a', 'deck_a', 'a0'),
      card('card_b', 'deck_b', 'a0'),
      card('card_c', 'deck_b', 'a1'),
    ];
    const moved = moveCard(cards, 'card_a', 'deck_b', 'card_c');
    if (!moved) throw new Error('Expected the card to move');
    expect(moved.deckId).toBe('deck_b');
    expect(moved.order > 'a0').toBe(true);
    expect(moved.order < 'a1').toBe(true);
    expect(cards.map(({ order }) => order)).toEqual(['a0', 'a0', 'a1']);
  });

  it('places a forward move after the card it crosses', () => {
    const cards = [
      card('card_a', 'deck_a', 'a0'),
      card('card_b', 'deck_a', 'a1'),
      card('card_c', 'deck_a', 'a2'),
    ];
    const order = fractionalOrderForMove(cards, 'card_a', 'card_c');
    expect(order > 'a2').toBe(true);
    expect(cards.map((item) => item.order)).toEqual(['a0', 'a1', 'a2']);
  });
});
