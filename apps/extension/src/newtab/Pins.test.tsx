// @vitest-environment happy-dom
import type { Card } from 'deck-schema';
import type * as DndCore from '@dnd-kit/core';
import type * as DndSortable from '@dnd-kit/sortable';
import type { ComponentChildren } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dragId } from '../drawer/dragIdentity';
import { compareOrder } from '../drawer/workspaceModel';
import { WORKSPACE_DROP_EVENT } from '../drawer/WorkspaceDnd';
import { panelStrings as strings } from '../i18n/panelStrings';
import type { UndoAction } from '../drawer/UndoAction';
import type { DeckRepository } from '../storage/repository';
import {
  click,
  keyDown,
  render,
  trusted,
  type,
  type RenderResult,
} from '../testing/render';
import { Pins } from './Pins';

/*
 * dnd-kit is an external dependency, so Vitest loads it un-aliased against
 * real React, whose hooks cannot run under Preact. Its two hooks are replaced
 * by fakes reporting a drag state the test controls; the drop itself arrives
 * the way it does in the extension, as WORKSPACE_DROP_EVENT on window.
 */
const dnd = vi.hoisted(() => ({
  isOver: false,
  collisionId: null as string | null,
  draggingId: null as string | null,
  transform: null as {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
  } | null,
}));

vi.mock('@dnd-kit/core', async (importOriginal) => ({
  ...(await importOriginal<typeof DndCore>()),
  useDroppable: () => ({ isOver: dnd.isOver, setNodeRef: () => undefined }),
  useDndContext: () => ({
    collisions: dnd.collisionId ? [{ id: dnd.collisionId }] : null,
  }),
}));

vi.mock('@dnd-kit/sortable', async (importOriginal) => ({
  ...(await importOriginal<typeof DndSortable>()),
  SortableContext: ({ children }: { children: ComponentChildren }) => children,
  useSortable: ({ id }: { id: string }) => ({
    attributes: { role: 'button', 'aria-roledescription': 'sortable' },
    listeners: {},
    setNodeRef: () => undefined,
    transform: dnd.transform,
    transition: undefined,
    isDragging: dnd.draggingId === id,
  }),
}));

const NOW = 1_800_000_000_000;
const DEFAULT_DECK_ID = 'deck_inbox';
const EXTENSION_ORIGIN = 'chrome-extension://deck';
const MAX_PINS = 12;

