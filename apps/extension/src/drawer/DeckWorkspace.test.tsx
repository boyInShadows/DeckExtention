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
}

let repository: DeckRepository;

async function mount(options: MountOptions = {}): Promise<Mounted> {
  const decks = options.decks ?? DECKS;
  const cards = options.cards ?? CARDS;
  const onError = vi.fn<(message: string) => void>();
  const onCardsChange = vi.fn<(cards: Card[]) => void>();
  const onDecksChange = vi.fn<(decks: Deck[]) => void>();
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
      />
    );
  }
  const view = await render(<Host />);
  return { view, onError, onCardsChange, onDecksChange };
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

function changeSelect(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(async () => {
  repository = new DeckRepository({ databaseName: DATABASE_NAME });
  await seed();
  localStorage.clear();
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
      within(view.get('[data-card-id="card_1"]'), strings.editNote).textContent,
    ).toBe('●');
    expect(
      within(view.get('[data-card-id="card_2"]'), strings.editNote).textContent,
    ).toBe('✎');

    const later = deckSection(view, 'deck_2');
    expect(later.dataset.color).toBe('blue');
    expect(later.querySelector('[data-deck="deck-note"]')?.textContent).toBe(
      'Weekend',
    );
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
    expect(within(reading, strings.collapseDeck).textContent).toBe('›');
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

  it('renames a deck on double-click, ignoring a cancelled or unchanged name', async () => {
    const prompt = vi.fn<(message: string, value: string) => string | null>();
    vi.stubGlobal('prompt', prompt);
    const { view, onDecksChange } = await mount();
    const title = () =>
      deckSection(view, 'deck_1').querySelector<HTMLElement>(
        '.deck-column__title',
      );
    const doubleClick = () =>
      title()?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    prompt.mockReturnValueOnce(null).mockReturnValueOnce(' Reading ');
    await act(view, doubleClick);
    await act(view, doubleClick);
    expect(prompt).toHaveBeenCalledWith(strings.renameDeckPrompt, 'Reading');
    expect(onDecksChange).not.toHaveBeenCalled();

    prompt.mockReturnValueOnce('  Papers ');
    await act(view, doubleClick);
    await eventually(view, () => expect(title()?.textContent).toBe('Papers'));
    expect((await storedDeck('deck_1'))?.title).toBe('Papers');
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

  it('renames from the menu', async () => {
    vi.stubGlobal(
      'prompt',
      vi.fn(() => 'Papers'),
    );
    const { view } = await mount();
    const menu = await openMenu(view, 'deck_1');
    await act(view, () => click(within(menu, strings.renameDeck)));
    await eventually(view, async () =>
      expect((await storedDeck('deck_1'))?.title).toBe('Papers'),
    );
    view.unmount();
  });

  it('sets and clears the deck colour', async () => {
    const { view } = await mount();
    const menu = await openMenu(view, 'deck_1');
    const [colour] = [...menu.querySelectorAll('select')];
    if (!colour) throw new Error('colour select missing');
    await act(view, () => changeSelect(colour, 'rose'));
    await eventually(view, async () =>
      expect((await storedDeck('deck_1'))?.color).toBe('rose'),
    );
    await act(view, () => changeSelect(colour, ''));
    await eventually(view, async () =>
      expect((await storedDeck('deck_1'))?.color).toBeNull(),
    );
    view.unmount();
  });

  it('moves the deck to another live page', async () => {
    const { view } = await mount();
    const menu = await openMenu(view, 'deck_1');
    const page = menu.querySelectorAll('select')[1];
    if (!page) throw new Error('page select missing');
    expect([...page.options].map((option) => option.value)).toEqual([
      'page_1',
      'page_2',
    ]);
    await act(view, () => changeSelect(page, 'page_2'));
    await eventually(view, async () =>
      expect((await storedDeck('deck_1'))?.pageId).toBe('page_2'),
    );
    await eventually(view, () =>
      expect(view.query('[data-deck-id="deck_1"]')).toBeNull(),
    );
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
        DECKS.filter(({ id }) => id !== 'deck_2'),
      ),
    );
    view.unmount();
  });

  it('reports a deck trash the repository refuses', async () => {
    vi.spyOn(repository, 'softDelete').mockRejectedValue(FAILURE);
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
      permissions: { request: vi.fn(request) },
      tabs: { create },
    });
    return create;
  }

  async function openAll(view: RenderResult) {
    const section = deckSection(view, 'deck_1');
    await act(view, () => click(within(section, strings.deckMenu)));
    await act(view, () => click(within(section, strings.openAll)));
  }

  it('opens every card in a background tab once tabs access is granted', async () => {
    const create = stubChrome(() => Promise.resolve(true));
    const { view } = await mount();
    await openAll(view);
    await eventually(view, () => expect(create).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenCalledWith({
      url: 'https://example.com/card_1',
      active: false,
    });
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
      within(view.get('[data-card-id="card_2"]'), strings.editNote).textContent,
    ).toBe('●');

    await act(view, () => click(view.getByText(strings.close)));
    expect(view.query('[data-deck="note"]')).toBeNull();
    await eventually(view, () =>
      expect(document.activeElement).toBe(view.get('[data-card-id="card_2"]')),
    );
    view.unmount();
  });

  it('saves a deck note opened from the note itself and from the menu', async () => {
    const { view, onDecksChange } = await mount();
    await act(view, () => click(view.get('[data-deck="deck-note"]')));
    const textarea = view.get<HTMLTextAreaElement>(
      '[data-deck="note"] textarea',
    );
    expect(textarea.value).toBe('Weekend');
    await act(view, () => type(textarea, 'Sunday'));
    await act(view, () => click(view.getByText(strings.saveNote)));
    await eventually(view, () =>
      expect(view.get('[data-deck="deck-note"]').textContent).toBe('Sunday'),
    );
    expect(onDecksChange).toHaveBeenCalled();
    expect((await storedDeck('deck_2'))?.note).toBe('Sunday');
    await act(view, () => click(view.getByText(strings.close)));
    expect(view.query('[data-deck="note"]')).toBeNull();

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
    await act(view, () => click(view.get('[data-deck="deck-note"]')));
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
