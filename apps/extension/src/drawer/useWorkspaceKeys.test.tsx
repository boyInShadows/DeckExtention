// @vitest-environment happy-dom
import 'fake-indexeddb/auto';

import type { Card } from 'deck-schema';
import { deleteDB } from 'idb';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
import { resolveKeymap } from '../keys/keymap';
import { DeckRepository } from '../storage/repository';
import { keyDown, render, type RenderResult } from '../testing/render';
import { useWorkspaceKeys } from './useWorkspaceKeys';

const NOW = 1_800_000_000_000;
const DATABASE_NAME = 'deck-workspace-keys-test';
const MAX_PINS = 12;
const KEYMAP = resolveKeymap([]);

function makeCard(id: string, deckId: string, extra: Partial<Card> = {}) {
  return {
    id,
    deckId,
    url: `https://example.com/${id}`,
    title: id,
    hostname: 'example.com',
    order: `a${id.at(-1) ?? '0'}`,
    pinned: false,
    lastOpenedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...extra,
  } satisfies Card;
}

interface HarnessProps {
  deckIds: string[];
  initialCards: Card[];
  repository: DeckRepository;
  isPaused?: boolean;
  hasAddDeck?: boolean;
  isMainMissing?: boolean;
  onCardsChange?: (cards: Card[]) => void;
  onError?: (error: unknown) => void;
  onNote?: (card: Card) => void;
  onMove?: (card: Card) => void;
  onAddDeck?: () => void;
  onAddLink?: (deckId: string) => void;
}

/** A minimal grid with the same data-deck contract DeckWorkspace renders. */
function Harness(props: HarnessProps) {
  const mainRef = useRef<HTMLElement>(null);
  const [cards, setCards] = useState(props.initialCards);
  useWorkspaceKeys({
    mainRef,
    keymap: KEYMAP,
    cards,
    repository: props.repository,
    isPaused: props.isPaused ?? false,
    onCardsChange: (next) => {
      setCards(next);
      props.onCardsChange?.(next);
    },
    onError: props.onError ?? (() => undefined),
    onNote: props.onNote ?? (() => undefined),
    onMove: props.onMove ?? (() => undefined),
  });
  const grid = props.deckIds.map((deckId) => (
    <section key={deckId} data-deck="deck" data-deck-id={deckId} tabIndex={0}>
      {cards
        .filter((card) => card.deckId === deckId && card.deletedAt === null)
        .map((card) => (
          <article
            key={card.id}
            data-deck="card"
            data-card-id={card.id}
            tabIndex={0}
          >
            {card.title}
          </article>
        ))}
      <button
        type="button"
        data-deck="add-card"
        onClick={() => props.onAddLink?.(deckId)}
      >
        add
      </button>
    </section>
  ));
  return (
    <div>
      <button type="button" data-testid="outside">
        outside
      </button>
      {props.isMainMissing ? null : (
        <main ref={mainRef}>
          {grid}
          {props.hasAddDeck === false ? null : (
            <button
              type="button"
              data-deck="deck-add"
              onClick={() => props.onAddDeck?.()}
            >
              add deck
            </button>
          )}
          <input aria-label="field" />
        </main>
      )}
    </div>
  );
}

let repository: DeckRepository;

beforeEach(() => {
  repository = new DeckRepository({ databaseName: DATABASE_NAME });
});

