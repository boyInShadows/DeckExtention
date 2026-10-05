// @vitest-environment happy-dom
import type { Card } from 'deck-schema';
import type * as DndCore from '@dnd-kit/core';
import type * as DndSortable from '@dnd-kit/sortable';
import type { ComponentChildren } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dragId } from '../drawer/dragIdentity';
import { compareOrder } from '../drawer/workspaceModel';
import { WORKSPACE_DROP_EVENT } from '../drawer/WorkspaceDnd';
import { strings } from '../i18n/strings';
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
    deckId: 'deck_001',
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

function fakeRepository() {
  const upsertCard = vi.fn((card: Card) => Promise.resolve(card));
  return {
    upsertCard,
    repository: { upsertCard } as unknown as DeckRepository,
  };
}

interface Mounted {
  view: RenderResult;
  upsertCard: ReturnType<typeof fakeRepository>['upsertCard'];
  onCardsChange: ReturnType<typeof vi.fn<(cards: Card[]) => void>>;
}

async function mountPins(cards: Card[]): Promise<Mounted> {
  const { upsertCard, repository } = fakeRepository();
  const onCardsChange = vi.fn<(cards: Card[]) => void>();
  const view = await render(
    <Pins
      cards={cards}
      defaultDeckId={DEFAULT_DECK_ID}
      repository={repository}
      onCardsChange={onCardsChange}
    />,
  );
  return { view, upsertCard, onCardsChange };
}

function pinLabels(view: RenderResult): string[] {
  return view
    .getAll('[data-deck="pin"]')
    .map((pin) => pin.getAttribute('aria-label') ?? '');
}

async function openAddForm(view: RenderResult): Promise<HTMLInputElement> {
  await view.act(() => click(view.getByLabel(strings.addPin)));
  return view.get<HTMLInputElement>('.deck-pin-url-input');
}

async function submitUrl(view: RenderResult, url: string): Promise<void> {
  const input = await openAddForm(view);
  await view.act(() => type(input, url));
  await view.act(() => {
    keyDown(view.get('.deck-pin-url-input'), 'Enter');
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
}

function stubPrompt() {
  const prompt = vi.fn<(message?: string, value?: string) => string | null>();
  vi.stubGlobal('prompt', prompt);
  return prompt;
}

async function drop(
  view: RenderResult,
  detail: { activeId: string; overId: string },
): Promise<void> {
  await view.act(() => {
    window.dispatchEvent(new CustomEvent(WORKSPACE_DROP_EVENT, { detail }));
  });
}

beforeEach(() => {
  dnd.isOver = false;
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
      )}&size=64`,
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

  it('hides the add button once the strip is full', async () => {
    const full = Array.from({ length: MAX_PINS }, (_, index) =>
      makeCard(`p${index}`, { order: `a${index}` }),
    );
    const { view } = await mountPins(full);
    expect(view.query('[data-deck="pin-add"]')).toBeNull();
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
    const { view, upsertCard, onCardsChange } = await mountPins([existing]);
    await submitUrl(view, '  https://news.example.org/today  ');

    expect(upsertCard).toHaveBeenCalledTimes(1);
    const saved = nth(upsertCard.mock.calls)[0];
    expect(saved).toMatchObject({
      deckId: DEFAULT_DECK_ID,
      url: 'https://news.example.org/today',
      title: 'news.example.org',
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
    const { view, upsertCard } = await mountPins([]);
    await submitUrl(view, 'http://first.example.com');
    expect(nth(upsertCard.mock.calls)[0].order).toEqual(expect.any(String));
    expect(nth(upsertCard.mock.calls)[0].url).toBe('http://first.example.com/');
    view.unmount();
  });

  it.each(['not a url', 'ftp://files.example.com/x', ''])(
    'refuses %j with a visible error and saves nothing',
    async (value) => {
      const { view, upsertCard } = await mountPins([]);
      await submitUrl(view, value);
      expect(view.get('[role="alert"]').textContent).toBe(strings.invalidUrl);
      expect(upsertCard).not.toHaveBeenCalled();
      expect(view.query('.deck-pin-url-input')).not.toBeNull();
      view.unmount();
    },
  );
});

describe('Pins - menu', () => {
  it('opens on right-click and renames the pin', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 1);
    const card = makeCard('a');
    const prompt = stubPrompt().mockReturnValue('Work mail');
    const { view, upsertCard, onCardsChange } = await mountPins([card]);
    await openMenu(view, 'Title a');
    expect(view.query('[data-deck="pin-menu"]')).not.toBeNull();

    await view.act(() => click(view.getByText(strings.renamePin)));
    await view.act(async () => {});
    expect(prompt).toHaveBeenCalledWith(strings.renamePinPrompt, 'Title a');
    const renamed = { ...card, pinLabel: 'Work mail', updatedAt: NOW + 1 };
    expect(upsertCard).toHaveBeenCalledWith(renamed);
    expect(onCardsChange).toHaveBeenCalledWith([renamed]);
    expect(view.query('[data-deck="pin-menu"]')).toBeNull();
    view.unmount();
  });

  it('prefills the prompts with the current label and icon', async () => {
    const prompt = stubPrompt().mockReturnValue(null);
    const { view, upsertCard } = await mountPins([
      makeCard('a', { pinLabel: 'Mail', pinIcon: '✉' }),
    ]);
    await openMenu(view, 'Mail');
    await view.act(() => click(view.getByText(strings.renamePin)));
    await view.act(() => click(view.getByText(strings.changePinIcon)));

    expect(prompt.mock.calls).toEqual([
      [strings.renamePinPrompt, 'Mail'],
      [strings.iconPrompt, '✉'],
    ]);
    expect(upsertCard).not.toHaveBeenCalled();
    expect(view.query('[data-deck="pin-menu"]')).not.toBeNull();
    view.unmount();
  });

  it('sets an emoji icon, and clears it back to the favicon when emptied', async () => {
    const prompt = stubPrompt().mockReturnValueOnce('🔥');
    const { view, upsertCard } = await mountPins([makeCard('a')]);
    await openMenu(view, 'Title a');
    await view.act(() => click(view.getByText(strings.changePinIcon)));
    expect(prompt).toHaveBeenCalledWith(strings.iconPrompt, '');
    expect(nth(upsertCard.mock.calls)[0].pinIcon).toBe('🔥');

    prompt.mockReturnValueOnce('');
    await openMenu(view, 'Title a');
    await view.act(() => click(view.getByText(strings.changePinIcon)));
    expect(nth(upsertCard.mock.calls, 1)[0].pinIcon).toBeUndefined();
    view.unmount();
  });

  it('unpins the card', async () => {
    const { view, upsertCard } = await mountPins([makeCard('a')]);
    await openMenu(view, 'Title a');
    await view.act(() => click(view.getByText(strings.unpin)));
    expect(nth(upsertCard.mock.calls)[0]).toMatchObject({
      id: 'a',
      pinned: false,
    });
    view.unmount();
  });
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
    const { view, upsertCard } = await mountPins([first, second]);
    upsertCard.mockRejectedValueOnce(failure);
    await openAddForm(view);
    await drop(view, {
      activeId: dragId('pin', 'b'),
      overId: dragId('pin', 'a'),
    });
    expect(view.get('[role="alert"]').textContent).toBe(
      `${strings.updateFailed} ${detail}`,
    );
    view.unmount();
  });
});
