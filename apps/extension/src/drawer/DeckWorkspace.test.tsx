// @vitest-environment happy-dom
import 'fake-indexeddb/auto';

import type * as DndSortable from '@dnd-kit/sortable';
import {
  SETTINGS_DEFAULTS,
  type Card,
  type Deck,
  type Page,
} from 'deck-schema';
import { deleteDB } from 'idb';
import type { ComponentChildren } from 'preact';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { panelStrings as strings } from '../i18n/panelStrings';
import { resolveKeymap } from '../keys/keymap';
import { DeckRepository } from '../storage/repository';
import type { UndoAction } from './UndoToast';
import {
  click,
  keyDown,
  render,
  type,
  type RenderResult,
} from '../testing/render';
import { DeckWorkspace } from './DeckWorkspace';
import { RECENT_TARGETS_KEY } from './inboxModel';

/*
 * dnd-kit is an external dependency, so Vitest loads it un-aliased against
 * real React, whose hooks cannot run under Preact (same approach as
 * Pins.test.tsx). Its sortable hook is replaced by a fake reporting the drag
 * state the test controls; drops themselves are workspaceDrop's concern.
 */
const dnd = vi.hoisted(() => ({
  draggingId: null as string | null,
  overId: null as string | null,
}));

vi.mock('@dnd-kit/sortable', async (importOriginal) => ({
  ...(await importOriginal<typeof DndSortable>()),
  SortableContext: ({ children }: { children: ComponentChildren }) => children,
  useSortable: ({ id }: { id: string }) => ({
    attributes: { 'aria-roledescription': 'sortable' },
    listeners: {},
    setNodeRef: () => undefined,
    transform: null,
    transition: undefined,
    isDragging: dnd.draggingId === id,
    isOver: dnd.overId === id,
  }),
}));

const NOW = 1_800_000_000_000;
const DATABASE_NAME = 'deck-workspace-test';
const KEYMAP = resolveKeymap([]);
const FAILURE = new Error('disk full');
const FAILED_MESSAGE = `${strings.updateFailed} ${FAILURE.message}`;

const PAGES: Page[] = [
  page('page_1', 'Work', 'a0'),
  page('page_2', 'Home', 'a1'),
];

const DECKS: Deck[] = [
  deck('deck_1', 'Reading', 'a0'),
  deck('deck_2', 'Later', 'a1', { note: 'Weekend', color: 'blue' }),
  deck('inbox_1', 'Inbox', 'a2', { kind: 'inbox' }),
  deck('deck_3', 'Elsewhere', 'a0', { pageId: 'page_2' }),
];

const CARDS: Card[] = [
  card('card_1', 'deck_1', 'a0', { note: 'remember' }),
  card('card_2', 'deck_1', 'a1', { done: true }),
];