afterEach(async () => {
  await repository.close();
  await deleteDB(DATABASE_NAME);
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function seed(cards: Card[]) {
  for (const card of cards) await repository.upsertCard(card);
  return cards;
}

function cardElement(view: RenderResult, id: string): HTMLElement {
  return view.get(`[data-card-id="${id}"]`);
}

function deckElement(view: RenderResult, id: string): HTMLElement {
  return view.get(`[data-deck-id="${id}"]`);
}

/** Presses `key` on whatever has focus, as a user would. */
async function press(
  view: RenderResult,
  key: string,
  init: KeyboardEventInit = {},
): Promise<KeyboardEvent> {
  let event: KeyboardEvent | undefined;
  await view.act(() => {
    event = keyDown(document.activeElement ?? document.body, key, init);
  });
  if (!event) throw new Error('keydown was not dispatched');
  return event;
}

/**
 * Retries `assertion` until the queued repository write has landed, flushing
 * Preact's renders before each attempt.
 */
async function eventually(view: RenderResult, assertion: () => unknown) {
  await vi.waitFor(async () => {
    await view.act(async () => {});
    await assertion();
  });
}

describe('useWorkspaceKeys - movement', () => {
  it('walks cards with j/k and decks with l/h, wrapping onto deck headers', async () => {
    const cards = [makeCard('card_1', 'deck_1'), makeCard('card_2', 'deck_1')];
    const view = await render(
      <Harness
        deckIds={['deck_1', 'deck_2']}
        initialCards={cards}
        repository={repository}
      />,
    );

    const first = await press(view, 'j');
    expect(first.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cardElement(view, 'card_1'));

    await press(view, 'j');
    expect(document.activeElement).toBe(cardElement(view, 'card_2'));

    await press(view, 'ArrowRight');
    expect(document.activeElement).toBe(deckElement(view, 'deck_2'));

    await press(view, 'h');
    expect(document.activeElement).toBe(cardElement(view, 'card_1'));

    await press(view, 'k');
    expect(document.activeElement).toBe(deckElement(view, 'deck_1'));
    view.unmount();
  });

  it('does nothing visible when there is no deck to move to', async () => {
    const view = await render(
      <Harness deckIds={[]} initialCards={[]} repository={repository} />,
    );
    const event = await press(view, 'j');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.body);
    view.unmount();
  });
});

describe('useWorkspaceKeys - ignored keys', () => {
  it('ignores keys while paused, while typing and from outside the grid', async () => {
    const cards = [makeCard('card_1', 'deck_1')];
    const paused = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={cards}
        repository={repository}
        isPaused
      />,
    );
    expect((await press(paused, 'j')).defaultPrevented).toBe(false);
    paused.unmount();

    const view = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={cards}
        repository={repository}
      />,
    );
    view.getByLabel<HTMLInputElement>('field').focus();
    expect((await press(view, 'j')).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(view.getByLabel('field'));

    view.get('[data-testid="outside"]').focus();
    expect((await press(view, 'j')).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(view.get('[data-testid="outside"]'));
    view.unmount();
  });

  it('ignores keys when the grid is not mounted', async () => {
    const view = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={[]}
        repository={repository}
        isMainMissing
      />,
    );
    expect((await press(view, 'j')).defaultPrevented).toBe(false);
    view.unmount();
  });

  it('leaves keys to a card that is mid keyboard-drag', async () => {
    const cards = [makeCard('card_1', 'deck_1')];
    const view = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={cards}
        repository={repository}
      />,
    );
    cardElement(view, 'card_1').setAttribute('data-dragging', 'true');
    expect((await press(view, 'j')).defaultPrevented).toBe(false);
    view.unmount();
  });

  it('ignores bare modifiers, unbound keys and card keys with no card focused', async () => {
    const onNote = vi.fn();
    const view = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={[]}
        repository={repository}
        onNote={onNote}
      />,
    );
    expect(
      (await press(view, 'Shift', { shiftKey: true })).defaultPrevented,
    ).toBe(false);
    expect((await press(view, 'z')).defaultPrevented).toBe(false);
    deckElement(view, 'deck_1').focus();
    expect((await press(view, 'n')).defaultPrevented).toBe(false);
    expect(onNote).not.toHaveBeenCalled();
    view.unmount();
  });

  it('does not claim a drawer key that is neither a grid nor a card action', async () => {
    const cards = [makeCard('card_1', 'deck_1')];
    const view = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={cards}
        repository={repository}
      />,
    );
    cardElement(view, 'card_1').focus();
    expect((await press(view, ']')).defaultPrevented).toBe(false);
    view.unmount();
  });
});