function makeCard(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    deckId: DEFAULT_DECK_ID,
    url: `https://${id}.example.com/`,
    title: `Title ${id}`,
    hostname: `${id}.example.com`,
    order: 'a0',
    pinned: true,
    lastOpenedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

/** The item at `index`, failing the test loudly when it is missing. */
function nth<T>(items: readonly T[], index = 0): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Expected an item at ${index}`);
  return item;
}

function fakeRepository(cards: Card[]) {
  let stored = cards;
  const upsertCard = vi.fn(async (card: Card) => {
    stored = stored.some(({ id }) => id === card.id)
      ? stored.map((item) => (item.id === card.id ? card : item))
      : [...stored, card];
    return card;
  });
  const listCards = vi.fn(async () => stored);
  const markCardsOpened = vi.fn(async (ids: string[]) => {
    const time = Date.now();
    stored = stored.map((card) =>
      ids.includes(card.id) && card.deletedAt === null
        ? { ...card, lastOpenedAt: time, updatedAt: time }
        : card,
    );
    return stored.filter(
      (card) => ids.includes(card.id) && card.deletedAt === null,
    );
  });
  return {
    upsertCard,
    markCardsOpened,
    repository: {
      upsertCard,
      listCards,
      markCardsOpened,
    } as unknown as DeckRepository,
  };
}

interface Mounted {
  view: RenderResult;
  upsertCard: ReturnType<typeof fakeRepository>['upsertCard'];
  markCardsOpened: ReturnType<typeof fakeRepository>['markCardsOpened'];
  onCardsChange: ReturnType<typeof vi.fn<(cards: Card[]) => void>>;
  notify: ReturnType<typeof vi.fn>;
  offerUndo: ReturnType<typeof vi.fn>;
}

async function mountPins(cards: Card[]): Promise<Mounted> {
  const { upsertCard, markCardsOpened, repository } = fakeRepository(cards);
  const onCardsChange = vi.fn<(cards: Card[]) => void>();
  const notify = vi.fn();
  const offerUndo = vi.fn();
  const view = await render(
    <Pins
      cards={cards}
      repository={repository}
      onCardsChange={onCardsChange}
      offerUndo={offerUndo}
      notify={notify}
    />,
  );
  return {
    view,
    upsertCard,
    markCardsOpened,
    onCardsChange,
    notify,
    offerUndo,
  };
}

function pinLabels(view: RenderResult): string[] {
  return view
    .getAll('[data-deck="pin"]')
    .map((pin) => pin.getAttribute('aria-label') ?? '');
}

it('stamps a pin before opening its link', async () => {
  const assign = vi
    .spyOn(window.location, 'assign')
    .mockImplementation(() => undefined);
  const { view, upsertCard, markCardsOpened } = await mountPins([
    makeCard('pinned'),
  ]);
  await view.act(() => click(view.get('[data-deck="pin"]')));
  await vi.waitFor(() =>
    expect(assign).toHaveBeenCalledWith('https://pinned.example.com/'),
  );
  expect(markCardsOpened).toHaveBeenCalledWith(['pinned']);
  expect(upsertCard).not.toHaveBeenCalled();
  view.unmount();
});

it('opens a focused pin in a new tab on Shift+Enter', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  const { view, upsertCard, markCardsOpened } = await mountPins([
    makeCard('pinned'),
  ]);
  await view.act(() => {
    keyDown(view.get('[data-deck="pin"]'), 'Enter', { shiftKey: true });
  });
  await vi.waitFor(() =>
    expect(open).toHaveBeenCalledWith(
      'https://pinned.example.com/',
      '_blank',
      'noopener',
    ),
  );
  expect(markCardsOpened).toHaveBeenCalledWith(['pinned']);
  expect(upsertCard).not.toHaveBeenCalled();
  view.unmount();
});

async function openAddForm(view: RenderResult): Promise<HTMLInputElement> {
  await view.act(() => click(view.getByLabel(strings.addPin)));
  await vi.waitFor(async () => {
    await view.act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(view.query('.deck-pin-url-input')).not.toBeNull();
  });
  return view.get<HTMLInputElement>('.deck-pin-url-input');
}

async function submitUrl(
  view: RenderResult,
  url: string,
  notify: ReturnType<typeof vi.fn>,
): Promise<void> {
  const input = await openAddForm(view);
  await view.act(() => type(input, url));
  await view.act(() => {
    keyDown(view.get('.deck-pin-url-input'), 'Enter');
  });
  await vi.waitFor(async () => {
    await view.act(async () => {});
    expect(notify).toHaveBeenCalled();
  });
}

async function openMenu(view: RenderResult, label: string): Promise<void> {
  await view.act(() => {
    view
      .getByLabel(label)
      .dispatchEvent(
        trusted(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        ),
      );
  });
  await vi.waitFor(async () => {
    await view.act(async () => {});
    expect(view.query('[data-deck="pin-menu"]')).not.toBeNull();
  });
}

async function drop(
  view: RenderResult,
  detail: { activeId: string; overId: string },
): Promise<void> {
  await view.act(() => {
    window.dispatchEvent(new CustomEvent(WORKSPACE_DROP_EVENT, { detail }));
  });
  await view.act(async () => {
    await vi.dynamicImportSettled();
  });
}

beforeEach(() => {
  dnd.isOver = false;
  dnd.collisionId = null;
  dnd.draggingId = null;
  dnd.transform = null;
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `${EXTENSION_ORIGIN}${path}` },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('Pins - strip', () => {
  it('shows live pinned cards in order, with label overrides', async () => {
    const { view } = await mountPins([
      makeCard('b', { order: 'a2' }),
      makeCard('a', { order: 'a1', pinLabel: 'Mail' }),
      makeCard('unpinned', { pinned: false }),
      makeCard('trashed', { deletedAt: NOW }),
    ]);
    expect(pinLabels(view)).toEqual(['Mail', 'Title b']);
    expect(view.getAll('.deck-pin__label').map((l) => l.textContent)).toEqual([
      'Mail',
      'Title b',
    ]);
    view.unmount();
  });

  it('uses the emoji icon when set and Chrome favicons otherwise', async () => {
    const { view } = await mountPins([
      makeCard('a', { order: 'a1', pinIcon: '📌' }),
      makeCard('b', { order: 'a2' }),
    ]);
    expect(view.get('.deck-pin__emoji').textContent).toBe('📌');
    const images = view.getAll<HTMLImageElement>('.deck-pin__tile img');
    expect(images).toHaveLength(1);
    expect(nth(images).getAttribute('src')).toBe(
      `${EXTENSION_ORIGIN}/_favicon/?pageUrl=${encodeURIComponent(
        'https://b.example.com/',
      )}&size=32`,
    );
    expect(view.getByLabel('Title b').getAttribute('href')).toBe(
      'https://b.example.com/',
    );
    view.unmount();
  });

  it('marks the strip and the lifted pin while a drag is in progress', async () => {
    const { view } = await mountPins([
      makeCard('a', { order: 'a1' }),
      makeCard('b', { order: 'a2' }),
    ]);
    expect(view.get('[data-deck="pins"]').hasAttribute('data-drag-over')).toBe(
      false,
    );
    expect(view.query('[data-dragging]')).toBeNull();
    view.unmount();

    dnd.isOver = true;
    dnd.collisionId = dragId('pin', 'strip');
    dnd.draggingId = dragId('pin', 'b');
    dnd.transform = { x: 12, y: 0, scaleX: 1, scaleY: 1 };
    const { view: dragging } = await mountPins([
      makeCard('a', { order: 'a1' }),
      makeCard('b', { order: 'a2' }),
    ]);
    expect(
      dragging.get('[data-deck="pins"]').hasAttribute('data-drag-over'),
    ).toBe(true);
    const lifted = dragging.getAll('[data-dragging]');
    expect(lifted.map((pin) => pin.getAttribute('aria-label'))).toEqual([
      'Title b',
    ]);
    expect(nth(lifted).style.transform).toContain('12px');
    dragging.unmount();
  });

  it('highlights the current collision before the delayed over state catches up', async () => {
    dnd.collisionId = dragId('pin', 'strip');
    const { view } = await mountPins([]);
    expect(view.get('[data-deck="pins"]').hasAttribute('data-drag-over')).toBe(
      true,
    );
    view.unmount();
  });

  it('clears the highlight when the delayed over state is stale', async () => {
    dnd.isOver = true;
    const { view } = await mountPins([]);
    expect(view.get('[data-deck="pins"]').hasAttribute('data-drag-over')).toBe(
      false,
    );
    view.unmount();
  });

  it('disables the add button with a useful tooltip once the strip is full', async () => {
    const full = Array.from({ length: MAX_PINS }, (_, index) =>
      makeCard(`p${index}`, { order: `a${index}` }),
    );
    const { view } = await mountPins(full);
    expect(view.get('[data-deck="pin-add"]').hasAttribute('disabled')).toBe(
      true,
    );
    expect(view.get('[data-deck="pin-add"]').getAttribute('title')).toBe(
      strings.pinLimit,
    );
    view.unmount();

    const { view: roomy } = await mountPins(full.slice(1));
    expect(roomy.query('[data-deck="pin-add"]')).not.toBeNull();
    roomy.unmount();
  });
});

describe('Pins - adding', () => {
  it('opens a focused URL field and closes it on Escape', async () => {
    const { view } = await mountPins([]);
    const input = await openAddForm(view);
    expect(document.activeElement).toBe(input);
    expect(view.query('[data-deck="pin-add"]')).toBeNull();

    await view.act(() => {
      keyDown(input, 'a');
    });
    expect(view.query('.deck-pin-url-input')).not.toBeNull();
    await view.act(() => {
      keyDown(input, 'Escape');
    });
    expect(view.query('.deck-pin-url-input')).toBeNull();
    expect(view.query('[data-deck="pin-add"]')).not.toBeNull();
    view.unmount();
  });

  it('saves a typed http(s) URL as a pin after the last one', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const existing = makeCard('a', { order: 'a5' });
    const { view, upsertCard, onCardsChange, notify } = await mountPins([
      existing,
    ]);
    await submitUrl(view, '  https://news.example.org/today  ', notify);

    expect(upsertCard).toHaveBeenCalledTimes(1);
    const saved = nth(upsertCard.mock.calls)[0];
    expect(saved).toMatchObject({
      deckId: DEFAULT_DECK_ID,
      url: 'https://news.example.org/today',
      title: 'News',
      hostname: 'news.example.org',
      pinned: true,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      lastOpenedAt: null,
    });
    expect(compareOrder(saved.order, existing.order)).toBeGreaterThan(0);
    expect(onCardsChange).toHaveBeenCalledWith([existing, saved]);
    expect(view.query('.deck-pin-url-input')).toBeNull();
    view.unmount();
  });

  it('orders the first pin without a predecessor', async () => {
    const { view, upsertCard, notify } = await mountPins([]);
    await submitUrl(view, 'http://first.example.com', notify);
    expect(nth(upsertCard.mock.calls)[0].order).toEqual(expect.any(String));
    expect(nth(upsertCard.mock.calls)[0].url).toBe('http://first.example.com/');
    view.unmount();
  });

  it('accepts an optional label and opens a URL pasted outside inputs', async () => {
    const { view, upsertCard } = await mountPins([]);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => 'https://www.wikipedia.org/wiki/Deck' },
    });
    await view.act(() => {
      window.dispatchEvent(paste);
    });
    await vi.waitFor(async () => {
      await view.act(async () => {
        await vi.dynamicImportSettled();
      });
      expect(view.get<HTMLInputElement>('.deck-pin-url-input').value).toBe(
        'https://www.wikipedia.org/wiki/Deck',
      );
    });
    await view.act(() =>
      type(view.get<HTMLInputElement>('.deck-pin-label-input'), 'Wiki'),
    );
    await view.act(() => click(view.getByText(strings.addPin)));
    await vi.waitFor(() => expect(upsertCard).toHaveBeenCalledTimes(1));
    expect(upsertCard.mock.calls[0]?.[0]).toMatchObject({
      title: 'Wikipedia',
      pinLabel: 'Wiki',
      deckId: DEFAULT_DECK_ID,
    });
    view.unmount();
  });

  it.each(['not a url', 'ftp://files.example.com/x', ''])(
    'refuses %j with a visible error and saves nothing',
    async (value) => {
      const { view, upsertCard, notify } = await mountPins([]);
      await submitUrl(view, value, notify);
      expect(notify).toHaveBeenCalledWith({
        kind: 'error',
        text: strings.invalidUrl,
      });
      expect(upsertCard).not.toHaveBeenCalled();
      expect(view.query('.deck-pin-url-input')).not.toBeNull();
      view.unmount();
    },
  );
});

describe('Pins - menu', () => {
  it('edits the label inline and closes after saving', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 1);
    const card = makeCard('a');
    const { view, upsertCard, onCardsChange } = await mountPins([card]);
    await openMenu(view, 'Title a');
    expect(view.get('[data-deck="pin-menu"]').getAttribute('role')).toBe(
      'menu',
    );
    await view.act(() => click(view.getByText(strings.renamePin)));
    const input = view.get<HTMLInputElement>(
      `input[aria-label="${strings.renamePinPrompt}"]`,
    );
    expect(input.value).toBe('Title a');
    await view.act(() => type(input, 'Work mail'));
    await view.act(() => click(view.getByText(strings.savePin)));
    await vi.waitFor(() => expect(upsertCard).toHaveBeenCalledTimes(1));
    const renamed = { ...card, pinLabel: 'Work mail', updatedAt: NOW + 1 };
    expect(upsertCard).toHaveBeenCalledWith(renamed);
    expect(onCardsChange).toHaveBeenCalledWith([renamed]);
    view.unmount();
  });

  it('edits and clears the emoji inline', async () => {
    const { view, upsertCard } = await mountPins([
      makeCard('a', { pinIcon: '✉' }),
    ]);
    await openMenu(view, 'Title a');
    await view.act(() => click(view.getByText(strings.changePinIcon)));
    const input = view.get<HTMLInputElement>(
      `input[aria-label="${strings.iconPrompt}"]`,
    );
    expect(input.value).toBe('✉');
    await view.act(() => type(input, '🔥'));
    await view.act(() => click(view.getByText(strings.savePin)));
    await vi.waitFor(() => expect(upsertCard).toHaveBeenCalledTimes(1));
    expect(nth(upsertCard.mock.calls)[0].pinIcon).toBe('🔥');
    view.unmount();
  });

  it('unpins the card', async () => {
    const { view, upsertCard } = await mountPins([makeCard('a')]);
    await openMenu(view, 'Title a');
    await view.act(() => click(view.getByText(strings.unpin)));
    await vi.waitFor(async () => {
      await view.act(async () => {});
      expect(upsertCard).toHaveBeenCalledTimes(1);
    });
    expect(nth(upsertCard.mock.calls)[0]).toMatchObject({
      id: 'a',
      pinned: false,
    });
    view.unmount();
  });

  it('keeps the menu open and reports a failed write', async () => {
    const { view, upsertCard, notify } = await mountPins([makeCard('a')]);
    upsertCard.mockRejectedValueOnce(new Error('disk full'));
    await openMenu(view, 'Title a');
    await view.act(() => click(view.getByText(strings.unpin)));
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith({
        kind: 'error',
        text: `${strings.updateFailed} disk full`,
      }),
    );
    expect(view.query('[data-deck="pin-menu"]')).not.toBeNull();
    view.unmount();
  });

  it('anchors near the tile, handles arrow keys, and dismisses on Escape or outside press', async () => {
    const { view } = await mountPins([makeCard('a')]);
    const anchor = view.getByLabel('Title a');
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      left: window.innerWidth - 20,
      top: 100,
      bottom: 164,
    } as DOMRect);
    await openMenu(view, 'Title a');
    const menu = view.get('[data-deck="pin-menu"]');
    expect(
      Number.parseFloat((menu as HTMLElement).style.insetInlineStart),
    ).toBeLessThan(window.innerWidth - 20);
    const first = view.getByText(strings.renamePin).closest('button');
    if (!first) throw new Error('Missing first menu item');
    expect(document.activeElement).toBe(first);
    await view.act(() => {
      keyDown(first, 'ArrowDown');
    });
    expect(document.activeElement?.textContent).toBe(strings.changePinIcon);
    await view.act(() => {
      keyDown(menu, 'Escape');
    });
    expect(view.query('[data-deck="pin-menu"]')).toBeNull();
    expect(document.activeElement).toBe(anchor);
    await openMenu(view, 'Title a');
    await view.act(() => {
      window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(view.query('[data-deck="pin-menu"]')).toBeNull();
    view.unmount();
  });
});

it('moves focus with arrows, opens the keyboard menu, and unpins with Undo', async () => {
  const { view, upsertCard, offerUndo } = await mountPins([
    makeCard('a', { order: 'a1' }),
    makeCard('b', { order: 'a2' }),
  ]);
  const first = view.getByLabel('Title a');
  const second = view.getByLabel('Title b');
  first.focus();
  await view.act(() => {
    keyDown(first, 'ArrowRight');
  });
  expect(document.activeElement).toBe(second);
  await view.act(() => {
    keyDown(second, 'ContextMenu');
  });
  await vi.waitFor(() =>
    expect(view.query('[data-deck="pin-menu"]')).not.toBeNull(),
  );
  await view.act(() => {
    keyDown(view.get('[data-deck="pin-menu"]'), 'Escape');
  });
  await view.act(() => {
    keyDown(second, 'Delete');
  });
  await vi.waitFor(() => expect(upsertCard).toHaveBeenCalledTimes(1));
  expect(upsertCard.mock.calls[0]?.[0]).toMatchObject({
    id: 'b',
    pinned: false,
  });
  expect(offerUndo).toHaveBeenCalledTimes(1);
  const action = offerUndo.mock.calls[0]?.[0] as UndoAction;
  await upsertCard({ ...makeCard('b'), deckId: 'deck_user', pinned: false });
  await action.undo();
  expect(upsertCard.mock.calls.at(-1)?.[0]).toMatchObject({
    id: 'b',
    pinned: true,
    deckId: DEFAULT_DECK_ID,
  });
  view.unmount();
});

describe('Pins - reordering', () => {
  const first = makeCard('a', { order: 'a1' });
  const second = makeCard('b', { order: 'a2' });
  const third = makeCard('c', { order: 'a3' });

  it('moves a pin when another pin is dropped on it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 2);
    const { view, upsertCard, onCardsChange } = await mountPins([
      first,
      second,
      third,
    ]);
    await drop(view, {
      activeId: dragId('pin', 'c'),
      overId: dragId('pin', 'a'),
    });

    expect(upsertCard).toHaveBeenCalledTimes(1);
    const moved = nth(upsertCard.mock.calls)[0];
    expect(moved).toMatchObject({ id: 'c', updatedAt: NOW + 2 });
    expect(compareOrder(moved.order, first.order)).toBeLessThan(0);
    expect(onCardsChange).toHaveBeenCalledWith([first, second, moved]);
    view.unmount();
  });

  it('ignores drops that are not pin-on-pin or name an unknown pin', async () => {
    const { view, upsertCard } = await mountPins([first, second]);
    await drop(view, {
      activeId: dragId('card', 'a'),
      overId: dragId('pin', 'b'),
    });
    await drop(view, {
      activeId: dragId('pin', 'a'),
      overId: dragId('deck', 'b'),
    });
    await drop(view, { activeId: 'garbage', overId: 'garbage' });
    await drop(view, {
      activeId: dragId('pin', 'missing'),
      overId: dragId('pin', 'b'),
    });
    await view.act(() => {
      window.dispatchEvent(new Event(WORKSPACE_DROP_EVENT));
    });
    expect(upsertCard).not.toHaveBeenCalled();
    view.unmount();
  });

  it('stops listening for drops once unmounted', async () => {
    const { view, upsertCard } = await mountPins([first, second]);
    view.unmount();
    await drop(view, {
      activeId: dragId('pin', 'b'),
      overId: dragId('pin', 'a'),
    });
    expect(upsertCard).not.toHaveBeenCalled();
  });

  it.each([
    [new Error('disk full'), 'disk full'],
    ['quota', 'quota'],
  ])('reports a failed reorder save (%s)', async (failure, detail) => {
    const { view, upsertCard, notify } = await mountPins([first, second]);
    upsertCard.mockRejectedValueOnce(failure);
    await openAddForm(view);
    await drop(view, {
      activeId: dragId('pin', 'b'),
      overId: dragId('pin', 'a'),
    });
    expect(notify).toHaveBeenCalledWith({
      kind: 'error',
      text: `${strings.updateFailed} ${detail}`,
    });
    view.unmount();
  });
});