function page(id: string, title: string, order: string): Page {
  return {
    id,
    title,
    order,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function deck(
  id: string,
  title: string,
  order: string,
  extra: Partial<Deck> = {},
): Deck {
  return {
    id,
    pageId: 'page_1',
    title,
    kind: 'normal',
    order,
    color: null,
    isCollapsed: false,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...extra,
  };
}

function card(
  id: string,
  deckId: string,
  order: string,
  extra: Partial<Card> = {},
): Card {
  return {
    id,
    deckId,
    url: `https://example.com/${id}`,
    title: `Title ${id}`,
    hostname: 'example.com',
    order,
    pinned: false,
    lastOpenedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...extra,
  };
}

interface MountOptions {
  decks?: Deck[];
  cards?: Card[];
  selectedPageId?: string | null;
  selectedDeckKind?: Deck['kind'] | undefined;
}

interface Mounted {
  view: RenderResult;
  onError: ReturnType<typeof vi.fn<(message: string) => void>>;
  onCardsChange: ReturnType<typeof vi.fn<(cards: Card[]) => void>>;
  onDecksChange: ReturnType<typeof vi.fn<(decks: Deck[]) => void>>;
  offerUndo: ReturnType<typeof vi.fn<(action: UndoAction) => void>>;
}

let repository: DeckRepository;

async function mount(options: MountOptions = {}): Promise<Mounted> {
  const decks = options.decks ?? DECKS;
  const cards = options.cards ?? CARDS;
  const onError = vi.fn<(message: string) => void>();
  const onCardsChange = vi.fn<(cards: Card[]) => void>();
  const onDecksChange = vi.fn<(decks: Deck[]) => void>();
  const offerUndo = vi.fn<(action: UndoAction) => void>();
  const data = {
    cards,
    decks,
    pages: PAGES,
    defaultDeckId: 'deck_1',
    settings: SETTINGS_DEFAULTS,
    repository,
  };
  function Host() {
    const [liveCards, setCards] = useState(cards);
    const [liveDecks, setDecks] = useState(decks);
    return (
      <DeckWorkspace
        isOpen
        keymap={KEYMAP}
        data={data}
        pages={PAGES}
        decks={liveDecks}
        cards={liveCards}
        selectedPageId={
          options.selectedPageId === undefined
            ? 'page_1'
            : options.selectedPageId
        }
        selectedDeckKind={
          'selectedDeckKind' in options ? options.selectedDeckKind : 'normal'
        }
        onCardsChange={(next) => {
          setCards(next);
          onCardsChange(next);
        }}
        onDecksChange={(next) => {
          setDecks(next);
          onDecksChange(next);
        }}
        onError={onError}
        offerUndo={offerUndo}
      />
    );
  }
  const view = await render(<Host />);
  return { view, onError, onCardsChange, onDecksChange, offerUndo };
}

async function seed() {
  for (const item of PAGES) await repository.upsertPage(item);
  for (const item of DECKS) await repository.upsertDeck(item);
  for (const item of CARDS) await repository.upsertCard(item);
}

/** Retries `assertion`, flushing Preact's renders before each attempt. */
async function eventually(view: RenderResult, assertion: () => unknown) {
  await vi.waitFor(async () => {
    await view.act(async () => {});
    await assertion();
  });
}

async function act(view: RenderResult, work: () => void) {
  await view.act(work);
}

function deckSection(view: RenderResult, id: string): HTMLElement {
  return view.get(`[data-deck="deck"][data-deck-id="${id}"]`);
}

function within(element: HTMLElement, label: string): HTMLElement {
  const found = [...element.querySelectorAll<HTMLElement>('*')].find(
    (child) =>
      child.getAttribute('aria-label') === label ||
      (child.children.length === 0 && child.textContent?.trim() === label),
  );
  if (!found) throw new Error(`No "${label}" inside element`);
  return found;
}

async function storedDeck(id: string): Promise<Deck | undefined> {
  return (await repository.listDecks()).find((item) => item.id === id);
}

async function storedCard(id: string): Promise<Card | undefined> {
  return (await repository.listCards()).find((item) => item.id === id);
}

beforeEach(async () => {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve()),
      },
    },
  });
  repository = new DeckRepository({ databaseName: DATABASE_NAME });
  await seed();
  localStorage.clear();
  sessionStorage.clear();
  dnd.draggingId = null;
  dnd.overId = null;
});

