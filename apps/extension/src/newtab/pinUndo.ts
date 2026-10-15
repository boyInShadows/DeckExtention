import { UrlSchema, type Card } from 'deck-schema';
import { generateKeyBetween } from 'fractional-indexing';

import type { UndoAction } from '../drawer/UndoToast';
import { strings } from '../i18n/strings';
import type { SurfaceData } from './bootstrap';

export async function createPin(
  repository: SurfaceData['repository'],
  input: string,
  defaultDeckId: string,
  pins: Card[],
): Promise<Card> {
  const parsed = UrlSchema.safeParse(input.trim());
  if (
    !parsed.success ||
    !['http:', 'https:'].includes(new URL(parsed.data).protocol)
  )
    throw new Error(strings.invalidUrl);
  const url = new URL(parsed.data);
  const now = Date.now();
  return repository.upsertCard({
    id: crypto.randomUUID(),
    deckId: defaultDeckId,
    url: url.href,
    title: url.hostname,
    hostname: url.hostname,
    order: generateKeyBetween(pins.at(-1)?.order ?? null, null),
    pinned: true,
    lastOpenedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
}

function unpinUndo(
  repository: SurfaceData['repository'],
  previous: Card,
  onCardsChange: (cards: Card[]) => void,
): UndoAction {
  return {
    label: strings.unpin,
    undo: async () => {
      const current = (await repository.listCards()).find(
        ({ id }) => id === previous.id,
      );
      if (!current) throw new Error(strings.updateFailed);
      await repository.upsertCard({
        ...current,
        pinned: true,
        order: previous.order,
        updatedAt: Date.now(),
      });
      onCardsChange(await repository.listCards());
    },
  };
}

export async function updatePin(
  repository: SurfaceData['repository'],
  previous: Card,
  change: Partial<Card>,
  cards: Card[],
  onCardsChange: (cards: Card[]) => void,
  offerUndo?: (action: UndoAction) => void,
): Promise<void> {
  const saved = await repository.upsertCard({
    ...previous,
    ...change,
    updatedAt: Date.now(),
  });
  onCardsChange(cards.map((card) => (card.id === saved.id ? saved : card)));
  if (change.pinned === false)
    offerUndo?.(unpinUndo(repository, previous, onCardsChange));
}
