import { describe, expect, it } from 'vitest';

import {
  greetingForHour,
  searchCards,
  shouldSpaceOpenDrawer,
} from './surfaceModel';

const cards = [
  {
    id: 'card_001',
    title: 'TypeScript Handbook',
    hostname: 'typescriptlang.org',
  },
  {
    id: 'card_002',
    title: 'Web APIs',
    hostname: 'developer.mozilla.org',
    note: 'Reference',
  },
];

describe('surface model', () => {
  it('selects the greeting for the local hour', () => {
    expect(greetingForHour(6)).toBe('Good morning');
    expect(greetingForHour(13)).toBe('Good afternoon');
    expect(greetingForHour(21)).toBe('Good evening');
  });

  it('finds cards by title, hostname, and note without mutating the source', () => {
    const before = structuredClone(cards);
    expect(searchCards(cards, 'type handbook')).toEqual([cards[0]]);
    expect(searchCards(cards, 'reference')).toEqual([cards[1]]);
    expect(cards).toEqual(before);
  });

  it('prefix-boosts the intended card on a 300-card fixture', () => {
    const fixture = Array.from({ length: 300 }, (_, index) => ({
      id: `card_${index}`,
      title: index < 10 ? `Target ${index} reference` : `Archive item ${index}`,
      hostname: 'example.com',
    }));
    for (let index = 0; index < 10; index += 1) {
      expect(searchCards(fixture, `target ${index}`)[0]?.id).toBe(
        `card_${index}`,
      );
    }
  });

  it('uses contiguous exact matching when a query starts with a quote', () => {
    expect(searchCards(cards, '"script hand')).toEqual([cards[0]]);
    expect(searchCards(cards, '"hand type')).toEqual([]);
  });

  it('opens the drawer only for Space on a truly empty enabled Line', () => {
    expect(shouldSpaceOpenDrawer(' ', '', true)).toBe(true);
    expect(shouldSpaceOpenDrawer(' ', 'query', true)).toBe(false);
    expect(shouldSpaceOpenDrawer(' ', ' ', true)).toBe(false);
    expect(shouldSpaceOpenDrawer(' ', '', false)).toBe(false);
    expect(shouldSpaceOpenDrawer('Enter', '', true)).toBe(false);
  });
});