afterEach(async () => {
  await repository.close();
  await deleteDB(DATABASE_NAME);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('DeckWorkspace - layout', () => {
  it('asks for a page when none is selected', async () => {
    const { view } = await mount({ selectedPageId: null });
    expect(view.container.textContent).toBe(strings.selectPage);
    expect(view.query('[data-deck="decks"]')).toBeNull();
    view.unmount();
  });

  it('shows the page’s normal decks in order with their cards, counts and notes', async () => {
    const { view } = await mount();
    const titles = view
      .getAll('[data-deck="deck"] .deck-column__title')
      .map((element) => element.textContent);
    expect(titles).toEqual(['Reading', 'Later']);

    const reading = deckSection(view, 'deck_1');
    expect(reading.querySelector('small')?.textContent).toBe('2');
    expect(
      [...reading.querySelectorAll('[data-deck="card"]')].map(
        (element) => (element as HTMLElement).dataset.cardId,
      ),
    ).toEqual(['card_1', 'card_2']);
    expect(view.get('[data-card-id="card_2"]').dataset.done).toBe('true');
    expect(
      view.get('[data-card-id="card_1"] img').getAttribute('src'),
    ).toContain(encodeURIComponent('https://example.com/card_1'));
    expect(
      within(view.get('[data-card-id="card_1"]'), strings.editNote)
        .querySelector('svg')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(
      within(view.get('[data-card-id="card_2"]'), strings.editNote)
        .querySelector('svg')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');

    const later = deckSection(view, 'deck_2');
    expect(later.dataset.color).toBe('blue');
    expect(
      later.querySelector('[data-deck="deck-note"] .deck-markdown')
        ?.textContent,
    ).toBe('Weekend');
    expect(later.textContent).toContain(strings.emptyDeck);
    view.unmount();
  });

  it('marks the dragged item and the one it is over', async () => {
    dnd.draggingId = 'card:card_1';
    dnd.overId = 'deck:deck_2';
    const { view } = await mount();
    expect(view.get('[data-card-id="card_1"]').dataset.dragging).toBe('true');
    expect(
      view.get('[data-card-id="card_2"]').dataset.dragging,
    ).toBeUndefined();
    expect(deckSection(view, 'deck_2').dataset.dragOver).toBe('true');
    expect(deckSection(view, 'deck_1').dataset.dragOver).toBeUndefined();
    view.unmount();
  });

  it('hides a collapsed deck’s cards and shows the expand glyph', async () => {
    const decks = DECKS.map((item) =>
      item.id === 'deck_1' ? { ...item, isCollapsed: true } : item,
    );
    const { view } = await mount({ decks });
    const reading = deckSection(view, 'deck_1');
    expect(within(reading, strings.expandDeck).textContent).toBe('›');
    expect(reading.querySelector('[data-deck="card"]')).toBeNull();
    expect(reading.querySelector('[data-deck="add-card"]')).toBeNull();
    view.unmount();
  });
});

describe('DeckWorkspace - decks', () => {
  it('adds a deck at the end of the page', async () => {
    const { view, onDecksChange } = await mount();
    await act(view, () => click(view.get('[data-deck="deck-add"]')));
    await eventually(view, () => expect(onDecksChange).toHaveBeenCalled());
    const added = onDecksChange.mock.calls[0]?.[0].at(-1);
    expect(added).toMatchObject({
      pageId: 'page_1',
      title: strings.newDeck,
      kind: 'normal',
    });
    expect(added && (await storedDeck(added.id))).toEqual(added);
    await eventually(view, () =>
      expect(view.getAll('[data-deck="deck"]')).toHaveLength(3),
    );
    expect(document.activeElement).toBe(
      view.getByLabel(strings.renameDeckPrompt),
    );
    view.unmount();
  });

  it('adds the first deck to an empty page', async () => {
    const { view, onDecksChange } = await mount({ decks: [], cards: [] });
    await act(view, () => click(view.get('[data-deck="deck-add"]')));
    await eventually(view, () =>
      expect(view.getAll('[data-deck="deck"]')).toHaveLength(1),
    );
    const [added] = onDecksChange.mock.calls[0]?.[0] ?? [];
    expect(added?.order).toEqual(expect.any(String));
    expect(added && (await storedDeck(added.id))).toEqual(added);
    view.unmount();
  });

  it('reports a non-Error rejection as text', async () => {
    vi.spyOn(repository, 'upsertDeck').mockRejectedValue('quota');
    const { view, onError } = await mount();
    await act(view, () => click(view.get('[data-deck="deck-add"]')));
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(`${strings.updateFailed} quota`),
    );
    view.unmount();
  });

  it('reports a deck the repository could not add', async () => {
    vi.spyOn(repository, 'upsertDeck').mockRejectedValue(FAILURE);
    const { view, onError, onDecksChange } = await mount();
    await act(view, () => click(view.get('[data-deck="deck-add"]')));
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(FAILED_MESSAGE),
    );
    expect(onDecksChange).not.toHaveBeenCalled();
    view.unmount();
  });

  it('collapses a deck and stores it', async () => {
    const { view } = await mount();
    const reading = deckSection(view, 'deck_1');
    await act(view, () => click(within(reading, strings.collapseDeck)));
    await eventually(view, async () =>
      expect((await storedDeck('deck_1'))?.isCollapsed).toBe(true),
    );
    await eventually(view, () =>
      expect(
        deckSection(view, 'deck_1').querySelector('[data-deck="card"]'),
      ).toBeNull(),
    );
    view.unmount();
  });

  it('reports a deck change the repository refuses', async () => {
    vi.spyOn(repository, 'upsertDeck').mockRejectedValue(FAILURE);
    const { view, onError } = await mount();
    await act(view, () =>
      click(within(deckSection(view, 'deck_1'), strings.collapseDeck)),
    );
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(FAILED_MESSAGE),
    );
    expect(
      within(deckSection(view, 'deck_1'), strings.collapseDeck).textContent,
    ).toBe('⌄');
    view.unmount();
  });

  it('renames inline, cancels with Escape and keeps the old title for empty input', async () => {
    const prompt = vi.fn();
    vi.stubGlobal('prompt', prompt);
    const { view, onDecksChange } = await mount();
    const title = () =>
      view.get<HTMLElement>('[data-deck-id="deck_1"] .deck-column__title');
    await act(view, () => click(title()));
    let input = view.getByLabel<HTMLInputElement>(strings.renameDeckPrompt);
    await act(view, () => type(input, 'Discard'));
    await act(view, () => keyDown(input, 'Escape'));
    expect(title().textContent).toBe('Reading');
    expect(onDecksChange).not.toHaveBeenCalled();
    await act(view, () => click(title()));
    input = view.getByLabel<HTMLInputElement>(strings.renameDeckPrompt);
    await act(view, () => type(input, '   '));
    await act(view, () => keyDown(input, 'Enter'));
    expect(title().textContent).toBe('Reading');
    await act(view, () => click(title()));
    input = view.getByLabel<HTMLInputElement>(strings.renameDeckPrompt);
    await act(view, () => type(input, 'Papers'));
    await act(view, () => keyDown(input, 'Enter'));
    await eventually(view, () => expect(title().textContent).toBe('Papers'));
    expect((await storedDeck('deck_1'))?.title).toBe('Papers');
    expect(prompt).not.toHaveBeenCalled();
    view.unmount();
  });

  it('opens deck rename with F2 and the Open all explanation with n', async () => {
    const { view } = await mount();
    const reading = deckSection(view, 'deck_1');
    reading.focus();
    await act(view, () => keyDown(reading, 'F2'));
    expect(
      view.getByLabel<HTMLInputElement>(strings.renameDeckPrompt).value,
    ).toBe('Reading');
    await act(view, () =>
      keyDown(view.getByLabel(strings.renameDeckPrompt), 'Escape'),
    );
    reading.focus();
    await act(view, () => keyDown(reading, 'n'));
    expect(reading.textContent).toContain(strings.accessTabsReason);
    view.unmount();
  });
});

describe('DeckWorkspace - deck menu', () => {
  async function openMenu(view: RenderResult, deckId: string) {
    const section = deckSection(view, deckId);
    await act(view, () => click(within(section, strings.deckMenu)));
    return view.get(`[data-deck-id="${deckId}"] [role="menu"]`);
  }

  it('toggles open and closed from the ••• button', async () => {
    const { view } = await mount();
    await openMenu(view, 'deck_1');
    await act(view, () =>
      click(within(deckSection(view, 'deck_1'), strings.deckMenu)),
    );
    expect(view.query('[role="menu"]')).toBeNull();
    view.unmount();
  });

  it('closes on Escape and outside pointer press', async () => {
    const { view } = await mount();
    const menu = await openMenu(view, 'deck_1');
    await act(view, () => keyDown(menu, 'Escape'));
    expect(view.query('[data-deck="deck-menu"]')).toBeNull();
    await openMenu(view, 'deck_1');
    await act(view, () =>
      document.body.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true }),
      ),
    );
    expect(view.query('[data-deck="deck-menu"]')).toBeNull();
    view.unmount();
  });

  it('renames from the menu', async () => {
    const { view } = await mount();
    const menu = await openMenu(view, 'deck_1');
    await act(view, () => click(within(menu, strings.renameDeck)));
    const input = view.getByLabel<HTMLInputElement>(strings.renameDeckPrompt);
    await act(view, () => type(input, 'Papers'));
    await act(view, () => keyDown(input, 'Enter'));
    await eventually(view, async () =>
      expect((await storedDeck('deck_1'))?.title).toBe('Papers'),
    );
    view.unmount();
  });

  it('sets and clears the deck colour', async () => {
    const { view } = await mount();
    let menu = await openMenu(view, 'deck_1');
    await act(view, () => click(within(menu, strings.deckColor)));
    await act(view, () => click(within(menu, 'rose')));
    await eventually(view, async () =>
      expect((await storedDeck('deck_1'))?.color).toBe('rose'),
    );
    menu = await openMenu(view, 'deck_1');
    await act(view, () => click(within(menu, strings.deckColor)));
    await act(view, () => click(within(menu, strings.defaultColor)));
    await eventually(view, async () =>
      expect((await storedDeck('deck_1'))?.color).toBeNull(),
    );
    view.unmount();
  });

  it('moves the deck to another live page', async () => {
    const { view, offerUndo } = await mount();
    const menu = await openMenu(view, 'deck_1');
    await act(view, () => click(within(menu, strings.moveToPage)));
    expect(menu.textContent).toContain('Home');
    await act(view, () => click(within(menu, 'Home')));
    await eventually(view, async () =>
      expect((await storedDeck('deck_1'))?.pageId).toBe('page_2'),
    );
    await eventually(view, () =>
      expect(view.query('[data-deck-id="deck_1"]')).toBeNull(),
    );
    const action = offerUndo.mock.calls[0]?.[0];
    if (!action) throw new Error('Missing deck move Undo action');
    await view.act(async () => action.undo());
    expect((await storedDeck('deck_1'))?.pageId).toBe('page_1');
    view.unmount();
  });

  it('trashes a normal deck', async () => {
    const { view, onDecksChange } = await mount();
    const menu = await openMenu(view, 'deck_2');
    await act(view, () => click(within(menu, strings.trashDeck)));
    await eventually(view, async () =>
      expect((await storedDeck('deck_2'))?.deletedAt).toEqual(
        expect.any(Number),
      ),
    );
    await eventually(view, () =>
      expect(onDecksChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'deck_2',
            deletedAt: expect.any(Number),
          }),
        ]),
      ),
    );
    view.unmount();
  });

  it('trashes a deck and its cards without orphaning them', async () => {
    const { view } = await mount();
    const menu = await openMenu(view, 'deck_1');
    await act(view, () => click(within(menu, strings.trashDeck)));
    await eventually(view, async () => {
      expect((await storedDeck('deck_1'))?.deletedAt).toEqual(
        expect.any(Number),
      );
      expect((await storedCard('card_1'))?.deletedAt).toEqual(
        expect.any(Number),
      );
      expect((await storedCard('card_2'))?.deletedAt).toEqual(
        expect.any(Number),
      );
    });
    view.unmount();
  });

  it('reports a deck trash the repository refuses', async () => {
    vi.spyOn(repository, 'trashDeck').mockRejectedValue(FAILURE);
    const { view, onError } = await mount();
    const menu = await openMenu(view, 'deck_2');
    await act(view, () => click(within(menu, strings.trashDeck)));
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(FAILED_MESSAGE),
    );
    expect(view.query('[data-deck-id="deck_2"]')).not.toBeNull();
    view.unmount();
  });

  it('offers no trash for the Inbox deck', async () => {
    const { view } = await mount({ selectedDeckKind: undefined });
    const menu = await openMenu(view, 'inbox_1');
    expect(menu.textContent).not.toContain(strings.trashDeck);
    view.unmount();
  });
});

