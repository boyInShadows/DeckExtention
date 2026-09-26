import type { Card, Deck, Page } from 'deck-schema';
import { describe, expect, it, vi } from 'vitest';

import { dragId } from './dragIdentity';
import { handleWorkspaceDrop, type WorkspaceDropState } from './workspaceDrop';

const page = (id: string, order: string): Page => ({
  id,
  title: id,
  order,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

const deck = (id: string, pageId: string, order: string): Deck => ({
  id,
  pageId,
  title: id,
  kind: 'normal',
  order,
  color: null,
  isCollapsed: false,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

const card = (id: string, deckId: string, order: string): Card => ({
  id,
  deckId,
  url: `https://${id}.test/`,
  title: id,
  hostname: `${id}.test`,
  order,
  pinned: false,
  lastOpenedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

function state(overrides: Partial<WorkspaceDropState> = {}) {
  const repository = {
    upsertPage: vi.fn(async (value: Page) => value),
    upsertDeck: vi.fn(async (value: Deck) => value),
    upsertCard: vi.fn(async (value: Card) => value),
  };
  return {
    repository,
    value: {
      pages: [page('page_a', 'a0'), page('page_b', 'a1')],
      decks: [deck('deck_a', 'page_a', 'a0'), deck('deck_b', 'page_b', 'a0')],
      cards: [card('card_a', 'deck_a', 'a0'), card('card_b', 'deck_b', 'a0')],
      repository: repository as unknown as WorkspaceDropState['repository'],
      onCardsChange: vi.fn(),
      onDecksChange: vi.fn(),
      onPagesChange: vi.fn(),
      onError: vi.fn(),
      ...overrides,
    },
  };
}

describe('workspace drop persistence', () => {
  it('persists one card write when moving between decks', async () => {
    const context = state();
    await handleWorkspaceDrop(
      { activeId: dragId('card', 'card_a'), overId: dragId('deck', 'deck_b') },
      context.value,
    );

    expect(context.repository.upsertCard).toHaveBeenCalledOnce();
    expect(context.repository.upsertCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'card_a', deckId: 'deck_b' }),
    );
    expect(context.value.onCardsChange).toHaveBeenCalledOnce();
  });

  it('persists one deck write when dropping onto a page', async () => {
    const context = state();
    await handleWorkspaceDrop(
      { activeId: dragId('deck', 'deck_a'), overId: dragId('page', 'page_b') },
      context.value,
    );

    expect(context.repository.upsertDeck).toHaveBeenCalledOnce();
    expect(context.repository.upsertDeck).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'deck_a', pageId: 'page_b' }),
    );
  });

  it('pins a card with one write and preserves all sibling orders', async () => {
    const context = state();
    const originalOrders = context.value.cards.map(({ order }) => order);
    await handleWorkspaceDrop(
      { activeId: dragId('card', 'card_a'), overId: dragId('pin', 'drawer') },
      context.value,
    );

    expect(context.repository.upsertCard).toHaveBeenCalledOnce();
    expect(context.repository.upsertCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'card_a', pinned: true }),
    );
    expect(context.value.cards.map(({ order }) => order)).toEqual(
      originalOrders,
    );
  });

  it('reports write failures without changing local state', async () => {
    const context = state();
    context.repository.upsertCard.mockRejectedValueOnce(new Error('disk full'));
    await handleWorkspaceDrop(
      { activeId: dragId('card', 'card_a'), overId: dragId('deck', 'deck_b') },
      context.value,
    );

    expect(context.value.onCardsChange).not.toHaveBeenCalled();
    expect(context.value.onError).toHaveBeenCalledWith(
      expect.stringContaining('disk full'),
    );
  });
});