describe('useWorkspaceKeys - add keys', () => {
  it('clicks Add deck on d and the focused deck’s Add link on a', async () => {
    const onAddDeck = vi.fn();
    const onAddLink = vi.fn();
    const cards = [makeCard('card_1', 'deck_2')];
    const view = await render(
      <Harness
        deckIds={['deck_1', 'deck_2']}
        initialCards={cards}
        repository={repository}
        onAddDeck={onAddDeck}
        onAddLink={onAddLink}
      />,
    );

    expect((await press(view, 'd')).defaultPrevented).toBe(true);
    expect(onAddDeck).toHaveBeenCalledTimes(1);

    view.get('[data-testid="outside"]').blur();
    await press(view, 'a');
    expect(onAddLink).toHaveBeenLastCalledWith('deck_1');

    cardElement(view, 'card_1').focus();
    await press(view, 'a');
    expect(onAddLink).toHaveBeenLastCalledWith('deck_2');
    view.unmount();
  });

  it('claims d and a even when there is nothing to click', async () => {
    const view = await render(
      <Harness
        deckIds={[]}
        initialCards={[]}
        repository={repository}
        hasAddDeck={false}
      />,
    );
    expect((await press(view, 'd')).defaultPrevented).toBe(true);
    expect((await press(view, 'a')).defaultPrevented).toBe(true);
    view.unmount();
  });
});

describe('useWorkspaceKeys - card actions', () => {
  it('hands the focused card to note and move', async () => {
    const onNote = vi.fn();
    const onMove = vi.fn();
    const cards = [makeCard('card_1', 'deck_1')];
    const view = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={cards}
        repository={repository}
        onNote={onNote}
        onMove={onMove}
      />,
    );
    cardElement(view, 'card_1').focus();
    expect((await press(view, 'n')).defaultPrevented).toBe(true);
    expect((await press(view, 'm')).defaultPrevented).toBe(true);
    expect(onNote).toHaveBeenCalledWith(cards[0]);
    expect(onMove).toHaveBeenCalledWith(cards[0]);
    view.unmount();
  });

  it('opens a card here on Enter and in a new tab on Shift+Enter, stamping lastOpenedAt', async () => {
    const assign = vi.spyOn(location, 'assign').mockImplementation(() => {});
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onCardsChange = vi.fn();
    const cards = await seed([makeCard('card_1', 'deck_1')]);
    const view = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={cards}
        repository={repository}
        onCardsChange={onCardsChange}
      />,
    );
    cardElement(view, 'card_1').focus();
    await press(view, 'Enter');
    await eventually(view, () =>
      expect(assign).toHaveBeenCalledWith('https://example.com/card_1'),
    );

    await press(view, 'Enter', { shiftKey: true });
    await eventually(view, () =>
      expect(open).toHaveBeenCalledWith(
        'https://example.com/card_1',
        '_blank',
        'noopener',
      ),
    );
    const [stored] = await repository.listCards();
    expect(stored?.lastOpenedAt).toEqual(expect.any(Number));
    expect(onCardsChange).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('reports a failed write and keeps the cards unchanged', async () => {
    const assign = vi.spyOn(location, 'assign').mockImplementation(() => {});
    const onError = vi.fn();
    const onCardsChange = vi.fn();
    const unsafe = makeCard('card_1', 'deck_1', { url: 'javascript:alert(1)' });
    const view = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={[unsafe]}
        repository={repository}
        onError={onError}
        onCardsChange={onCardsChange}
      />,
    );
    cardElement(view, 'card_1').focus();
    await press(view, 'Enter');
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(new Error(strings.invalidUrl)),
    );
    expect(onCardsChange).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    view.unmount();
  });

  it('pins the focused card into its own deck', async () => {
    const cards = await seed([makeCard('card_1', 'deck_1')]);
    const view = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={cards}
        repository={repository}
      />,
    );
    cardElement(view, 'card_1').focus();
    await press(view, 'p');
    await eventually(view, async () =>
      expect(await repository.listCards()).toMatchObject([
        { id: 'card_1', pinned: true, deckId: 'deck_1' },
      ]),
    );
    view.unmount();
  });

  it('surfaces the pin limit as an error', async () => {
    const pinned = Array.from({ length: MAX_PINS }, (_, index) =>
      makeCard(`pinned_${index}`, 'deck_2', { pinned: true }),
    );
    const onError = vi.fn();
    const cards = [makeCard('card_1', 'deck_1'), ...pinned];
    const view = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={cards}
        repository={repository}
        onError={onError}
      />,
    );
    cardElement(view, 'card_1').focus();
    await press(view, 'p');
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(new Error(strings.pinLimitReached)),
    );
    view.unmount();
  });
});

