import type { Card, Deck, Page } from 'deck-schema';
import { generateKeyBetween } from 'fractional-indexing';

import { strings } from '../i18n/strings';
import type { SurfaceData } from '../newtab/bootstrap';
import { compareOrder, replaceEntity } from './workspaceModel';
import { parseDragId } from './dragIdentity';
import { fractionalOrderForMove } from './fractionalOrder';
import { moveCard, moveDeck } from './workspaceDndModel';
import type { WorkspaceDropDetail } from './WorkspaceDnd';

const MAX_PIN_COUNT = 12;

export interface WorkspaceDropState {
  cards: Card[];
  decks: Deck[];
  pages: Page[];
  repository: SurfaceData['repository'];
  onCardsChange: (cards: Card[]) => void;
  onDecksChange: (decks: Deck[]) => void;
  onPagesChange: (pages: Page[]) => void;
  onError: (message: string) => void;
}

export async function handleWorkspaceDrop(
  detail: WorkspaceDropDetail,
  state: WorkspaceDropState,
): Promise<void> {
  const active = parseDragId(detail.activeId);
  const over = parseDragId(detail.overId);
  if (!active || !over) return;
  try {
    if (active.entity === 'page' && over.entity === 'page')
      await persistPageMove(active.id, over.id, state);
    else if (active.entity === 'deck')
      await persistDeckMove(active.id, over, state);
    else if (active.entity === 'card')
      await persistCardMove(active.id, over, state);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    state.onError(`${strings.updateFailed} ${detail}`);
  }
}

async function persistPageMove(
  activeId: string,
  overId: string,
  state: WorkspaceDropState,
) {
  const ordered = activeRecords(state.pages);
  const moved = ordered.find(({ id }) => id === activeId);
  if (!moved) return;
  const saved = await state.repository.upsertPage({
    ...moved,
    order: fractionalOrderForMove(ordered, activeId, overId),
    updatedAt: Date.now(),
  });
  state.onPagesChange(replaceEntity(state.pages, saved));
}

async function persistDeckMove(
  activeId: string,
  over: NonNullable<ReturnType<typeof parseDragId>>,
  state: WorkspaceDropState,
) {
  const targetPageId =
    over.entity === 'page'
      ? over.id
      : state.decks.find(({ id }) => id === over.id)?.pageId;
  if (!targetPageId || (over.entity !== 'page' && over.entity !== 'deck'))
    return;
  const moved = moveDeck(
    state.decks,
    activeId,
    targetPageId,
    over.entity === 'deck' ? over.id : undefined,
  );
  if (!moved) return;
  const saved = await state.repository.upsertDeck({
    ...moved,
    updatedAt: Date.now(),
  });
  state.onDecksChange(replaceEntity(state.decks, saved));
}

async function persistCardMove(
  activeId: string,
  over: NonNullable<ReturnType<typeof parseDragId>>,
  state: WorkspaceDropState,
) {
  if (over.entity === 'pin') return persistCardPin(activeId, state);
  const targetDeckId =
    over.entity === 'deck'
      ? over.id
      : state.cards.find(({ id }) => id === over.id)?.deckId;
  if (!targetDeckId || (over.entity !== 'card' && over.entity !== 'deck'))
    return;
  const moved = moveCard(
    state.cards,
    activeId,
    targetDeckId,
    over.entity === 'card' ? over.id : undefined,
  );
  if (!moved) return;
  const saved = await state.repository.upsertCard({
    ...moved,
    updatedAt: Date.now(),
  });
  state.onCardsChange(replaceEntity(state.cards, saved));
}

async function persistCardPin(activeId: string, state: WorkspaceDropState) {
  const moved = state.cards.find(({ id }) => id === activeId);
  if (!moved || moved.pinned) return;
  const pins = activeRecords(state.cards).filter(({ pinned }) => pinned);
  if (pins.length >= MAX_PIN_COUNT) throw new Error(strings.pinLimitReached);
  const saved = await state.repository.upsertCard({
    ...moved,
    pinned: true,
    order: generateKeyBetween(pins.at(-1)?.order ?? null, null),
    updatedAt: Date.now(),
  });
  state.onCardsChange(replaceEntity(state.cards, saved));
}

function activeRecords<T extends { deletedAt: number | null; order: string }>(
  records: T[],
) {
  return records
    .filter(({ deletedAt }) => deletedAt === null)
    .toSorted((left, right) => compareOrder(left.order, right.order));
}
