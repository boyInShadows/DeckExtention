// @vitest-environment happy-dom
import { type Card } from 'deck-schema';
import { afterEach, expect, it, vi } from 'vitest';
import PinAddForm from '../../src/newtab/PinAddForm';
import type { DeckRepository } from '../../src/storage/repository';
import {
  click,
  keyDown,
  render,
  type,
  type RenderResult,
} from '../../src/testing/render';

const existing: Card = {
  id: 'saved_pin',
  deckId: 'deck_inbox',
  url: 'https://example.com/',
  title: 'Example',
  hostname: 'example.com',
  order: 'a0',
  pinned: true,
  lastOpenedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

async function fixture(
  options: { canSaveToInbox?: boolean; pins?: Card[] } = {},
) {
  const cards = options.pins ?? [existing];
  const listCards = vi.fn(async () => cards);
  const upsertCard = vi.fn(async (card: Card) => card);
  const markCardsOpened = vi.fn(async () => [existing]);
  const repository = {
    listCards,
    listPages: async () => [],
    listDecks: async () => [
      { id: 'deck_inbox', kind: 'inbox', deletedAt: null },
    ],
    upsertCard,
    markCardsOpened,
  } as unknown as DeckRepository;
  const onClose = vi.fn();
  const notify = vi.fn();
  const view = await render(
    <PinAddForm
      cards={cards}
      pins={cards}
      initialUrl=""
      canSaveToInbox={options.canSaveToInbox ?? false}
      repository={repository}
      onCardsChange={vi.fn()}
      onClose={onClose}
      notify={notify}
    />,
  );
  return { view, listCards, upsertCard, markCardsOpened, notify, onClose };
}

async function submit(view: RenderResult, url: string) {
  await view.act(() => type(view.get('.deck-pin-url-input'), url));
  await view.act(() =>
    type(view.get('.deck-pin-label-input'), 'Keep my label'),
  );
  await view.act(() => {
    keyDown(view.get('.deck-pin-url-input'), 'Enter');
  });
}

async function settle(view: RenderResult, assertion: () => void) {
  await vi.waitFor(async () => {
    await view.act(async () => {});
    assertion();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it('explains an equivalent saved URL before writing and opens the current record without losing drafts', async () => {
  const { view, upsertCard, onClose, markCardsOpened } = await fixture();
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  await submit(view, '  HTTPS://EXAMPLE.COM:443  ');
  await settle(view, () =>
    expect(view.container.textContent).toContain('Already saved in Pins.'),
  );
  expect(upsertCard).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  await view.act(() => click(view.getByLabel('Open saved link')));
  await settle(view, () =>
    expect(markCardsOpened).toHaveBeenCalledWith(['saved_pin']),
  );
  expect(open).toHaveBeenCalledWith(existing.url, '_blank', 'noopener');
  expect(view.get<HTMLInputElement>('.deck-pin-label-input').value).toBe(
    'Keep my label',
  );
  view.unmount();
});

it('keeps the draft and reports failed duplicate reads without writing', async () => {
  const { view, listCards, upsertCard, notify, onClose } = await fixture();
  listCards.mockRejectedValue(new Error('read failed'));
  await submit(view, 'https://example.com/new');
  await settle(view, () =>
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        text: expect.stringContaining('read failed'),
      }),
    ),
  );
  expect(upsertCard).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(view.get<HTMLInputElement>('.deck-pin-url-input').value).toBe(
    'https://example.com/new',
  );
  expect(view.get<HTMLInputElement>('.deck-pin-label-input').value).toBe(
    'Keep my label',
  );
  view.unmount();
});

it('clears a duplicate warning on editing and saves a distinct path', async () => {
  const { view, upsertCard, onClose } = await fixture();
  await submit(view, 'https://example.com');
  await settle(view, () =>
    expect(view.query('[data-deck="duplicate-link"]')).not.toBeNull(),
  );
  await submit(view, 'https://example.com/new');
  await settle(view, () => expect(onClose).toHaveBeenCalledOnce());
  expect(upsertCard).toHaveBeenCalledOnce();
  expect(upsertCard).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'https://example.com/new',
      pinLabel: 'Keep my label',
    }),
  );
  view.unmount();
});

