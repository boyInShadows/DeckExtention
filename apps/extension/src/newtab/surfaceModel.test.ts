import { describe, expect, it } from 'vitest';

import { greetingForHour, shouldSpaceOpenDrawer } from './surfaceModel';
import { buildSearchIndex, parseLineUrl, searchCards } from './lineSearch';

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

  it('builds a 500-card fuzzy index within the startup budget', () => {
    const fixture = Array.from({ length: 500 }, (_, index) => ({
      id: `card_${index}`,
      title: `Reference ${index} documentation`,
      hostname: `site${index}.example`,
    }));
    const started = performance.now();
    const search = buildSearchIndex(fixture);
    expect(performance.now() - started).toBeLessThan(5);
    expect(search('referense 42').cards[0]?.id).toBe('card_42');
  });

  it('uses contiguous exact matching when a query starts with a quote', () => {
    expect(searchCards(cards, '"script hand')).toEqual([cards[0]]);
    expect(searchCards(cards, '"hand type')).toEqual([]);
  });

  it('parses only intentional web URLs', () => {
    expect(parseLineUrl('foo.com')).toBe('https://foo.com/');
    expect(parseLineUrl('http://localhost:5173/src/newtab/index.html')).toBe(
      'http://localhost:5173/src/newtab/index.html',
    );
    expect(parseLineUrl('weather tomorrow')).toBeNull();
    expect(parseLineUrl('javascript:alert(1)')).toBeNull();
    expect(
      parseLineUrl(`https://example.com/${'a'.repeat(10_000)}`),
    ).toBeNull();
  });

  it('opens the drawer only for Space on a truly empty enabled Line', () => {
    expect(shouldSpaceOpenDrawer(' ', '', true)).toBe(true);
    expect(shouldSpaceOpenDrawer(' ', 'query', true)).toBe(false);
    expect(shouldSpaceOpenDrawer(' ', ' ', true)).toBe(false);
    expect(shouldSpaceOpenDrawer(' ', '', false)).toBe(false);
    expect(shouldSpaceOpenDrawer('Enter', '', true)).toBe(false);
  });
});
