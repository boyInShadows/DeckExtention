import { describe, expect, it } from 'vitest';

import { greetingForHour, searchCards } from './surfaceModel';

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
});
