import type { Card } from 'deck-schema';
import { generateKeyBetween } from 'fractional-indexing';
import type { DeckRepository } from '../storage/repository';
import { panelStrings as strings } from '../i18n/panelStrings';
import { createPin } from '../newtab/pinUndo';
import { compareOrder } from '../drawer/workspaceModel';
import { captureTarget, saveToInbox, type CaptureTarget } from './quickSave';
import { findSavedLink, type SavedLink } from './manualDuplicate';
import type { DropDestination } from './dropTarget';

type DropResult =
  { kind: 'saved'; card: Card } | { kind: 'duplicate'; duplicate: SavedLink };

export async function saveDroppedLink(
  repository: DeckRepository,
  input: string,
  destination: DropDestination,
): Promise<DropResult> {
  const duplicate = await findSavedLink(repository, input);
  if (duplicate) return { kind: 'duplicate', duplicate };
  const target = captureTarget(input.trim(), undefined);
  if (!target) throw new Error(strings.invalidUrl);
  if (destination.kind === 'inbox') {
    const result = await saveToInbox(repository, target);
    return result.kind === 'saved'
      ? result
      : {
          kind: 'duplicate',
          duplicate: {
            card: result.card,
            location: result.card.pinned
              ? strings.pinsLabel
              : (result.location ?? strings.inbox),
          },
        };
  }
  if (destination.kind === 'pin') {
    const pins = (await repository.listCards())
      .filter((card) => card.pinned && card.deletedAt === null)
      .toSorted((a, b) => compareOrder(a.order, b.order));
    return {
      kind: 'saved',
      card: await createPin(repository, target.url, '', pins),
    };
  }
  return {
    kind: 'saved',
    card: await saveToDeck(repository, target, destination.deckId),
  };
}

async function saveToDeck(
  repository: DeckRepository,
  target: CaptureTarget,
  deckId: string,
): Promise<Card> {
  const [pages, decks, cards] = await Promise.all([
    repository.listPages(),
    repository.listDecks(),
    repository.listCards(),
  ]);
  const deck = decks.find(
    (deck) => deck.id === deckId && deck.deletedAt === null,
  );
  if (
    !deck ||
    (deck.kind === 'normal' &&
      !pages.some((page) => page.id === deck.pageId && page.deletedAt === null))
  )
    throw new Error(strings.dropDeckUnavailable);
  const tail =
    cards
      .filter(
        (card) =>
          card.deckId === deckId && !card.pinned && card.deletedAt === null,
      )
      .map((card) => card.order)
      .toSorted(compareOrder)
      .at(-1) ?? null;
  const time = Date.now();
  return repository.upsertCard({
    id: crypto.randomUUID(),
    deckId,
    ...target,
    order: generateKeyBetween(tail, null),
    pinned: false,
    lastOpenedAt: null,
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
  });
}
