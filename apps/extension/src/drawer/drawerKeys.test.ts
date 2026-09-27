import { describe, expect, it } from 'vitest';

import { nextGridPosition } from './drawerKeys';

describe('nextGridPosition', () => {
  const counts = [3, 0, 2];

  it('starts on the first card, or the first deck when it is empty', () => {
    expect(nextGridPosition(counts, null, 'next')).toEqual({
      deck: 0,
      card: 0,
    });
    expect(nextGridPosition([0, 2], null, 'next')).toEqual({
      deck: 0,
      card: null,
    });
    expect(nextGridPosition([], null, 'next')).toBeNull();
  });

  it('j and k walk a deck and stop at its ends', () => {
    expect(nextGridPosition(counts, { deck: 0, card: 1 }, 'next')).toEqual({
      deck: 0,
      card: 2,
    });
    expect(nextGridPosition(counts, { deck: 0, card: 2 }, 'next')).toEqual({
      deck: 0,
      card: 2,
    });
    expect(nextGridPosition(counts, { deck: 0, card: 1 }, 'previous')).toEqual({
      deck: 0,
      card: 0,
    });
  });

  it('k from the first card lands on the deck itself; j comes back', () => {
    expect(nextGridPosition(counts, { deck: 0, card: 0 }, 'previous')).toEqual({
      deck: 0,
      card: null,
    });
    expect(nextGridPosition(counts, { deck: 0, card: null }, 'next')).toEqual({
      deck: 0,
      card: 0,
    });
  });

  it('h and l keep the row where they can and clamp at the edges', () => {
    expect(nextGridPosition(counts, { deck: 0, card: 2 }, 'nextDeck')).toEqual({
      deck: 1,
      card: null,
    });
    expect(
      nextGridPosition(counts, { deck: 1, card: null }, 'nextDeck'),
    ).toEqual({ deck: 2, card: 0 });
    expect(
      nextGridPosition(counts, { deck: 0, card: 2 }, 'previousDeck'),
    ).toEqual({ deck: 0, card: 2 });
    expect(nextGridPosition([3, 5], { deck: 0, card: 2 }, 'nextDeck')).toEqual({
      deck: 1,
      card: 2,
    });
    expect(nextGridPosition([5, 1], { deck: 0, card: 4 }, 'nextDeck')).toEqual({
      deck: 1,
      card: 0,
    });
  });

  it('recovers when the grid shrank under the focus', () => {
    expect(nextGridPosition([2], { deck: 3, card: 9 }, 'next')).toEqual({
      deck: 0,
      card: 1,
    });
  });
});