describe('DeckWorkspace - open all', () => {
  function stubChrome(request: () => Promise<boolean>) {
    const create = vi.fn(() => Promise.resolve({}));
    vi.stubGlobal('chrome', {
      permissions: {
        contains: vi.fn(() => Promise.resolve(false)),
        request: vi.fn(request),
      },
      tabs: { create },
      storage: {
        local: {
          get: vi.fn(() => Promise.resolve({})),
          set: vi.fn(() => Promise.resolve()),
        },
      },
    });
    return create;
  }

  async function openAll(view: RenderResult) {
    const section = deckSection(view, 'deck_1');
    await act(view, () => click(within(section, strings.deckMenu)));
    await act(view, () => click(within(section, strings.openAll)));
    expect(within(section, strings.accessTabsReason)).toBeTruthy();
    await act(view, () => click(within(section, strings.allowAccess)));
  }

  it('opens cards in order with the first tab active once tabs access is granted', async () => {
    const create = stubChrome(() => Promise.resolve(true));
    const { view } = await mount();
    await openAll(view);
    await eventually(view, () => expect(create).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenCalledWith({
      url: 'https://example.com/card_1',
      active: true,
    });
    expect((await storedCard('card_1'))?.lastOpenedAt).toEqual(
      expect.any(Number),
    );
    view.unmount();
  });

  it('explains a declined permission and opens nothing', async () => {
    const create = stubChrome(() => Promise.resolve(false));
    const { view, onError } = await mount();
    await openAll(view);
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(strings.tabsPermissionDeclined),
    );
    expect(create).not.toHaveBeenCalled();
    const section = deckSection(view, 'deck_1');
    await act(view, () => click(within(section, strings.allowAccess)));
    expect(chrome.permissions.request).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('reports a permission request that fails', async () => {
    stubChrome(() => Promise.reject(FAILURE));
    const { view, onError } = await mount();
    await openAll(view);
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(FAILED_MESSAGE),
    );
    view.unmount();
  });
});

describe('DeckWorkspace - adding links', () => {
  async function submitUrl(view: RenderResult, value: string) {
    const section = deckSection(view, 'deck_2');
    await act(view, () => click(within(section, `+ ${strings.addCard}`)));
    const input = view.getByLabel<HTMLInputElement>(strings.pasteUrl);
    expect(document.activeElement).toBe(input);
    await act(view, () => type(input, value));
    await act(view, () => {
      input.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
  }

  it('adds a pasted URL to the deck and closes the field', async () => {
    const { view, onCardsChange } = await mount();
    await submitUrl(view, 'news.example.org/today');
    await eventually(view, () =>
      expect(
        deckSection(view, 'deck_2').querySelectorAll('[data-deck="card"]'),
      ).toHaveLength(1),
    );
    const added = onCardsChange.mock.calls[0]?.[0].at(-1);
    expect(added).toMatchObject({
      deckId: 'deck_2',
      url: 'https://news.example.org/today',
      hostname: 'news.example.org',
    });
    expect(added && (await storedCard(added.id))).toEqual(added);
    expect(view.query(`[aria-label="${strings.pasteUrl}"]`)).toBeNull();
    view.unmount();
  });

  it('rejects something that is not a web URL', async () => {
    const { view, onError, onCardsChange } = await mount();
    await submitUrl(view, 'javascript:alert(1)');
    expect(onError).toHaveBeenCalledWith(strings.invalidUrl);
    expect(onCardsChange).not.toHaveBeenCalled();
    view.unmount();
  });

  it('keeps the typed URL when the repository refuses it', async () => {
    vi.spyOn(repository, 'upsertCard').mockRejectedValue(FAILURE);
    const { view, onError } = await mount();
    await submitUrl(view, 'https://example.net');
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(FAILED_MESSAGE),
    );
    expect(view.getByLabel<HTMLInputElement>(strings.pasteUrl).value).toBe(
      'https://example.net',
    );
    view.unmount();
  });
});

describe('DeckWorkspace - card actions', () => {
  it('edits title and URL from the row and rejects a non-web URL', async () => {
    const { view, onError } = await mount();
    const row = view.get('[data-card-id="card_1"]');
    row.focus();
    await act(view, () => keyDown(row, 'e'));
    const title = view.getByLabel<HTMLInputElement>(strings.cardTitle);
    const url = view.getByLabel<HTMLInputElement>(strings.cardUrl);
    await act(view, () => type(title, 'Updated title'));
    await act(view, () => type(url, 'javascript:alert(1)'));
    await act(view, () =>
      url.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      ),
    );
    expect(onError).toHaveBeenCalledWith(strings.invalidUrl);
    expect((await storedCard('card_1'))?.url).toBe(
      'https://example.com/card_1',
    );
    await act(view, () => type(url, 'new.example/path'));
    await act(view, () =>
      url.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      ),
    );
    await eventually(view, async () =>
      expect(await storedCard('card_1')).toMatchObject({
        title: 'Updated title',
        url: 'https://new.example/path',
        hostname: 'new.example',
      }),
    );
    view.unmount();
  });

  it('moves completed cards to the bottom and shows the all-done footer', async () => {
    const { view } = await mount({
      cards: [
        card('card_1', 'deck_1', 'a0', { done: true }),
        card('card_2', 'deck_1', 'a1'),
      ],
    });
    const ids = () =>
      [
        ...deckSection(view, 'deck_1').querySelectorAll<HTMLElement>(
          '[data-deck="card"]',
        ),
      ].map((row) => row.dataset.cardId);
    expect(ids()).toEqual(['card_2', 'card_1']);
    const row = view.get('[data-card-id="card_2"]');
    row.focus();
    await act(view, () => keyDown(row, 'd'));
    await eventually(view, () =>
      expect(deckSection(view, 'deck_1').textContent).toContain(
        strings.allDone,
      ),
    );
    view.unmount();
  });

  it('offers edit, pin, and incognito from the card menu', async () => {
    const create = vi.fn(() => Promise.resolve({ id: 7, incognito: true }));
    vi.stubGlobal('chrome', {
      extension: {
        isAllowedIncognitoAccess: vi.fn(() => Promise.resolve(true)),
      },
      windows: { create },
    });
    const { view } = await mount();
    const row = view.get('[data-card-id="card_1"]');
    await act(view, () => click(within(row, strings.cardMenu)));
    await act(view, () =>
      click(within(view.get('[data-deck="card-menu"]'), strings.openIncognito)),
    );
    expect(create).toHaveBeenCalledWith({
      url: 'https://example.com/card_1',
      incognito: true,
    });
    await act(view, () => click(within(row, strings.cardMenu)));
    await act(view, () =>
      click(within(view.get('[data-deck="card-menu"]'), strings.pinCard)),
    );
    await eventually(view, async () =>
      expect((await storedCard('card_1'))?.pinned).toBe(true),
    );
    view.unmount();
  });

  it('explains when Chrome has not allowed Incognito access', async () => {
    const create = vi.fn();
    vi.stubGlobal('chrome', {
      extension: {
        isAllowedIncognitoAccess: vi.fn(() => Promise.resolve(false)),
      },
      windows: { create },
    });
    const { view, onError } = await mount();
    await act(view, () =>
      click(within(view.get('[data-card-id="card_1"]'), strings.cardMenu)),
    );
    await act(view, () =>
      click(within(view.get('[data-deck="card-menu"]'), strings.openIncognito)),
    );
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(strings.incognitoUnavailable),
    );
    expect(create).not.toHaveBeenCalled();
    view.unmount();
  });

  it('reports Chrome returning no private window', async () => {
    vi.stubGlobal('chrome', {
      extension: {
        isAllowedIncognitoAccess: vi.fn(() => Promise.resolve(true)),
      },
      windows: { create: vi.fn(() => Promise.resolve(undefined)) },
    });
    const { view, onError } = await mount();
    await act(view, () =>
      click(within(view.get('[data-card-id="card_1"]'), strings.cardMenu)),
    );
    await act(view, () =>
      click(within(view.get('[data-deck="card-menu"]'), strings.openIncognito)),
    );
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(strings.incognitoUnavailable),
    );
    view.unmount();
  });
  it('stamps a card opened from its title', async () => {
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined);
    const { view, onCardsChange } = await mount();
    await act(view, () => click(view.get('[data-card-id="card_1"] a')));
    await eventually(view, () =>
      expect(assign).toHaveBeenCalledWith('https://example.com/card_1'),
    );
    expect((await storedCard('card_1'))?.lastOpenedAt).toEqual(
      expect.any(Number),
    );
    expect(onCardsChange).toHaveBeenCalled();
    view.unmount();
  });
  it('toggles a card done and stores it', async () => {
    const { view } = await mount();
    const row = view.get('[data-card-id="card_1"]');
    await act(view, () => click(within(row, strings.markDone)));
    await eventually(view, async () =>
      expect((await storedCard('card_1'))?.done).toBe(true),
    );
    await eventually(view, () =>
      expect(view.get('[data-card-id="card_1"]').dataset.done).toBe('true'),
    );
    view.unmount();
  });

  it('reports a card update the repository refuses', async () => {
    vi.spyOn(repository, 'upsertCard').mockRejectedValue(FAILURE);
    const { view, onError } = await mount();
    const row = view.get('[data-card-id="card_1"]');
    await act(view, () => click(within(row, strings.markDone)));
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(FAILED_MESSAGE),
    );
    view.unmount();
  });

  it('trashes a card from its row', async () => {
    const { view } = await mount();
    const row = view.get('[data-card-id="card_1"]');
    await act(view, () => click(within(row, strings.trashCard)));
    await eventually(view, () =>
      expect(view.query('[data-card-id="card_1"]')).toBeNull(),
    );
    expect((await storedCard('card_1'))?.deletedAt).toEqual(expect.any(Number));
    view.unmount();
  });

  it('keeps a card the repository refuses to trash', async () => {
    vi.spyOn(repository, 'softDelete').mockRejectedValue(FAILURE);
    const { view, onError } = await mount();
    const row = view.get('[data-card-id="card_1"]');
    await act(view, () => click(within(row, strings.trashCard)));
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(FAILED_MESSAGE),
    );
    expect(view.query('[data-card-id="card_1"]')).not.toBeNull();
    view.unmount();
  });
});

