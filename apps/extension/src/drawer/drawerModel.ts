import type { Page } from 'deck-schema';

import { compareOrder } from './workspaceModel';

export const DRAWER_PAGE_KEY = 'deck:last-page';
export const DRAWER_SCROLL_KEY = 'deck:drawer-scroll';
export const INBOX_PAGE_ID = 'inbox';

export function activePages(pages: Page[]): Page[] {
  return pages
    .filter((page) => page.deletedAt === null)
    .toSorted((left, right) => compareOrder(left.order, right.order));
}

export function selectedPageId(
  pages: Page[],
  storedId: string | null,
): string | null {
  const ordered = activePages(pages);
  if (storedId === INBOX_PAGE_ID) return INBOX_PAGE_ID;
  if (storedId && ordered.some(({ id }) => id === storedId)) return storedId;
  return ordered[0]?.id ?? null;
}

export function restoredScroll(value: string | null): number {
  if (value === null || value.trim() === '') return 0;
  const scroll = Number(value);
  return Number.isFinite(scroll) && scroll >= 0 ? scroll : 0;
}
