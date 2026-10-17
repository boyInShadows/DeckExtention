import type { Card, Deck } from 'deck-schema';
import { captureTarget } from '../capture/quickSave';
import { panelStrings as strings } from '../i18n/panelStrings';
import { markCardsOpened } from '../storage/cardOpened';
import type { DeckRepository } from '../storage/repository';

export type DeckOpenMode = 'tabs' | 'group' | 'restore' | 'restore-and-trash';
const GROUP_COLORS: Record<string, chrome.tabGroups.TabGroup['color']> = {
  slate: 'grey',
  blue: 'blue',
  green: 'green',
  amber: 'yellow',
  rose: 'red',
};

async function savedLinks(
  repository: DeckRepository,
  deckId: string,
  mode: DeckOpenMode,
) {
  const deck = (await repository.listDecks()).find(
    (deck) => deck.id === deckId && deck.deletedAt === null,
  );
  if (!deck || (mode.startsWith('restore') && deck.kind !== 'session'))
    throw new Error(strings.sessionMissing);
  const cards = (await repository.listCards())
    .filter(
      (card) =>
        card.deckId === deckId &&
        card.deletedAt === null &&
        (!card.pinned || deck.kind === 'session'),
    )
    .toSorted((a, b) => (a.order < b.order ? -1 : a.order === b.order ? 0 : 1));
  if (!cards.length) throw new Error(strings.noSavedLinks);
  if (cards.some((card) => !captureTarget(card.url, card.title)))
    throw new Error(strings.invalidUrl);
  return { deck, cards };
}

async function createTabs(
  repository: DeckRepository,
  cards: Card[],
  windowId: number,
) {
  const opened: { tabId: number; cardId: string }[] = [];
  let failure: unknown;
  try {
    for (const card of cards) {
      const tab = await chrome.tabs.create({
        windowId,
        url: card.url,
        active: false,
      });
      if (tab.id === undefined) throw new Error(strings.openTabFailed);
      opened.push({ tabId: tab.id, cardId: card.id });
    }
  } catch (error) {
    failure = error;
  }
  try {
    await repository.markCardsOpened(
      opened.map((item) => item.cardId),
      markCardsOpened,
    );
  } catch (error) {
    throw new Error(
      `${strings.openedTabs(opened.length, cards.length)} ${String(failure ?? '')} ${String(error)}`,
      { cause: error },
    );
  }
  if (failure)
    throw new Error(
      `${strings.openedTabs(opened.length, cards.length)} ${String(failure)}`,
      { cause: failure },
    );
  return opened.map((item) => item.tabId);
}

async function groupTabs(deck: Deck, tabIds: number[]) {
  const [first, ...rest] = tabIds;
  if (first === undefined) throw new Error(strings.noSavedLinks);
  const groupId = await chrome.tabs.group({ tabIds: [first, ...rest] });
  await chrome.tabGroups.update(groupId, {
    title: deck.title,
    color: GROUP_COLORS[deck.color ?? 'slate'] ?? 'grey',
  });
}

export async function openDeck(
  repository: DeckRepository,
  deckId: string,
  windowId: number,
  mode: DeckOpenMode = 'tabs',
): Promise<number> {
  const { deck, cards } = await savedLinks(repository, deckId, mode);
  const tabIds = await createTabs(repository, cards, windowId);
  const first = tabIds[0];
  if (first === undefined) throw new Error(strings.openTabFailed);
  try {
    if (mode === 'group') await groupTabs(deck, tabIds);
    await chrome.tabs.update(first, { active: true });
    if (mode === 'restore-and-trash') await repository.trashDeck(deckId);
  } catch (error) {
    throw new Error(
      `${strings.openedTabs(cards.length, cards.length)} ${String(error)}`,
      { cause: error },
    );
  }
  return cards.length;
}
