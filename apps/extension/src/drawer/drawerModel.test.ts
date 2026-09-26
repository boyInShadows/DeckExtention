import type { Page } from 'deck-schema';
import { describe, expect, it } from 'vitest';

import {
  activePages,
  INBOX_PAGE_ID,
  restoredScroll,
  selectedPageId,
} from './drawerModel';

const pages: Page[] = [
  {
    id: 'page_002',
    title: 'Second',
    order: 'b0',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  },
  {
    id: 'page_001',
    title: 'First',
    order: 'a0',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  },
  {
    id: 'page_003',
    title: 'Deleted',
    order: 'c0',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: 2,
  },
];

describe('drawer page model', () => {
  it('returns immutable active ordering', () => {
    const before = structuredClone(pages);
    expect(activePages(pages).map(({ id }) => id)).toEqual([
      'page_001',
      'page_002',
    ]);
    expect(pages).toEqual(before);
  });

  it('restores a valid page and falls back when it disappeared', () => {
    expect(selectedPageId(pages, 'page_002')).toBe('page_002');
    expect(selectedPageId(pages, INBOX_PAGE_ID)).toBe(INBOX_PAGE_ID);
    expect(selectedPageId(pages, 'missing')).toBe('page_001');
  });

  it('restores only finite non-negative scroll positions', () => {
    expect(restoredScroll('42.5')).toBe(42.5);
    expect(restoredScroll(null)).toBe(0);
    expect(restoredScroll('NaN')).toBe(0);
    expect(restoredScroll('-1')).toBe(0);
  });
});
