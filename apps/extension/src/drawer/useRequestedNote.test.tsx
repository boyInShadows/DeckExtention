// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import type { Card, Deck } from 'deck-schema';
import type { DeckRepository } from '../storage/repository';
import { render } from '../testing/render';
import { useRequestedNote } from './useRequestedNote';
import { INBOX_PAGE_ID } from './drawerModel';

const card: Card = {
  id: 'card_task',
  deckId: 'deck_inbox',
  kind: 'task',
  title: 'Task',
  hostname: '',
  order: 'a0',
  pinned: false,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  lastOpenedAt: null,
};
const deck: Deck = {
  id: 'deck_inbox',
  pageId: 'page_home',
  title: 'Inbox',
  kind: 'inbox',
  order: 'a0',
  color: null,
  isCollapsed: false,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
function setup(records: Card[], canSelect = true) {
  const listCards = vi.fn().mockResolvedValue(records);
  const options = {
    repository: { listCards } as unknown as DeckRepository,
    requestedNote: card,
    decks: [deck],
    isEnabled: true,
    selectPage: vi.fn().mockResolvedValue(canSelect),
    onOpen: vi.fn(),
    onOpened: vi.fn(),
    onError: vi.fn(),
  };
  function Host() {
    useRequestedNote(options);
    return null;
  }
  return { options, listCards, Host };
}

it('opens the latest stored task on its system page instead of a stale search result', async () => {
  const next = { ...card, note: 'Latest text' };
  const { options, Host } = setup([next]);
  const view = await render(<Host />);
  try {
    await vi.waitFor(() => expect(options.onOpen).toHaveBeenCalledWith(next));
    expect(options.selectPage).toHaveBeenCalledWith(INBOX_PAGE_ID);
    expect(options.onOpened).toHaveBeenCalledOnce();
  } finally {
    view.unmount();
  }
});

it('reports a missing task and does not replace a note whose flush failed', async () => {
  const missing = setup([]);
  const first = await render(<missing.Host />);
  try {
    await vi.waitFor(() =>
      expect(missing.options.onError).toHaveBeenCalledOnce(),
    );
    expect(missing.options.onOpen).not.toHaveBeenCalled();
  } finally {
    first.unmount();
  }
  const blocked = setup([card], false);
  const second = await render(<blocked.Host />);
  try {
    await vi.waitFor(() =>
      expect(blocked.options.selectPage).toHaveBeenCalledOnce(),
    );
    expect(blocked.options.onOpen).not.toHaveBeenCalled();
    expect(blocked.options.onOpened).toHaveBeenCalledOnce();
  } finally {
    second.unmount();
  }
});

it('reports a failed read and clears the request so a notification cannot retry it', async () => {
  const failed = setup([]);
  failed.listCards.mockRejectedValue(new Error('disk failed'));
  const view = await render(<failed.Host />);
  try {
    await vi.waitFor(() =>
      expect(failed.options.onError).toHaveBeenCalledOnce(),
    );
    expect(failed.options.onError).toHaveBeenCalledWith(
      expect.stringContaining('disk failed'),
    );
    expect(failed.options.onOpened).toHaveBeenCalledOnce();
    expect(failed.options.onOpen).not.toHaveBeenCalled();
  } finally {
    view.unmount();
  }
});

it('does not notify or open after an outstanding read is cancelled', async () => {
  const pending = setup([card]);
  let reject: (error: Error) => void = () => undefined;
  pending.listCards.mockReturnValue(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  const view = await render(<pending.Host />);
  view.unmount();
  reject(new Error('old read failed'));
  await Promise.resolve();
  await Promise.resolve();
  expect(pending.options.onError).not.toHaveBeenCalled();
  expect(pending.options.onOpen).not.toHaveBeenCalled();
});
