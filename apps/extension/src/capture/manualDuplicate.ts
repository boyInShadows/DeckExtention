import { UrlSchema, type Card } from 'deck-schema';
import { panelStrings as strings } from '../i18n/panelStrings';
import type { DeckRepository } from '../storage/repository';
import { captureTarget, describeDuplicate } from './quickSave';

export interface SavedLink {
  card: Card;
  location: string;
}

// shortcut: cross-tab checks are advisory; use an atomic write guard if global URL uniqueness is required.
export async function findSavedLink(
  repository: DeckRepository,
  input: string,
): Promise<SavedLink | null> {
  const parsed = UrlSchema.safeParse(input.trim());
  const target = parsed.success ? captureTarget(parsed.data, undefined) : null;
  if (!target) throw new Error(strings.invalidUrl);
  const [pages, decks, cards] = await Promise.all([
    repository.listPages(),
    repository.listDecks(),
    repository.listCards(),
  ]);
  const activeDecks = decks.filter(
    (deck) =>
      deck.deletedAt === null &&
      (deck.kind !== 'normal' ||
        pages.some(
          (page) => page.id === deck.pageId && page.deletedAt === null,
        )),
  );
  const card = cards.find(
    (card) =>
      card.deletedAt === null &&
      captureTarget(card.url, undefined)?.url === target.url &&
      (card.pinned || activeDecks.some((deck) => deck.id === card.deckId)),
  );
  if (!card) return null;
  return {
    card,
    location: card.pinned
      ? strings.pinsLabel
      : (describeDuplicate(card, activeDecks, pages).location ?? strings.inbox),
  };
}
