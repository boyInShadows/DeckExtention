// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import type { Card, Deck, Page } from 'deck-schema';
import { click, keyDown, render } from '../testing/render';
import type { DeckRepository } from '../storage/repository';
import Shelf from './Shelf';
import { shelfDecks } from './shelfModel';

const page: Page = {
  id: 'page_shelf',
  title: 'Work',
  order: 'a0',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const deck: Deck = {
  ...page,
  id: 'deck_shelf',
  pageId: page.id,
  title: 'Reading',
  kind: 'normal',
  isCollapsed: false,
  color: null,
};
const second = { ...deck, id: 'deck_other', title: 'Research', order: 'a1' };
const card: Card = {
  ...page,
  id: 'card_shelf',
  deckId: deck.id,
  title: 'Read this',
  url: 'https://example.com/',
  hostname: 'example.com',
  pinned: false,
  lastOpenedAt: null,
};
const task: Card = {
  ...card,
  id: 'task_shelf',
  kind: 'task',
  url: undefined,
  title: 'Remember this',
  hostname: '',
};

afterEach(() => vi.unstubAllGlobals());

function setup(cards = [card, task], decks = [deck, second]) {
  const repository = { markCardsOpened: vi.fn().mockResolvedValue(undefined) };
  const onError = vi.fn();
  const onOpenNote = vi.fn();
  const onDataChange = vi.fn();
  return {
    repository,
    onError,
    onOpenNote,
    onDataChange,
    props: {
      cards,
      decks,
      pages: [page],
      selectedDeckIds: decks.map((item) => item.id),
      repository: repository as unknown as DeckRepository,
      onError,
      onOpenNote,
      onDataChange,
    },
  };
}

it('selects only live decks on live pages, in workspace order, without mutating inputs', () => {
  const decks = [
    second,
    { ...deck, id: 'deck_inbox', kind: 'inbox' as const },
    { ...deck, id: 'deck_deleted', deletedAt: 1 },
    { ...deck, id: 'deck_orphan', pageId: 'page_missing' },
    deck,
  ];
  const saved = structuredClone(decks);
  expect(shelfDecks([page], decks).map((item) => item.id)).toEqual([
    deck.id,
    second.id,
  ]);
  expect(shelfDecks([{ ...page, deletedAt: 1 }], decks)).toEqual([]);
  expect(decks).toEqual(saved);
});

it('keeps one panel open, supports header arrows and Left from a card, and exposes no edit controls', async () => {
  const { props } = setup();
  const view = await render(<Shelf {...props} />);
  try {
    const headers = view.getAll<HTMLButtonElement>(
      '[data-deck="shelf-toggle"]',
    );
    const first = headers[0];
    const next = headers[1];
    if (!first || !next) throw new Error('Missing Shelf headers');
    expect(view.getAll('[data-deck="shelf-panel"]:not([hidden])')).toHaveLength(
      0,
    );
    await view.act(() => click(first));
    expect(first.getAttribute('aria-expanded')).toBe('true');
    await view.act(() => {
      keyDown(first, 'ArrowDown');
    });
    expect(document.activeElement).toBe(next);
    await view.act(() => click(next));
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(view.getAll('[data-deck="shelf-panel"]:not([hidden])')).toHaveLength(
      1,
    );
    await view.act(() => {
      keyDown(next, 'ArrowUp');
    });
    expect(document.activeElement).toBe(first);
    await view.act(() => click(first));
    await view.act(() => {
      keyDown(view.get('[data-deck="shelf-card"] a'), 'ArrowLeft');
    });
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(first);
    expect(
      view.query('input, textarea, [role="checkbox"], [data-deck="card-edit"]'),
    ).toBeNull();
  } finally {
    view.unmount();
  }
});

it('hides stale selections and deleted or pinned cards; opens tasks in the drawer instead of navigating', async () => {
  const { props, onOpenNote, repository } = setup([
    card,
    task,
    { ...card, id: 'card_trash', deletedAt: 1 },
    { ...card, id: 'card_pinned', pinned: true },
  ]);
  const view = await render(<Shelf {...props} />);
  try {
    await view.act(() => click(view.get('[data-deck="shelf-toggle"]')));
    expect(view.getAll('[data-deck="shelf-card"]')).toHaveLength(2);
    await view.act(() => click(view.get('[data-deck="shelf-note"]')));
    expect(onOpenNote).toHaveBeenCalledWith(task);
    expect(repository.markCardsOpened).not.toHaveBeenCalled();
    await view.rerender(
      <Shelf {...props} selectedDeckIds={['missing_deck']} />,
    );
    expect(view.query('[data-deck="shelf"]')).toBeNull();
  } finally {
    view.unmount();
  }
});

it('stamps through the atomic existing helper before navigation and reports failed writes without opening', async () => {
  const create = vi.fn().mockResolvedValue({ id: 1 });
  vi.stubGlobal('chrome', { tabs: { create } });
  const { props, repository, onError, onDataChange } = setup([card]);
  const view = await render(<Shelf {...props} />);
  try {
    await view.act(() => click(view.get('[data-deck="shelf-toggle"]')));
    repository.markCardsOpened.mockRejectedValueOnce(new Error('disk failed'));
    await view.act(() => click(view.get('[data-deck="shelf-card"] a')));
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('disk failed'),
    );
    expect(create).not.toHaveBeenCalled();
    const link = view.get('[data-deck="shelf-card"] a');
    await view.act(() => {
      link.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }),
      );
    });
    expect(repository.markCardsOpened).toHaveBeenCalledWith([card.id]);
    expect(create).toHaveBeenCalledWith({ url: card.url });
    expect(onDataChange).toHaveBeenCalledOnce();
  } finally {
    view.unmount();
  }
});
