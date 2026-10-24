import { INBOX_DECK_ID, UrlSchema, type Card } from 'deck-schema';
import { generateKeyBetween } from 'fractional-indexing';

import type { UndoAction } from '../drawer/UndoAction';
import { panelStrings as strings } from '../i18n/panelStrings';
import type { SurfaceData } from './bootstrap';
import { openCard } from '../drawer/inboxActions';

const MAX_PIN_COUNT = 12;

export async function openPin(
  repository: SurfaceData['repository'],
  card: Card,
  isNewTab: boolean,
): Promise<void> {
  await openCard(repository, card, isNewTab);
}

export async function createPin(
  repository: SurfaceData['repository'],
  input: string,
  label: string,
  pins: Card[],
): Promise<Card> {
  if (pins.length >= MAX_PIN_COUNT) throw new Error(strings.pinLimit);
  const parsed = UrlSchema.safeParse(input.trim());
  if (
    !parsed.success ||
    !['http:', 'https:'].includes(new URL(parsed.data).protocol)
  )
    throw new Error(strings.invalidUrl);
  const url = new URL(parsed.data);
  const hostname = url.hostname.replace(/^www\./i, '');
  const name = hostname.split('.')[0] ?? hostname;
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  const now = Date.now();
  return repository.upsertCard({
    id: crypto.randomUUID(),
    deckId: INBOX_DECK_ID,
    url: url.href,
    title,
    hostname: url.hostname,
    pinLabel: label.trim() || undefined,
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
        deckId: INBOX_DECK_ID,
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
