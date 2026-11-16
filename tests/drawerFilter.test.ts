import { describe, expect, it } from 'vitest';
import { filterCards } from '../apps/extension/src/drawer/drawerFilter';

describe('drawer card filter', () => {
  const cards = [
    {
      title: 'Alpha',
      url: 'https://one.example/path',
      hostname: 'one.example',
      note: 'Read later',
    },
    { title: 'Beta', url: '', hostname: '' },
  ];

  it('matches literal case-insensitive text in title, URL, host and notes', () => {
    for (const query of [' ALPHA ', '/path', 'ONE.EXAMPLE', 'read later'])
      expect(filterCards(cards, query)).toEqual([cards[0]]);
    expect(filterCards(cards, 'beta')).toEqual([cards[1]]);
    expect(filterCards(cards, '.*')).toEqual([]);
  });

  it('keeps order and records unchanged, and restores everything for blank text', () => {
    const before = structuredClone(cards);
    expect(filterCards(cards, '  ')).toEqual(cards);
    expect(filterCards(cards, 'a')).toEqual(cards);
    expect(cards).toEqual(before);
  });
});
