import type { Deck, Page } from 'deck-schema';
import { activePages } from '../drawer/drawerModel';
import { activeDecks } from '../drawer/workspaceModel';

export function shelfDecks(pages: Page[], decks: Deck[]): Deck[] {
  return activePages(pages).flatMap((page) =>
    activeDecks(decks, page.id).filter((deck) => deck.kind !== 'inbox'),
  );
}