it('reports failed opening and retains the duplicate and editable draft', async () => {
  const { view, markCardsOpened, notify } = await fixture();
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  markCardsOpened.mockRejectedValue(new Error('open failed'));
  await submit(view, 'https://example.com');
  await settle(view, () =>
    expect(view.query('[data-deck="duplicate-link"]')).not.toBeNull(),
  );
  await view.act(() => click(view.getByLabel('Open saved link')));
  await settle(view, () =>
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        text: expect.stringContaining('open failed'),
      }),
    ),
  );
  expect(open).not.toHaveBeenCalled();
  expect(view.get<HTMLInputElement>('.deck-pin-url-input').value).toBe(
    'https://example.com',
  );
  view.unmount();
});

it.each([false, true])(
  'keeps both fields after a failed write and allows retrying (Inbox available: %s)',
  async (canSaveToInbox) => {
    const { view, upsertCard, notify, onClose } = await fixture({
      canSaveToInbox,
    });
    upsertCard.mockRejectedValueOnce(new Error('disk full'));
    await submit(view, 'https://example.com/new');
    await settle(view, () =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', text: 'disk full' }),
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(view.get<HTMLInputElement>('.deck-pin-label-input').value).toBe(
      'Keep my label',
    );
    await view.act(() => {
      keyDown(view.get('.deck-pin-url-input'), 'Enter');
    });
    await settle(view, () => expect(onClose).toHaveBeenCalledOnce());
    view.unmount();
  },
);

it('accepts only one submission while a current-record lookup is pending', async () => {
  const { view, listCards, upsertCard, onClose } = await fixture();
  let release: (cards: Card[]) => void = () => {
    throw new Error('Lookup not pending');
  };
  const pending = new Promise<Card[]>((resolve) => {
    release = resolve;
  });
  listCards.mockReturnValueOnce(pending);
  await submit(view, 'https://example.com/new');
  expect(view.get<HTMLInputElement>('.deck-pin-url-input').readOnly).toBe(true);
  await view.act(() => {
    keyDown(view.get('.deck-pin-url-input'), 'Enter');
  });
  expect(listCards).toHaveBeenCalledOnce();
  await view.act(() => release([]));
  await settle(view, () => expect(onClose).toHaveBeenCalledOnce());
  expect(upsertCard).toHaveBeenCalledOnce();
  view.unmount();
});

it('offers Inbox and Pin for pasted URLs and Enter saves only an Inbox record', async () => {
  const { view, upsertCard, onClose } = await fixture({ canSaveToInbox: true });
  expect(view.getByLabel('Save to Inbox')).not.toBeNull();
  expect(view.getByLabel('Add pin')).not.toBeNull();
  await submit(view, 'https://inbox.example.com/new');
  await settle(view, () => expect(onClose).toHaveBeenCalledOnce());
  expect(upsertCard).toHaveBeenCalledOnce();
  expect(upsertCard).toHaveBeenCalledWith(
    expect.objectContaining({
      deckId: 'deck_inbox',
      pinned: false,
      title: 'Keep my label',
    }),
  );
  view.unmount();
});

it('keeps Inbox available at the pin limit while disabling Add pin', async () => {
  const pins = Array.from({ length: 12 }, (_, index) => ({
    ...existing,
    id: `pin_${index}`,
  }));
  const { view, upsertCard, onClose } = await fixture({
    canSaveToInbox: true,
    pins,
  });
  expect(
    view.get<HTMLButtonElement>('button[title="12 pins max"]').disabled,
  ).toBe(true);
  await submit(view, 'https://inbox.example.com/new');
  await settle(view, () => expect(onClose).toHaveBeenCalledOnce());
  expect(upsertCard).toHaveBeenCalledOnce();
  expect(upsertCard).toHaveBeenCalledWith(
    expect.objectContaining({ pinned: false }),
  );
  view.unmount();
});
