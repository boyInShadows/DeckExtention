import { generateKeyBetween } from 'fractional-indexing';
import { activePages, DRAWER_PAGE_KEY } from '../drawer/drawerModel';
import { activeDecks } from '../drawer/workspaceModel';
import { panelStrings as strings } from '../i18n/panelStrings';
import type { DeckRepository } from '../storage/repository';

export interface CreatedWorkspace {
  pageId: string;
  deckId?: string;
}

export async function createFromLine(
  repository: DeckRepository,
  kind: 'new-page' | 'new-deck',
  query: string,
): Promise<CreatedWorkspace> {
  const title = /^>new (?:page|deck)(?:\s+(.*))?$/i
    .exec(query.trim())?.[1]
    ?.trim();
  const pages = activePages(await repository.listPages());
  const time = Date.now();
  const base = {
    id: crypto.randomUUID(),
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
  };
  if (kind === 'new-page') {
    const page = await repository.upsertPage({
      ...base,
      title: title || strings.untitledPage(pages.length + 1),
      order: generateKeyBetween(pages.at(-1)?.order ?? null, null),
    });
    return { pageId: page.id };
  }
  const page =
    pages.find(({ id }) => id === localStorage.getItem(DRAWER_PAGE_KEY)) ??
    pages[0];
  if (!page) throw new Error(strings.selectPage);
  const decks = activeDecks(await repository.listDecks(), page.id, 'normal');
  const deck = await repository.upsertDeck({
    ...base,
    pageId: page.id,
    title: title || strings.newDeck,
    kind: 'normal',
    order: generateKeyBetween(decks.at(-1)?.order ?? null, null),
    color: null,
    isCollapsed: false,
  });
  return { pageId: page.id, deckId: deck.id };
}
