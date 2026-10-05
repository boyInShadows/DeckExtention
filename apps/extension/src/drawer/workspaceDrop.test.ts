import type { Card, Deck, Page } from 'deck-schema';
import { describe, expect, it, vi } from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
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

describe('workspace drop persistence - pages and guards', () => {
  const PIN_LIMIT = 12;

  async function drop(
    context: ReturnType<typeof state>,
    activeId: string,
    overId: string,
  ) {
    await handleWorkspaceDrop({ activeId, overId }, context.value);
  }

  function writes(context: ReturnType<typeof state>): number {
    const { upsertPage, upsertDeck, upsertCard } = context.repository;
    return [upsertPage, upsertDeck, upsertCard].reduce(
      (total, write) => total + write.mock.calls.length,
      0,
    );
  }

  it('reorders a page with one write, after the page it was dropped on', async () => {
    const context = state();
    await drop(context, dragId('page', 'page_a'), dragId('page', 'page_b'));

    expect(context.repository.upsertPage).toHaveBeenCalledOnce();
    const saved = context.repository.upsertPage.mock.calls[0]?.[0];
    expect(saved?.id).toBe('page_a');
    expect(saved && saved.order > 'a1').toBe(true);
    expect(context.value.onPagesChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'page_a', order: saved?.order }),
      expect.objectContaining({ id: 'page_b', order: 'a1' }),
    ]);
  });

  it('ignores a dragged page that is trashed or unknown', async () => {
    const context = state({
      pages: [{ ...page('page_a', 'a0'), deletedAt: 1 }, page('page_b', 'a1')],
    });
    await drop(context, dragId('page', 'page_a'), dragId('page', 'page_b'));
    await drop(context, dragId('page', 'page_x'), dragId('page', 'page_b'));
    expect(writes(context)).toBe(0);
  });

  it('moves a deck beside the deck it was dropped on', async () => {
    const context = state();
    await drop(context, dragId('deck', 'deck_a'), dragId('deck', 'deck_b'));
    expect(context.repository.upsertDeck).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'deck_a', pageId: 'page_b' }),
    );
    expect(context.value.onDecksChange).toHaveBeenCalledOnce();
  });

  it('moves a card beside the card it was dropped on', async () => {
    const context = state();
    await drop(context, dragId('card', 'card_a'), dragId('card', 'card_b'));
    expect(context.repository.upsertCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'card_a', deckId: 'deck_b' }),
    );
  });

  it('writes nothing for drops that mean nothing', async () => {
    const context = state({
      decks: [deck('deck_a', 'page_a', 'a0'), deck('card_b', 'page_b', 'a1')],
      cards: [card('card_a', 'deck_a', 'a0'), card('page_b', 'deck_a', 'a1')],
    });
    const meaningless: [string, string][] = [
      ['not-a-drag-id', dragId('page', 'page_b')],
      [dragId('card', 'card_a'), 'garbage:'],
      [dragId('page', 'page_a'), dragId('deck', 'deck_a')],
      [dragId('pin', 'drawer'), dragId('page', 'page_a')],
      // Over a card id that no deck owns, or over a non-deck entity.
      [dragId('deck', 'deck_a'), dragId('card', 'card_a')],
      [dragId('deck', 'deck_a'), dragId('card', 'card_b')],
      [dragId('deck', 'deck_gone'), dragId('page', 'page_b')],
      // Over a page id, or a deck no card lives in.
      [dragId('card', 'card_a'), dragId('page', 'page_a')],
      [dragId('card', 'card_a'), dragId('page', 'page_b')],
      [dragId('card', 'card_gone'), dragId('deck', 'deck_a')],
      [dragId('card', 'card_gone'), dragId('pin', 'drawer')],
    ];
    for (const [activeId, overId] of meaningless) {
      await drop(context, activeId, overId);
    }
    expect(writes(context)).toBe(0);
    expect(context.value.onError).not.toHaveBeenCalled();
  });

  it('leaves an already pinned card where it is', async () => {
    const context = state({
      cards: [{ ...card('card_a', 'deck_a', 'a0'), pinned: true }],
    });
    await drop(context, dragId('card', 'card_a'), dragId('pin', 'drawer'));
    expect(writes(context)).toBe(0);
  });

  it('appends a new pin after the last live pin', async () => {
    const context = state({
      cards: [
        { ...card('card_p1', 'deck_a', 'a3'), pinned: true },
        { ...card('card_p2', 'deck_a', 'a7'), pinned: true, deletedAt: 1 },
        card('card_a', 'deck_a', 'a0'),
      ],
    });
    await drop(context, dragId('card', 'card_a'), dragId('pin', 'drawer'));
    const saved = context.repository.upsertCard.mock.calls[0]?.[0];
    expect(saved?.pinned).toBe(true);
    expect(saved && saved.order > 'a3').toBe(true);
    expect(saved && saved.order < 'a7').toBe(true);
  });

  it('refuses a thirteenth pin and says the pins are full', async () => {
    const pins = Array.from({ length: PIN_LIMIT }, (_, index) => ({
      ...card(`card_p${index}`, 'deck_a', `a${index}`),
      pinned: true,
    }));
    const context = state({
      cards: [...pins, card('card_new', 'deck_b', 'a0')],
    });
    await drop(context, dragId('card', 'card_new'), dragId('pin', 'drawer'));
    expect(writes(context)).toBe(0);
    expect(context.value.onError).toHaveBeenCalledWith(
      expect.stringContaining(strings.pinLimitReached),
    );
  });

  it('reports a non-Error failure as text', async () => {
    const context = state();
    context.repository.upsertPage.mockRejectedValueOnce('quota');
    await drop(context, dragId('page', 'page_a'), dragId('page', 'page_b'));
    expect(context.value.onError).toHaveBeenCalledWith(
      `${strings.updateFailed} quota`,
    );
    expect(context.value.onPagesChange).not.toHaveBeenCalled();
  });
});