describe('useWorkspaceKeys - trash', () => {
  it('soft-deletes the focused card and focuses the card that took its place', async () => {
    const cards = await seed([
      makeCard('card_1', 'deck_1'),
      makeCard('card_2', 'deck_1'),
    ]);
    const view = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={cards}
        repository={repository}
      />,
    );
    cardElement(view, 'card_1').focus();
    expect((await press(view, 'x')).defaultPrevented).toBe(true);

    await eventually(view, () =>
      expect(document.activeElement).toBe(cardElement(view, 'card_2')),
    );
    expect(view.query('[data-card-id="card_1"]')).toBeNull();
    const stored = await repository.listCards();
    expect(stored.find(({ id }) => id === 'card_1')?.deletedAt).toEqual(
      expect.any(Number),
    );
    view.unmount();
  });

  it('focuses the deck itself once its last card is trashed', async () => {
    const cards = await seed([makeCard('card_1', 'deck_1')]);
    const view = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={cards}
        repository={repository}
      />,
    );
    cardElement(view, 'card_1').focus();
    await press(view, 'x');
    await eventually(view, () =>
      expect(document.activeElement).toBe(deckElement(view, 'deck_1')),
    );
    view.unmount();
  });

  it('never steals focus that moved elsewhere while the write was queued', async () => {
    const cards = await seed([
      makeCard('card_1', 'deck_1'),
      makeCard('card_2', 'deck_1'),
    ]);
    const view = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={cards}
        repository={repository}
      />,
    );
    cardElement(view, 'card_1').focus();
    await press(view, 'x');
    const field = view.getByLabel<HTMLInputElement>('field');
    field.focus();
    await eventually(view, () =>
      expect(view.query('[data-card-id="card_1"]')).toBeNull(),
    );
    await waitForAnimationFrame(view);
    expect(document.activeElement).toBe(field);
    view.unmount();
  });

  it('does not reclaim focus once the workspace is paused', async () => {
    const cards = await seed([
      makeCard('card_1', 'deck_1'),
      makeCard('card_2', 'deck_1'),
    ]);
    const props = { deckIds: ['deck_1'], initialCards: cards, repository };
    const view = await render(<Harness {...props} />);
    cardElement(view, 'card_1').focus();
    await press(view, 'x');
    await view.rerender(<Harness {...props} isPaused />);
    await eventually(view, () =>
      expect(view.query('[data-card-id="card_1"]')).toBeNull(),
    );
    await waitForAnimationFrame(view);
    expect(document.activeElement).not.toBe(cardElement(view, 'card_2'));
    view.unmount();
  });

  it('reports a trash that the repository refuses', async () => {
    const onError = vi.fn();
    const unsaved = [makeCard('card_1', 'deck_1')];
    const view = await render(
      <Harness
        deckIds={['deck_1']}
        initialCards={unsaved}
        repository={repository}
        onError={onError}
      />,
    );
    cardElement(view, 'card_1').focus();
    await press(view, 'x');
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(
        new Error('Cannot delete missing card card_1'),
      ),
    );
    expect(view.query('[data-card-id="card_1"]')).not.toBeNull();
    view.unmount();
  });
});

async function waitForAnimationFrame(view: RenderResult) {
  await view.act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );
}