describe('DeckWorkspace - notes', () => {
  it('saves a card note, and returns focus to the card on close', async () => {
    const { view, onCardsChange } = await mount();
    await act(view, () =>
      click(within(view.get('[data-card-id="card_2"]'), strings.editNote)),
    );
    const textarea = view.get<HTMLTextAreaElement>(
      '[data-deck="note"] textarea',
    );
    await act(view, () => type(textarea, 'Read twice'));
    await act(view, () => click(view.getByText(strings.saveNote)));
    await eventually(view, () =>
      expect(onCardsChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'card_2', note: 'Read twice' }),
        ]),
      ),
    );
    expect((await storedCard('card_2'))?.note).toBe('Read twice');
    expect(
      within(view.get('[data-card-id="card_2"]'), strings.editNote)
        .querySelector('svg')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');

    await act(view, () => click(view.getByText(strings.close)));
    await eventually(view, () =>
      expect(view.query('[data-deck="note"]')).toBeNull(),
    );
    await eventually(view, () =>
      expect(document.activeElement).toBe(view.get('[data-card-id="card_2"]')),
    );
    view.unmount();
  });

  it('saves a deck note opened from the note itself and from the menu', async () => {
    const { view, onDecksChange } = await mount();
    await act(view, () => click(view.get('[data-deck="deck-note"] button')));
    const textarea = view.get<HTMLTextAreaElement>(
      '[data-deck="note"] textarea',
    );
    expect(textarea.value).toBe('Weekend');
    await act(view, () => type(textarea, 'Sunday'));
    await act(view, () => click(view.getByText(strings.saveNote)));
    await eventually(view, () =>
      expect(
        view.get('[data-deck="deck-note"] .deck-markdown').textContent,
      ).toBe('Sunday'),
    );
    expect(onDecksChange).toHaveBeenCalled();
    expect((await storedDeck('deck_2'))?.note).toBe('Sunday');
    await act(view, () => click(view.getByText(strings.close)));
    await eventually(view, () =>
      expect(view.query('[data-deck="note"]')).toBeNull(),
    );

    const section = deckSection(view, 'deck_1');
    await act(view, () => click(within(section, strings.deckMenu)));
    await act(view, () => click(within(section, strings.editDeckNote)));
    expect(
      view.get<HTMLTextAreaElement>('[data-deck="note"] textarea').value,
    ).toBe('');
    view.unmount();
  });

  it('keeps grid keys quiet while a note is open', async () => {
    const { view } = await mount();
    await act(view, () => click(view.get('[data-deck="deck-note"] button')));
    const event = keyDown(document.body, 'j');
    expect(event.defaultPrevented).toBe(false);
    view.unmount();
  });
});

