// @vitest-environment happy-dom
import 'fake-indexeddb/auto';

import type * as DndCore from '@dnd-kit/core';
import type * as DndSortable from '@dnd-kit/sortable';
import {
  OPEN_PAGE_HASH_PREFIX,
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
import { DeckRepository } from '../storage/repository';
import {
  click,
  keyDown,
  render,
  trusted,
  type,
  type RenderResult,
} from '../testing/render';
import Drawer from './drawer';
import type { UndoAction } from './UndoToast';
import {
  DRAWER_PAGE_KEY,
  DRAWER_SCROLL_KEY,
  DRAWER_CONTENT_SCROLL_KEY,
  INBOX_PAGE_ID,
} from './drawerModel';
import { WORKSPACE_DROP_EVENT } from './WorkspaceDnd';

/*
 * dnd-kit is an external dependency, so Vitest loads it un-aliased against
 * real React, whose hooks cannot run under Preact (same approach as
 * Pins.test.tsx). Its hooks are replaced by fakes reporting a drag state the
 * test controls; drops arrive as WORKSPACE_DROP_EVENT, as in the extension.
 */
const dnd = vi.hoisted(() => ({
  draggingId: null as string | null,
  overId: null as string | null,
}));

vi.mock('@dnd-kit/core', async (importOriginal) => ({
  ...(await importOriginal<typeof DndCore>()),
  useDroppable: ({ id }: { id: string }) => ({
    isOver: dnd.overId === id,
    setNodeRef: () => undefined,
  }),
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
const DATABASE_NAME = 'deck-drawer-test';
const FAILURE = new Error('disk full');
const FAILED_MESSAGE = `${strings.updateFailed} ${FAILURE.message}`;
const SAVED_SCROLL = 120;

const PAGES: Page[] = [
  page('page_1', 'Work', 'a0'),
  page('page_2', 'Home', 'a1'),
  { ...page('page_x', 'Gone', 'a2'), deletedAt: NOW },
];

const DECKS: Deck[] = [
  deck('inbox_1', 'Inbox', 'inbox', 'page_1'),
  deck('deck_1', 'Reading', 'normal', 'page_1'),
  deck('deck_2', 'Chores', 'normal', 'page_2'),
];

const CARDS: Card[] = [
  card('card_1', 'inbox_1'),
  card('card_2', 'inbox_1'),
  { ...card('card_3', 'inbox_1'), deletedAt: NOW },
  card('card_4', 'deck_1'),
];

function page(id: string, title: string, order: string): Page {
  return { id, title, order, createdAt: NOW, updatedAt: NOW, deletedAt: null };
}

function deck(
  id: string,
  title: string,
  kind: Deck['kind'],
  pageId: string,
): Deck {
  return {
    id,
    pageId,
    title,
    kind,
    order: 'a0',
    color: null,
    isCollapsed: false,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function card(id: string, deckId: string): Card {
  return {
    id,
    deckId,
    url: `https://example.com/${id}`,
    title: `Title ${id}`,
    hostname: 'example.com',
    order: `a${id.at(-1) ?? '0'}`,
    pinned: false,
    lastOpenedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

interface Mounted {
  view: RenderResult;
  setOpen: (isOpen: boolean) => Promise<void>;
  onClose: ReturnType<typeof vi.fn<() => void>>;
  onError: ReturnType<typeof vi.fn<(message: string) => void>>;
  onPagesChange: ReturnType<typeof vi.fn<(pages: Page[]) => void>>;
  offerUndo: ReturnType<typeof vi.fn<(action: UndoAction) => void>>;
  requestClose: () => Promise<void>;
}

let repository: DeckRepository;

async function mount(isInitiallyOpen = true): Promise<Mounted> {
  const onClose = vi.fn<() => void>();
  const onError = vi.fn<(message: string) => void>();
  const onPagesChange = vi.fn<(pages: Page[]) => void>();
  const offerUndo = vi.fn<(action: UndoAction) => void>();
  const beforeClose = { current: null as (() => Promise<boolean>) | null };
  const data = {
    cards: [],
    decks: [],
    pages: [],
    defaultDeckId: 'deck_1',
    settings: SETTINGS_DEFAULTS,
    repository,
  };
  function Host({ isOpen }: { isOpen: boolean }) {
    const [pages, setPages] = useState<Page[]>([]);
    const [decks, setDecks] = useState<Deck[]>([]);
    const [cards, setCards] = useState<Card[]>([]);
    // Stable callbacks, as the surface passes them: the load effect depends on them.
    const [callbacks] = useState(() => ({
      onPagesChange: (next: Page[]) => {
        setPages(next);
        onPagesChange(next);
      },
      onDecksChange: setDecks,
      onCardsChange: setCards,
    }));
    return (
      <Drawer
        keymapOverrides={[]}
        data={data}
        pages={pages}
        decks={decks}
        cards={cards}
        isOpen={isOpen}
        onClose={onClose}
        beforeCloseRef={beforeClose}
        onError={onError}
        offerUndo={offerUndo}
        {...callbacks}
      />
    );
  }
  const view = await render(<Host isOpen={isInitiallyOpen} />);
  // The workspace loads from the repository once: wait for it to land or fail.
  await eventually(view, () =>
    expect(
      onPagesChange.mock.calls.length + onError.mock.calls.length,
    ).toBeGreaterThan(0),
  );
  return {
    view,
    setOpen: (isOpen) => view.rerender(<Host isOpen={isOpen} />),
    onClose,
    onError,
    onPagesChange,
    offerUndo,
    requestClose: async () => {
      if (!beforeClose.current || (await beforeClose.current())) onClose();
    },
  };
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

function railTitles(view: RenderResult): string[] {
  return view
    .getAll('[data-deck="pages"] [data-deck="page"]:not([data-system])')
    .map((element) => element.textContent ?? '');
}

function selectedTitle(view: RenderResult): string | undefined {
  return view.query('[data-deck="pages"] [data-selected]')?.textContent?.trim();
}

function inboxButton(view: RenderResult): HTMLElement {
  return view.get('[data-deck="page"][data-system]');
}

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

beforeEach(async () => {
  repository = new DeckRepository({ databaseName: DATABASE_NAME });
  await seed();
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, '', '/newtab.html');
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

describe('Drawer - loading', () => {
  it('loads the stored workspace and opens the first live page', async () => {
    const { view, onPagesChange } = await mount();
    expect(railTitles(view)).toEqual(['Work', 'Home']);
    expect(onPagesChange).toHaveBeenCalledWith(expect.arrayContaining(PAGES));
    expect(selectedTitle(view)).toBe('Work');
    expect(view.query('[data-deck="decks"]')).not.toBeNull();
    expect(view.get('[data-deck="drawer"]').dataset.open).toBe('true');
    view.unmount();
  });

  it('counts the live Inbox cards on the Inbox stop', async () => {
    const { view } = await mount();
    expect(inboxButton(view).querySelector('small')?.textContent).toBe('2');
    view.unmount();
  });

  it('shows no count once the Inbox is empty', async () => {
    for (const id of ['card_1', 'card_2'])
      await repository.softDelete('card', id);
    const { view } = await mount();
    expect(inboxButton(view).querySelector('small')).toBeNull();
    view.unmount();
  });

  it('reopens the page remembered for this tab', async () => {
    localStorage.setItem(DRAWER_PAGE_KEY, 'page_2');
    const { view } = await mount();
    await eventually(view, () => expect(selectedTitle(view)).toBe('Home'));
    view.unmount();
  });

  it('follows a #page= link once, then forgets the hash', async () => {
    history.replaceState(
      null,
      '',
      `/newtab.html${OPEN_PAGE_HASH_PREFIX}page_2`,
    );
    const { view } = await mount();
    await eventually(view, () => expect(selectedTitle(view)).toBe('Home'));
    expect(localStorage.getItem(DRAWER_PAGE_KEY)).toBe('page_2');
    expect(location.hash).toBe('');
    view.unmount();
  });

  it('restores the rail scroll and remembers new scrolling', async () => {
    localStorage.setItem(DRAWER_SCROLL_KEY, String(SAVED_SCROLL));
    const { view } = await mount();
    const rail = view.get('.deck-pages__scroll');
    await eventually(view, () => expect(rail.scrollTop).toBe(SAVED_SCROLL));

    rail.scrollTop = SAVED_SCROLL * 2;
    rail.dispatchEvent(new Event('scroll'));
    expect(localStorage.getItem(DRAWER_SCROLL_KEY)).toBe(
      String(SAVED_SCROLL * 2),
    );
    view.unmount();
  });

  it('restores the main workspace scroll across drawer mounts', async () => {
    localStorage.setItem(DRAWER_CONTENT_SCROLL_KEY, String(SAVED_SCROLL));
    const { view } = await mount();
    const workspace = view.get('[data-deck="decks"]');
    await eventually(view, () =>
      expect(workspace.scrollTop).toBe(SAVED_SCROLL),
    );
    workspace.scrollTop = SAVED_SCROLL * 2;
    workspace.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(localStorage.getItem(DRAWER_CONTENT_SCROLL_KEY)).toBe(
      String(SAVED_SCROLL * 2),
    );
    view.unmount();
  });

  it('reports a workspace that cannot be read', async () => {
    vi.spyOn(repository, 'listDecks').mockRejectedValue(FAILURE);
    const { view, onError } = await mount();
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(FAILED_MESSAGE),
    );
    expect(railTitles(view)).toEqual([]);
    expect(view.container.textContent).toContain(strings.selectPage);
    view.unmount();
  });

  it('reports a non-Error failure as text', async () => {
    vi.spyOn(repository, 'listPages').mockRejectedValue('locked');
    const { view, onError } = await mount();
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(`${strings.updateFailed} locked`),
    );
    view.unmount();
  });
});

describe('Drawer - notes', () => {
  it('saves on Close and reopens with the typed text', async () => {
    const { view } = await mount();
    await view.act(() =>
      click(view.get('[data-card-id="card_4"] [aria-label="Edit note"]')),
    );
    await view.act(() =>
      type(
        view.get<HTMLTextAreaElement>('[data-deck="note"] textarea'),
        'Keep this',
      ),
    );
    await view.act(() => click(view.getByText(strings.close)));
    await eventually(view, () =>
      expect(view.query('[data-deck="note"]')).toBeNull(),
    );
    await eventually(view, () =>
      expect(document.activeElement).toBe(view.get('[data-card-id="card_4"]')),
    );
    await view.act(() =>
      click(view.get('[data-card-id="card_4"] [aria-label="Edit note"]')),
    );
    expect(
      view.get<HTMLTextAreaElement>('[data-deck="note"] textarea').value,
    ).toBe('Keep this');
    expect(
      (await repository.listCards()).find(({ id }) => id === 'card_4')?.note,
    ).toBe('Keep this');
    await view.act(() =>
      type(
        view.get<HTMLTextAreaElement>('[data-deck="note"] textarea'),
        'Outside click',
      ),
    );
    await view.act(() => click(view.get('.deck-grid')));
    await eventually(view, () =>
      expect(view.query('[data-deck="note"]')).toBeNull(),
    );
    await view.act(() =>
      click(view.get('[data-card-id="card_4"] [aria-label="Edit note"]')),
    );
    expect(
      view.get<HTMLTextAreaElement>('[data-deck="note"] textarea').value,
    ).toBe('Outside click');
    view.unmount();
  });

  it('saves before switching pages and blocks drawer close on a failed write', async () => {
    const { view, requestClose, onClose, onError } = await mount();
    await view.act(() =>
      click(view.get('[data-card-id="card_4"] [aria-label="Edit note"]')),
    );
    await view.act(() =>
      type(
        view.get<HTMLTextAreaElement>('[data-deck="note"] textarea'),
        'Page draft',
      ),
    );
    await view.act(() => click(view.getByText('Home')));
    await eventually(view, () => expect(selectedTitle(view)).toBe('Home'));
    await view.act(() => click(view.getByText('Work')));
    await eventually(view, () => expect(selectedTitle(view)).toBe('Work'));
    await view.act(() =>
      click(view.get('[data-card-id="card_4"] [aria-label="Edit note"]')),
    );
    expect(
      view.get<HTMLTextAreaElement>('[data-deck="note"] textarea').value,
    ).toBe('Page draft');
    const upsert = vi
      .spyOn(repository, 'upsertCard')
      .mockRejectedValueOnce(new Error('disk full'));
    await view.act(() =>
      type(
        view.get<HTMLTextAreaElement>('[data-deck="note"] textarea'),
        'Unsaved page draft',
      ),
    );
    await requestClose();
    expect(onClose).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(FAILED_MESSAGE);
    expect(
      view.get<HTMLTextAreaElement>('[data-deck="note"] textarea').value,
    ).toBe('Unsaved page draft');
    upsert.mockRestore();
    await requestClose();
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('returns focus to Inbox after saving a note with Escape', async () => {
    const { view } = await mount();
    await view.act(() => click(inboxButton(view)));
    const list = view.get('[data-deck="inbox"] [role="listbox"]');
    await view.act(() => {
      keyDown(list, 'n');
    });
    const textarea = view.get<HTMLTextAreaElement>(
      '[data-deck="note"] textarea',
    );
    await view.act(() => type(textarea, 'Inbox thought'));
    await view.act(() => {
      keyDown(textarea, 'Escape');
    });
    await eventually(view, () =>
      expect(view.query('[data-deck="note"]')).toBeNull(),
    );
    await eventually(view, () => expect(document.activeElement).toBe(list));
    expect(
      (await repository.listCards()).find(({ id }) => id === 'card_1')?.note,
    ).toBe('Inbox thought');
    view.unmount();
  });
});

describe('Drawer - rail', () => {
  it('switches pages and the Inbox on click, remembering the choice', async () => {
    const { view } = await mount();
    await view.act(() => click(view.getByText('Home')));
    expect(selectedTitle(view)).toBe('Home');
    expect(localStorage.getItem(DRAWER_PAGE_KEY)).toBe('page_2');
    expect(view.get('[data-deck="deck"]').textContent).toContain('Chores');

    await view.act(() => click(inboxButton(view)));
    expect(inboxButton(view).dataset.selected).toBe('true');
    expect(localStorage.getItem(DRAWER_PAGE_KEY)).toBe(INBOX_PAGE_ID);
    expect(view.query('[data-deck="inbox"]')).not.toBeNull();
    expect(view.query('[data-deck="decks"]')).toBeNull();
    view.unmount();
  });

  it('closes from the × button', async () => {
    const { view, onClose } = await mount();
    await view.act(() => click(view.getByLabel(strings.closeDrawer)));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('closes on Escape except while typing or canceling a keyboard drag', async () => {
    const { view, onClose } = await mount();
    await view.act(() => click(view.get('[data-deck="add-card"]')));
    await view.act(() => {
      keyDown(view.getByLabel(strings.pasteUrl), 'Escape');
    });
    expect(onClose).not.toHaveBeenCalled();
    await view.act(() => {
      keyDown(view.get('[data-deck="card-drag"]'), 'Escape');
    });
    expect(onClose).not.toHaveBeenCalled();
    await view.act(() => {
      keyDown(document.body, 'Escape');
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('marks the page being dragged and the pin zone it is over', async () => {
    dnd.draggingId = 'page:page_2';
    dnd.overId = 'pin:drawer';
    const { view } = await mount();
    expect(view.getByText('Home').dataset.dragging).toBe('true');
    expect(view.getByText('Work').dataset.dragging).toBeUndefined();
    const pins = view.get('[data-deck="pins-drop"]');
    expect(pins.dataset.dragOver).toBe('true');
    expect(pins.textContent).toBe(strings.dropToPins);
    view.unmount();
  });

  it('adds a page at the end of the rail in edit mode', async () => {
    const { view } = await mount();
    await view.act(() => click(view.getByLabel(strings.addPage)));
    await eventually(view, () =>
      expect(view.get('[data-deck="page-name"]')).toBe(document.activeElement),
    );
    expect(
      (view.get('[data-deck="page-name"]') as HTMLInputElement).value,
    ).toBe('Page 3');
    await view.act(() => {
      const input = view.get('[data-deck="page-name"]') as HTMLInputElement;
      input.value = 'Projects';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await view.act(() => {
      keyDown(view.get('[data-deck="page-name"]'), 'Enter');
    });
    await eventually(view, () =>
      expect(railTitles(view)).toEqual(['Work', 'Home', 'Projects']),
    );
    expect(selectedTitle(view)).toBe('Projects');
    const stored = await repository.listPages();
    expect(stored.some(({ title }) => title === 'Projects')).toBe(true);
    view.unmount();
  });

  it('adds the first page to an empty workspace', async () => {
    for (const { id } of PAGES.slice(0, 2))
      await repository.softDelete('page', id);
    const { view } = await mount();
    await eventually(view, () =>
      expect(view.container.textContent).toContain(strings.selectPage),
    );
    await view.act(() => click(view.getByLabel(strings.addPage)));
    await eventually(view, () =>
      expect(
        (view.get('[data-deck="page-name"]') as HTMLInputElement).value,
      ).toBe('Page 1'),
    );
    view.unmount();
  });

  it('lets ] reach the Inbox from an empty workspace', async () => {
    for (const { id } of PAGES.slice(0, 2))
      await repository.softDelete('page', id);
    const { view } = await mount();
    expect(inboxButton(view).dataset.selected).toBeUndefined();
    await press(view, ']');
    expect(inboxButton(view).dataset.selected).toBe('true');
    view.unmount();
  });

  it('reports a page the repository could not add', async () => {
    const { view, onError } = await mount();
    vi.spyOn(repository, 'upsertPage').mockRejectedValue(FAILURE);
    await view.act(() => click(view.getByLabel(strings.addPage)));
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(FAILED_MESSAGE),
    );
    expect(railTitles(view)).toEqual(['Work', 'Home']);
    view.unmount();
  });
});

describe('Drawer - Trash', () => {
  it('shows nested deleted records and restores their parent path', async () => {
    await repository.upsertCard(card('card_nested', 'deck_2'));
    await repository.trashPage('page_2');
    const { view } = await mount();
    await view.act(() => click(view.getByText(strings.trash)));
    const trash = view.get('[data-deck="trash"]');
    expect(trash.textContent).toContain('Home');
    expect(trash.textContent).toContain('Chores');
    const row = view
      .getAll('[data-deck="trash-item"]')
      .find((item) => item.textContent?.includes('Title card_nested'));
    if (!row) throw new Error('Missing nested card in Trash');
    const restore = row.querySelector('button');
    if (!restore) throw new Error('Missing restore button');
    await view.act(() => click(restore));
    await eventually(view, async () =>
      expect(
        (await repository.listCards()).find(({ id }) => id === 'card_nested')
          ?.deletedAt,
      ).toBeNull(),
    );
    expect(
      (await repository.listDecks()).find(({ id }) => id === 'deck_2')
        ?.deletedAt,
    ).toBeNull();
    expect(
      (await repository.listPages()).find(({ id }) => id === 'page_2')
        ?.deletedAt,
    ).toBeNull();
    view.unmount();
  });

  it('lists deleted records and restores a card with r', async () => {
    const { view } = await mount();
    await view.act(() => click(view.getByText(strings.trash)));
    expect(view.get('[data-deck="trash"]').textContent).toContain('Gone');
    const item = view
      .getAll('[data-deck="trash-item"]')
      .find((row) => row.textContent?.includes('Title card_3'));
    expect(item).toBeDefined();
    await view.act(() => item?.focus());
    await press(view, 'r');
    await eventually(view, async () =>
      expect(
        (await repository.listCards()).find(({ id }) => id === 'card_3')
          ?.deletedAt,
      ).toBeNull(),
    );
    view.unmount();
  });

  it('uses a confirm sheet before permanently emptying Trash', async () => {
    const { view } = await mount();
    await view.act(() => click(view.getByText(strings.trash)));
    await view.act(() => click(view.getByText(strings.emptyTrash)));
    expect(view.get('[data-deck="trash-confirm"]').textContent).toContain(
      strings.emptyTrashConfirm,
    );
    await view.act(() => click(view.getByText(strings.cancel)));
    expect(await repository.listCards()).toHaveLength(CARDS.length);

    await view.act(() => click(view.getByText(strings.emptyTrash)));
    const confirm = view.get('[data-deck="trash-confirm"]');
    const empty = confirm.querySelectorAll('button')[1];
    if (!empty) throw new Error('Missing Empty trash confirmation button');
    await view.act(() => click(empty));
    await eventually(view, () =>
      expect(view.get('[data-deck="trash"]').textContent).toContain(
        strings.trashEmpty,
      ),
    );
    expect(
      (await repository.listCards()).some(({ id }) => id === 'card_3'),
    ).toBe(false);
    view.unmount();
  });
});

describe('Drawer - page deletion', () => {
  it('opens the page delete sheet from the keyboard', async () => {
    const { view } = await mount();
    const page = view.getByText('Home');
    await view.act(() => page.focus());
    await press(view, 'Delete');
    expect(view.get('[data-deck="page-delete-sheet"]')).not.toBeNull();
    view.unmount();
  });

  it('moves a page’s decks to another page before deleting it', async () => {
    const { view, offerUndo } = await mount();
    await view.act(() => {
      view
        .getByText('Work')
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    const sheet = view.get('[data-deck="page-delete-sheet"]');
    expect(sheet.textContent).toContain(strings.pageDeleteTitle(1));
    expect(document.activeElement).toBe(view.getByText(strings.cancel));
    await view.act(() => click(view.getByText(strings.movePageDecks)));
    await eventually(view, async () =>
      expect(
        (await repository.listPages()).find(({ id }) => id === 'page_1')
          ?.deletedAt,
      ).not.toBeNull(),
    );
    expect(
      (await repository.listDecks()).find(({ id }) => id === 'deck_1')?.pageId,
    ).toBe('page_2');
    expect(
      (await repository.listCards()).find(({ id }) => id === 'card_4')
        ?.deletedAt,
    ).toBeNull();
    expect(
      (await repository.listDecks()).find(({ id }) => id === 'inbox_1')
        ?.deletedAt,
    ).toBeNull();
    const action = offerUndo.mock.calls[0]?.[0];
    if (!action) throw new Error('Missing page Undo action');
    await view.act(async () => action.undo());
    expect(
      (await repository.listPages()).find(({ id }) => id === 'page_1')
        ?.deletedAt,
    ).toBeNull();
    expect(
      (await repository.listDecks()).find(({ id }) => id === 'deck_1')?.pageId,
    ).toBe('page_1');
    view.unmount();
  });

  it('trashes a page with its decks and cards only after choosing that option', async () => {
    const { view } = await mount();
    await view.act(() => {
      view
        .getByText('Home')
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    expect(
      (await repository.listDecks()).find(({ id }) => id === 'deck_2')
        ?.deletedAt,
    ).toBeNull();
    await view.act(() => click(view.getByText(strings.trashPageAndDecks)));
    await eventually(view, async () =>
      expect(
        (await repository.listDecks()).find(({ id }) => id === 'deck_2')
          ?.deletedAt,
      ).not.toBeNull(),
    );
    expect(
      (await repository.listPages()).find(({ id }) => id === 'page_2')
        ?.deletedAt,
    ).not.toBeNull();
    view.unmount();
  });
});

describe('Drawer - renaming pages', () => {
  function doubleClick(element: HTMLElement) {
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  }

  it('renames inline on double-click or F2 and ignores a cancelled or unchanged name', async () => {
    const { view, onPagesChange } = await mount();
    const calls = onPagesChange.mock.calls.length;

    await view.act(() => doubleClick(view.getByText('Work')));
    expect(document.activeElement).toBe(view.get('[data-deck="page-name"]'));
    await view.act(() => {
      keyDown(view.get('[data-deck="page-name"]'), 'Escape');
    });
    await view.act(() => {
      keyDown(view.getByText('Work'), 'F2');
    });
    await view.act(() => {
      keyDown(view.get('[data-deck="page-name"]'), 'Enter');
    });
    expect(onPagesChange).toHaveBeenCalledTimes(calls);

    await view.act(() => doubleClick(view.getByText('Work')));
    await view.act(() => {
      const input = view.get('[data-deck="page-name"]') as HTMLInputElement;
      input.value = ' Office ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await view.act(() => {
      keyDown(view.get('[data-deck="page-name"]'), 'Enter');
    });
    await eventually(view, () =>
      expect(railTitles(view)).toEqual(['Office', 'Home']),
    );
    const stored = await repository.listPages();
    expect(stored.find(({ id }) => id === 'page_1')?.title).toBe('Office');
    view.unmount();
  });

  it('reports a rename the repository refuses', async () => {
    const { view, onError } = await mount();
    vi.spyOn(repository, 'upsertPage').mockRejectedValue(FAILURE);
    await view.act(() => doubleClick(view.getByText('Work')));
    await view.act(() => {
      const input = view.get('[data-deck="page-name"]') as HTMLInputElement;
      input.value = 'Office';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await view.act(() => {
      keyDown(view.get('[data-deck="page-name"]'), 'Enter');
    });
    await eventually(view, () =>
      expect(onError).toHaveBeenCalledWith(FAILED_MESSAGE),
    );
    expect(railTitles(view)).toEqual(['Work', 'Home']);
    view.unmount();
  });
});

describe('Drawer - keys', () => {
  it('jumps to page N with Alt+digit, open or closed, ignoring missing pages', async () => {
    const { view } = await mount(false);
    await press(view, '2', { altKey: true, code: 'Digit2' });
    expect(selectedTitle(view)).toBe('Home');
    await press(view, '9', { altKey: true, code: 'Digit9' });
    expect(selectedTitle(view)).toBe('Home');
    view.unmount();
  });

  it('walks the rail with ] and [, from the Inbox through the pages, clamped at both ends', async () => {
    const { view } = await mount();
    const forward = await press(view, ']');
    expect(forward.defaultPrevented).toBe(true);
    expect(selectedTitle(view)).toBe('Home');
    await press(view, ']');
    expect(selectedTitle(view)).toBe('Home');

    await press(view, '[');
    await press(view, '[');
    expect(view.getByText(strings.trash).getAttribute('data-selected')).toBe(
      'true',
    );
    await press(view, '[');
    expect(inboxButton(view).dataset.selected).toBe('true');
    await press(view, '[');
    expect(inboxButton(view).dataset.selected).toBe('true');
    await press(view, ']');
    expect(view.getByText(strings.trash).getAttribute('data-selected')).toBe(
      'true',
    );
    await press(view, ']');
    expect(selectedTitle(view)).toBe('Work');
    view.unmount();
  });

  it('ignores rail keys while closed, while typing and for other keys', async () => {
    const { view, setOpen } = await mount();
    await setOpen(false);
    expect((await press(view, ']')).defaultPrevented).toBe(false);
    expect(selectedTitle(view)).toBe('Work');

    await setOpen(true);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    expect((await press(view, ']')).defaultPrevented).toBe(false);
    input.remove();

    expect(
      (await press(view, 'Shift', { shiftKey: true })).defaultPrevented,
    ).toBe(false);
    expect(selectedTitle(view)).toBe('Work');
    view.unmount();
  });
});

describe('Drawer - focus handoff', () => {
  it('takes focus from the surface when it opens and drops its own when it closes', async () => {
    const line = document.createElement('input');
    document.body.append(line);
    line.focus();
    const { view, setOpen } = await mount(false);
    expect(document.activeElement).toBe(line);

    await setOpen(true);
    expect(document.activeElement).not.toBe(line);

    const close = view.getByLabel(strings.closeDrawer);
    close.focus();
    await setOpen(false);
    expect(document.activeElement).not.toBe(close);
    expect(view.get('[data-deck="drawer"]').dataset.open).toBeUndefined();
    line.remove();
    view.unmount();
  });

  it('never takes focus from the surface when it closes', async () => {
    const { view, setOpen } = await mount(true);
    const line = document.createElement('input');
    document.body.append(line);
    line.focus();
    await setOpen(false);
    expect(document.activeElement).toBe(line);
    line.remove();
    view.unmount();
  });
});

describe('Drawer - drops', () => {
  it('persists a page dragged above another', async () => {
    const { view } = await mount();
    await view.act(() => {
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_DROP_EVENT, {
          detail: { activeId: 'page:page_2', overId: 'page:page_1' },
        }),
      );
    });
    await eventually(view, () =>
      expect(railTitles(view)).toEqual(['Home', 'Work']),
    );
    const stored = await repository.listPages();
    const home = stored.find(({ id }) => id === 'page_2');
    const work = stored.find(({ id }) => id === 'page_1');
    expect(home && work && home.order < work.order).toBe(true);
    view.unmount();
  });

  it('ignores a drop event that carries no detail', async () => {
    const { view, onPagesChange } = await mount();
    const calls = onPagesChange.mock.calls.length;
    await view.act(() => {
      window.dispatchEvent(trusted(new Event(WORKSPACE_DROP_EVENT)));
    });
    await view.act(async () => {});
    expect(onPagesChange).toHaveBeenCalledTimes(calls);
    expect(railTitles(view)).toEqual(['Work', 'Home']);
    view.unmount();
  });
});