describe('DeckWorkspace - move to', () => {
  async function openMoveLine(view: RenderResult) {
    const row = view.get('[data-card-id="card_1"]');
    row.focus();
    await act(view, () => {
      keyDown(row, 'm');
    });
    return view.getByLabel<HTMLInputElement>(strings.moveTo);
  }

  it('moves the focused card to the chosen deck and remembers it', async () => {
    const { view } = await mount();
    const input = await openMoveLine(view);
    expect(document.activeElement).toBe(input);
    await act(view, () => type(input, 'Later'));
    await act(view, () => {
      keyDown(input, 'Enter');
    });
    await eventually(view, async () =>
      expect((await storedCard('card_1'))?.deckId).toBe('deck_2'),
    );
    await eventually(view, () =>
      expect(
        deckSection(view, 'deck_2').querySelector('[data-card-id="card_1"]'),
      ).not.toBeNull(),
    );
    expect(view.query('[data-deck="move-line"]')).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(RECENT_TARGETS_KEY) ?? '[]'),
    ).toEqual(['deck_2']);
    await eventually(view, () =>
      expect(document.activeElement).toBe(view.get('[data-card-id="card_1"]')),
    );
    view.unmount();
  });

  it('cancels with Escape and puts focus back on the card', async () => {
    const { view } = await mount();
    const input = await openMoveLine(view);
    await act(view, () => {
      keyDown(input, 'Escape');
    });
    expect(view.query('[data-deck="move-line"]')).toBeNull();
    await eventually(view, () =>
      expect(document.activeElement).toBe(view.get('[data-card-id="card_1"]')),
    );
    expect((await storedCard('card_1'))?.deckId).toBe('deck_1');
    view.unmount();
  });

  it('reports a move the repository refuses', async () => {
    vi.spyOn(repository, 'upsertCard').mockRejectedValue(FAILURE);
    const { view, onError } = await mount();
    const input = await openMoveLine(view);
    await act(view, () => type(input, 'Later'));
    await act(view, () => {
      keyDown(input, 'Enter');
    });
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(FAILED_MESSAGE),
    );
    expect(
      deckSection(view, 'deck_1').querySelector('[data-card-id="card_1"]'),
    ).not.toBeNull();
    view.unmount();
  });

  it('reports a failed card key action with the update-failed prefix', async () => {
    const assign = vi.spyOn(location, 'assign').mockImplementation(() => {});
    const unsafe = card('card_9', 'deck_1', 'a2', { url: 'ftp://example.com' });
    const { view, onError } = await mount({ cards: [...CARDS, unsafe] });
    const row = view.get('[data-card-id="card_9"]');
    row.focus();
    await act(view, () => {
      keyDown(row, 'Enter');
    });
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(
        `${strings.updateFailed} ${strings.invalidUrl}`,
      ),
    );
    expect(assign).not.toHaveBeenCalled();
    view.unmount();
  });
});
